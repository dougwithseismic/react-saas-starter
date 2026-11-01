import {
  type BillingSubscription,
  type BillingSummary,
  entitlementsFor,
  isPaymentFailing,
  type PaidPlanId,
  paidPlanIdSchema,
  paidPlanIds,
  plans,
  resolvePlan,
} from "@repo/contracts";
import { and, type Database, eq, schema } from "@repo/db";
import { HTTPException } from "hono/http-exception";
import type Stripe from "stripe";
import type { Environment } from "../../config/env.js";
import type { Logger } from "../../lib/logger.js";
import { type AnalyticsSink, noopAnalytics } from "../analytics/analytics.js";
import { missingBillingSettings, planPrices } from "./config.js";
import type { BillingHooks } from "./hooks.js";
import { organizationSubscriptions, type SubscriptionRow } from "./queries.js";
import {
  type BillingGateway,
  createStripeClient,
  createStripeGateway,
} from "./stripe.js";
import { applyStripeEvent } from "./webhook.js";

export type BillingOptions = {
  analytics?: AnalyticsSink;
  logger?: Pick<Logger, "warn" | "error">;
  // Replaces the Stripe API calls, for tests.
  gateway?: BillingGateway;
  hooks?: BillingHooks;
};
export type Billing = ReturnType<typeof createBilling>;

const quiet: Pick<Logger, "warn" | "error"> = { warn() {}, error() {} };
const iso = (value: Date | null) => value?.toISOString() ?? null;

function subscriptionDto(row: SubscriptionRow): BillingSubscription {
  return {
    plan: paidPlanIdSchema.safeParse(row.plan).data ?? null,
    status: row.status,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    cancelAt: iso(
      row.cancelAt ?? (row.cancelAtPeriodEnd ? row.currentPeriodEnd : null),
    ),
    currentPeriodEnd: iso(row.currentPeriodEnd),
    trialEnd: iso(row.trialEnd),
    endedAt: iso(row.endedAt),
    cancellationReason: row.cancellationReason,
    paymentFailedAt: iso(row.paymentFailedAt),
  };
}

