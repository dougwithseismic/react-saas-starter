import { z } from "zod";

// Plans and what each one allows. The web app and the API both read these, so
// a limit changes in one place. Stripe price ids are server configuration
// (STRIPE_PRICE_PRO, STRIPE_PRICE_TEAM); `price` is the label shown before
// Checkout, which always shows the real amount. Keep the two in step.
export const planIds = ["free", "pro", "team"] as const;
export const paidPlanIds = ["pro", "team"] as const;
export const planIdSchema = z.enum(planIds);
export const paidPlanIdSchema = z.enum(paidPlanIds);
export type PlanId = z.infer<typeof planIdSchema>;
export type PaidPlanId = z.infer<typeof paidPlanIdSchema>;

export const featureIds = ["apiAccess", "prioritySupport", "auditLog"] as const;
export type Feature = (typeof featureIds)[number];
export const entitlementsSchema = z.object({
  // null means no limit.
  seats: z.number().int().positive().nullable(),
  projects: z.number().int().positive().nullable(),
  features: z.array(z.enum(featureIds)),
});
export type Entitlements = z.infer<typeof entitlementsSchema>;
export type Plan = {
  id: PlanId;
  name: string;
  description: string;
  price: string;
  // Free trial for an organisation's first subscription. 0 turns it off.
  trialDays: number;
  entitlements: Entitlements;
};
export const plans = {
  free: {
    id: "free",
    name: "Free",
    description: "For trying the app on your own.",
    price: "$0",
    trialDays: 0,
    entitlements: { seats: 1, projects: 3, features: [] },
  },
  pro: {
    id: "pro",
    name: "Pro",
    description: "For small teams doing real work.",
    price: "$19 a month",
    trialDays: 14,
    entitlements: { seats: 5, projects: 25, features: ["apiAccess"] },
  },
  team: {
    id: "team",
    name: "Team",
    description: "For growing teams that need more control.",
    price: "$49 a month",
    trialDays: 14,
    entitlements: {
      seats: 25,
      projects: null,
      features: ["apiAccess", "prioritySupport", "auditLog"],
    },
  },
} as const satisfies Record<PlanId, Plan>;

// Stripe subscription statuses, mirrored as Stripe sends them.
export const subscriptionStatuses = [
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "paused",
] as const;
export type SubscriptionStatus = (typeof subscriptionStatuses)[number];
// Statuses that grant the plan. past_due keeps the plan while Stripe retries a
// failed payment; when the retries run out Stripe moves the subscription to
// unpaid or canceled (your Stripe retry settings decide which) and the
// organisation drops to Free. Remove past_due to cut access on the first
// failed payment instead.
export const entitledStatuses: readonly string[] = [
  "active",
  "trialing",
  "past_due",
];
export function isEntitled(status: string) {
  return entitledStatuses.includes(status);
}
// A subscription Stripe may still charge. While one is open, plan changes go
// through the Customer Portal rather than a new Checkout. Incomplete ones
// expire by themselves.
export function isOpen(status: string) {
  return !["canceled", "incomplete", "incomplete_expired"].includes(status);
}
// True while a failed payment still matters: Stripe is retrying it, or gave
// up and left the subscription unpaid. Not once the subscription has ended.
export function isPaymentFailing(subscription: {
  status: string;
  paymentFailedAt: string | Date | null;
}) {
  if (["canceled", "incomplete_expired"].includes(subscription.status))
    return false;
  return (
    subscription.paymentFailedAt !== null ||
    subscription.status === "past_due" ||
    subscription.status === "unpaid"
  );
}
export function resolvePlan(
  subscription: { plan: string | null; status: string } | null,
): PlanId {
  if (!subscription || !isEntitled(subscription.status)) return "free";
  const parsed = paidPlanIdSchema.safeParse(subscription.plan);
  return parsed.success ? parsed.data : "free";
}
export function entitlementsFor(plan: PlanId): Entitlements {
  const { seats, projects, features } = plans[plan].entitlements;
  return { seats, projects, features: [...features] };
}
export function hasFeature(entitlements: Entitlements, feature: Feature) {
  return entitlements.features.includes(feature);
}
export function withinLimit(
  entitlements: Entitlements,
  limit: "seats" | "projects",
  count: number,
) {
  const max = entitlements[limit];
  return max === null || count <= max;
}

export const billingSubscriptionSchema = z.object({
  plan: planIdSchema.nullable(),
  status: z.string(),
  cancelAtPeriodEnd: z.boolean(),
  // When a scheduled cancellation takes effect, however it was scheduled.
  cancelAt: z.string().nullable(),
  currentPeriodEnd: z.string().nullable(),
  trialEnd: z.string().nullable(),
  endedAt: z.string().nullable(),
  cancellationReason: z.string().nullable(),
  paymentFailedAt: z.string().nullable(),
});
export const billingSummarySchema = z.object({
  // false when the server has no Stripe keys; every organisation is on Free.
  enabled: z.boolean(),
  organization: z.object({ id: z.string(), name: z.string() }),
  canManage: z.boolean(),
  plan: planIdSchema,
  entitlements: entitlementsSchema,
  // The live subscription, or the most recent one when none is live.
  subscription: billingSubscriptionSchema.nullable(),
  paymentFailed: z.boolean(),
  hasBillingAccount: z.boolean(),
  trialAvailable: z.boolean(),
  // Paid plans with a configured Stripe price.
  purchasable: z.array(paidPlanIdSchema),
});
export const checkoutInputSchema = z.object({ plan: paidPlanIdSchema });
export const billingRedirectSchema = z.object({ url: z.url() });
export const invoiceSchema = z.object({
  id: z.string(),
  number: z.string().nullable(),
  status: z.string().nullable(),
  total: z.number().int(),
  amountPaid: z.number().int(),
  currency: z.string(),
  createdAt: z.string(),
  hostedInvoiceUrl: z.url().nullable(),
  invoicePdf: z.url().nullable(),
});
export const invoiceListSchema = z.object({ invoices: z.array(invoiceSchema) });
export type BillingSubscription = z.infer<typeof billingSubscriptionSchema>;
export type BillingSummary = z.infer<typeof billingSummarySchema>;
export type Invoice = z.infer<typeof invoiceSchema>;
