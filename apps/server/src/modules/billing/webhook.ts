import { and, type Database, eq, isNull, lt, lte, or, schema } from "@repo/db";
import type Stripe from "stripe";
import type { Logger } from "../../lib/logger.js";
import type {
  AnalyticsEvent,
  AnalyticsProperties,
} from "../analytics/analytics.js";
import { type PlanPrices, planForPrice } from "./config.js";
import type { BillingHooks, BillingTransaction } from "./hooks.js";

export type Capture = {
  event: AnalyticsEvent;
  userId: string;
  properties: AnalyticsProperties;
};
type Context = {
  tx: BillingTransaction;
  event: Stripe.Event;
  at: Date;
  prices: PlanPrices;
  hooks: BillingHooks;
  logger: Pick<Logger, "warn">;
  captures: Capture[];
};

const idOf = (value: string | { id: string } | null | undefined) =>
  value == null ? null : typeof value === "string" ? value : value.id;
const date = (seconds: number | null | undefined) =>
  seconds == null ? null : new Date(seconds * 1000);
// Events with no signed-in person behind them are counted against the user
// who started checkout, kept in the subscription's metadata.
const actor = (organizationId: string, metadata?: Stripe.Metadata | null) =>
  metadata?.userId ?? `organization:${organizationId}`;

// Applies one verified Stripe event. The event id is recorded in the same
// transaction as its effects, so a redelivered event changes nothing. If
// anything throws, nothing is recorded and Stripe retries the delivery.
export async function applyStripeEvent(
  db: Database,
  event: Stripe.Event,
  options: Pick<Context, "prices" | "hooks" | "logger">,
): Promise<{ applied: boolean; captures: Capture[] }> {
  const at = new Date(event.created * 1000);
  return db.transaction(async (tx) => {
    const [recorded] = await tx
      .insert(schema.billingEvents)
      .values({ id: event.id, type: event.type, stripeCreatedAt: at })
      .onConflictDoNothing()
      .returning({ id: schema.billingEvents.id });
    if (!recorded) return { applied: false, captures: [] };
    const context: Context = { tx, event, at, ...options, captures: [] };
    switch (event.type) {
      case "checkout.session.completed":
        await checkoutCompleted(context, event.data.object);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
        await syncSubscription(context, event.data.object);
        break;
      case "customer.subscription.deleted": {
        const synced = await syncSubscription(context, event.data.object);
        if (synced)
          context.captures.push({
            event: "billing.cancelled",
            userId: actor(synced.organizationId, event.data.object.metadata),
            properties: {
              organizationId: synced.organizationId,
              ...(synced.plan ? { plan: synced.plan } : {}),
            },
          });
        break;
      }
      case "invoice.paid":
        await invoicePaid(context, event.data.object);
        break;
      case "invoice.payment_failed":
        await paymentFailed(context, event.data.object);
        break;
    }
    return { applied: true, captures: context.captures };
  });
}

// Finds the organisation for a Stripe customer. Checkout creates the link
// first; the organisation id in metadata is the fallback for subscriptions
// made elsewhere, such as the Stripe dashboard.
async function organizationFor(
  context: Context,
  customerId: string | null,
  hint: string | null | undefined,
) {
  if (customerId) {
    const [customer] = await context.tx
      .select({ organizationId: schema.billingCustomers.organizationId })
      .from(schema.billingCustomers)
      .where(eq(schema.billingCustomers.stripeCustomerId, customerId))
      .limit(1);
    if (customer) return customer.organizationId;
  }
  if (hint && customerId) {
    const [organization] = await context.tx
      .select({ id: schema.organization.id })
      .from(schema.organization)
      .where(eq(schema.organization.id, hint))
      .limit(1);
    if (organization) {
      await context.tx
        .insert(schema.billingCustomers)
        .values({
          organizationId: organization.id,
          stripeCustomerId: customerId,
        })
        .onConflictDoNothing();
      return organization.id;
    }
  }
  context.logger.warn(
    { eventId: context.event.id, eventType: context.event.type },
    "Stripe event for an unknown organisation was skipped",
  );
  return null;
}

async function checkoutCompleted(
  context: Context,
  session: Stripe.Checkout.Session,
) {
  if (session.mode !== "subscription") return;
  const organizationId = await organizationFor(
    context,
    idOf(session.customer),
    session.client_reference_id ?? session.metadata?.organizationId,
  );
  if (!organizationId) return;
  const plan = session.metadata?.plan;
  context.captures.push({
    event: "billing.subscribed",
    userId: actor(organizationId, session.metadata),
    properties: { organizationId, ...(plan ? { plan } : {}) },
  });
}