export function createBilling(
  db: Database,
  env: Environment,
  options: BillingOptions = {},
) {
  const analytics = options.analytics ?? noopAnalytics;
  const logger = options.logger ?? quiet;
  const hooks = options.hooks ?? {};
  const prices = planPrices(env);
  const enabled = missingBillingSettings(env).length === 0;
  const stripe =
    enabled && env.STRIPE_SECRET_KEY
      ? createStripeClient(env.STRIPE_SECRET_KEY)
      : null;
  const gateway = stripe
    ? (options.gateway ?? createStripeGateway(stripe))
    : null;
  const billingUrl = (organizationId: string) =>
    `${env.APP_ORIGIN}/organisations/${encodeURIComponent(organizationId)}/billing`;

  const switchedOff = () =>
    new HTTPException(503, {
      message:
        "Billing is switched off. Set the Stripe keys on the server to turn it on.",
    });
  function live() {
    if (!gateway) throw switchedOff();
    return gateway;
  }
  async function stripeCall<T>(work: () => Promise<T>) {
    try {
      return await work();
    } catch (error) {
      logger.error(
        {
          provider: "stripe",
          errorName: error instanceof Error ? error.name : "Error",
          errorType:
            typeof error === "object" && error && "type" in error
              ? String(error.type)
              : undefined,
        },
        "Stripe request failed",
      );
      throw new HTTPException(502, {
        message: "Stripe could not complete the request. Try again shortly.",
      });
    }
  }
  async function membership(organizationId: string, userId: string) {
    const [row] = await db
      .select({ role: schema.member.role, name: schema.organization.name })
      .from(schema.member)
      .innerJoin(
        schema.organization,
        eq(schema.organization.id, schema.member.organizationId),
      )
      .where(
        and(
          eq(schema.member.organizationId, organizationId),
          eq(schema.member.userId, userId),
        ),
      )
      .limit(1);
    if (!row)
      throw new HTTPException(403, {
        message: "You are not a member of this organisation",
      });
    const roles = row.role.split(",");
    return {
      name: row.name,
      canManage: roles.includes("owner") || roles.includes("admin"),
    };
  }
  async function manager(organizationId: string, userId: string) {
    const member = await membership(organizationId, userId);
    if (!member.canManage)
      throw new HTTPException(403, {
        message: "Only owners and admins can manage billing",
      });
    return member;
  }
  async function customerId(organizationId: string) {
    const [row] = await db
      .select({ id: schema.billingCustomers.stripeCustomerId })
      .from(schema.billingCustomers)
      .where(eq(schema.billingCustomers.organizationId, organizationId))
      .limit(1);
    return row?.id ?? null;
  }

  return {
    enabled,
    // The plan rules for an organisation, for gating features in other modules.
    async entitlements(organizationId: string) {
      const { current } = await organizationSubscriptions(db, organizationId);
      return entitlementsFor(resolvePlan(current));
    },
    async summary(
      organizationId: string,
      userId: string,
    ): Promise<BillingSummary> {
      const member = await membership(organizationId, userId);
      const { rows, current } = await organizationSubscriptions(
        db,
        organizationId,
      );
      const plan = resolvePlan(current);
      return {
        enabled,
        organization: { id: organizationId, name: member.name },
        canManage: member.canManage,
        plan,
        entitlements: entitlementsFor(plan),
        subscription: current ? subscriptionDto(current) : null,
        paymentFailed: current
          ? isPaymentFailing({
              status: current.status,
              paymentFailedAt: current.paymentFailedAt,
            })
          : false,
        hasBillingAccount: (await customerId(organizationId)) !== null,
        trialAvailable: rows.length === 0,
        purchasable: enabled
          ? paidPlanIds.filter((id) => prices[id].length > 0)
          : [],
      };
    },
    async startCheckout(
      organizationId: string,
      user: { id: string; email: string },
      plan: PaidPlanId,
    ) {
      const stripeGateway = live();
      const member = await manager(organizationId, user.id);
      const priceId = prices[plan][0];
      if (!priceId)
        throw new HTTPException(400, {
          message: "That plan is not available",
        });
      const { rows, open } = await organizationSubscriptions(
        db,
        organizationId,
      );
      if (open)
        throw new HTTPException(409, {
          message:
            "This organisation already has a subscription. Change plans in the billing portal.",
        });
      let customer = await customerId(organizationId);
      if (!customer) {
        const created = await stripeCall(() =>
          stripeGateway.createCustomer({
            organizationId,
            name: member.name,
            email: user.email,
          }),
        );
        await db
          .insert(schema.billingCustomers)
          .values({ organizationId, stripeCustomerId: created })
          .onConflictDoNothing();
        customer = (await customerId(organizationId)) ?? created;
      }
      const url = await stripeCall(() =>
        stripeGateway.createCheckout({
          customerId: customer,
          priceId,
          organizationId,
          userId: user.id,
          plan,
          trialDays: rows.length === 0 ? plans[plan].trialDays : 0,
          successUrl: `${billingUrl(organizationId)}?checkout=success`,
          cancelUrl: `${billingUrl(organizationId)}?checkout=cancelled`,
        }),
      );
      analytics.capture("billing.checkout_started", user.id, {
        organizationId,
        plan,
      });
      return url;
    },
    async openPortal(organizationId: string, userId: string) {
      const stripeGateway = live();
      await manager(organizationId, userId);
      const customer = await customerId(organizationId);
      if (!customer)
        throw new HTTPException(409, {
          message: "There is no billing account yet. Choose a plan first.",
        });
      return stripeCall(() =>
        stripeGateway.createPortal({
          customerId: customer,
          returnUrl: billingUrl(organizationId),
        }),
      );
    },
    async invoices(organizationId: string, userId: string) {
      const stripeGateway = live();
      await manager(organizationId, userId);
      const customer = await customerId(organizationId);
      if (!customer) return [];
      return stripeCall(() => stripeGateway.listInvoices(customer));
    },
    async receiveWebhook(payload: string, signature: string) {
      const secret = env.STRIPE_WEBHOOK_SECRET;
      if (!stripe || !secret) throw switchedOff();
      let event: Stripe.Event;
      try {
        event = await stripe.webhooks.constructEventAsync(
          payload,
          signature,
          secret,
        );
      } catch {
        throw new HTTPException(400, { message: "Invalid Stripe signature" });
      }
      try {
        const result = await applyStripeEvent(db, event, {
          prices,
          hooks,
          logger,
        });
        for (const capture of result.captures)
          analytics.capture(capture.event, capture.userId, capture.properties);
        return { duplicate: !result.applied };
      } catch (error) {
        logger.error(
          {
            eventId: event.id,
            eventType: event.type,
            errorName: error instanceof Error ? error.name : "Error",
          },
          "Stripe event failed; Stripe will deliver it again",
        );
        throw error;
      }
    },
  };
}