async function syncSubscription(
  context: Context,
  subscription: Stripe.Subscription,
) {
  const customerId = idOf(subscription.customer);
  const organizationId = await organizationFor(
    context,
    customerId,
    subscription.metadata?.organizationId,
  );
  if (!organizationId || !customerId) return null;
  const item = subscription.items?.data?.[0];
  const priceId = item?.price?.id ?? null;
  const plan = planForPrice(context.prices, priceId);
  if (priceId && !plan)
    context.logger.warn(
      { eventId: context.event.id, priceId },
      "Subscription price is not in the plan configuration; the organisation gets Free",
    );
  // Before API version 2025-03-31 the period sat on the subscription itself.
  const legacy = subscription as unknown as {
    current_period_start?: number;
    current_period_end?: number;
  };
  const values = {
    organizationId,
    stripeCustomerId: customerId,
    stripePriceId: priceId,
    plan,
    status: subscription.status,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    cancelAt: date(subscription.cancel_at),
    canceledAt: date(subscription.canceled_at),
    endedAt: date(subscription.ended_at),
    cancellationReason: subscription.cancellation_details?.reason ?? null,
    trialStart: date(subscription.trial_start),
    trialEnd: date(subscription.trial_end),
    currentPeriodStart: date(
      item?.current_period_start ?? legacy.current_period_start,
    ),
    currentPeriodEnd: date(
      item?.current_period_end ?? legacy.current_period_end,
    ),
    stripeEventAt: context.at,
  };
  const [row] = await context.tx
    .insert(schema.subscriptions)
    .values({ id: subscription.id, ...values })
    .onConflictDoUpdate({
      target: schema.subscriptions.id,
      set: values,
      setWhere: lte(schema.subscriptions.stripeEventAt, context.at),
    })
    .returning({ id: schema.subscriptions.id });
  if (!row) return null; // A newer event already applied.
  return { organizationId, plan };
}

function invoiceSubscriptionId(invoice: Stripe.Invoice) {
  const legacy = invoice as unknown as {
    subscription?: string | { id: string } | null;
  };
  return (
    idOf(invoice.parent?.subscription_details?.subscription) ??
    idOf(legacy.subscription)
  );
}

async function invoicePaid(context: Context, invoice: Stripe.Invoice) {
  const customerId = idOf(invoice.customer);
  const metadata = invoice.parent?.subscription_details?.metadata;
  const organizationId = await organizationFor(
    context,
    customerId,
    metadata?.organizationId,
  );
  if (!organizationId || !customerId || !invoice.id) return;
  const subscriptionId = invoiceSubscriptionId(invoice);
  let plan: string | null = null;
  if (subscriptionId) {
    await context.tx
      .update(schema.subscriptions)
      .set({ paymentFailedAt: null })
      .where(
        and(
          eq(schema.subscriptions.id, subscriptionId),
          lte(schema.subscriptions.paymentFailedAt, context.at),
        ),
      );
    const [row] = await context.tx
      .select({ plan: schema.subscriptions.plan })
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.id, subscriptionId))
      .limit(1);
    plan = row?.plan ?? null;
  }
  const paid = {
    eventId: context.event.id,
    invoiceId: invoice.id,
    organizationId,
    stripeCustomerId: customerId,
    subscriptionId,
    plan,
    amountPaid: invoice.amount_paid,
    currency: invoice.currency,
    billingReason: invoice.billing_reason ?? null,
    paidAt: date(invoice.status_transitions?.paid_at) ?? context.at,
  };
  for (const listener of context.hooks.invoicePaid ?? [])
    await listener(paid, context.tx);
}

async function paymentFailed(context: Context, invoice: Stripe.Invoice) {
  const customerId = idOf(invoice.customer);
  const metadata = invoice.parent?.subscription_details?.metadata;
  const organizationId = await organizationFor(
    context,
    customerId,
    metadata?.organizationId,
  );
  if (!organizationId) return;
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (subscriptionId)
    await context.tx
      .update(schema.subscriptions)
      .set({ paymentFailedAt: context.at })
      .where(
        and(
          eq(schema.subscriptions.id, subscriptionId),
          or(
            isNull(schema.subscriptions.paymentFailedAt),
            lt(schema.subscriptions.paymentFailedAt, context.at),
          ),
        ),
      );
  context.captures.push({
    event: "billing.payment_failed",
    userId: actor(organizationId, metadata),
    properties: { organizationId },
  });
}
