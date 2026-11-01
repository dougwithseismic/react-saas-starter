import {
  type BillingSummary,
  type Entitlements,
  type Feature,
  plans,
} from "@repo/contracts";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
export const formatDate = (value: string) => dateFormat.format(new Date(value));
// Stripe amounts are in the currency's smallest unit (cents for USD, yen for JPY).
export function formatMoney(amount: number, currency: string) {
  const format = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
  });
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
  return format.format(amount / 10 ** digits);
}

const featureNames: Record<Feature, string> = {
  apiAccess: "API access",
  prioritySupport: "Priority support",
  auditLog: "Audit log",
};
export function entitlementLines(entitlements: Entitlements) {
  const { seats, projects, features } = entitlements;
  return [
    seats === null
      ? "Unlimited members"
      : `${seats} ${seats === 1 ? "member" : "members"}`,
    projects === null ? "Unlimited projects" : `${projects} projects`,
    ...features.map((feature) => featureNames[feature]),
  ];
}

const endings: Record<string, string> = {
  payment_failed: " because a payment failed",
  payment_disputed: " because a payment was disputed",
  cancellation_requested: " because it was cancelled",
};
// One sentence on where the subscription stands, for everyone who can see it.
export function subscriptionStatus({ subscription }: BillingSummary) {
  if (!subscription) return "No subscription.";
  const date = (value: string | null) => (value ? formatDate(value) : null);
  const cancelAt = date(subscription.cancelAt);
  switch (subscription.status) {
    case "trialing":
      if (cancelAt)
        return `Free trial. It ends on ${cancelAt} and won't renew.`;
      return subscription.trialEnd
        ? `Free trial until ${date(subscription.trialEnd)}.`
        : "Free trial.";
    case "active": {
      if (cancelAt) return `Cancelled. The plan stays until ${cancelAt}.`;
      const renews = date(subscription.currentPeriodEnd);
      return renews ? `Renews on ${renews}.` : "Active.";
    }
    case "past_due":
      return "The last payment failed. It is being retried, and the plan stays until the retries run out.";
    case "unpaid":
      return "Unpaid. Retries have stopped, so the organisation is on Free until the open invoice is paid.";
    case "canceled": {
      const ended = date(subscription.endedAt);
      const reason = endings[subscription.cancellationReason ?? ""] ?? "";
      return `The subscription ended${ended ? ` on ${ended}` : ""}${reason}.`;
    }
    case "incomplete":
      return "Waiting for the first payment to go through.";
    case "incomplete_expired":
      return "The first payment didn't go through, so the subscription didn't start.";
    case "paused":
      return "Paused. The organisation is on Free until it resumes.";
    default:
      return `Status: ${subscription.status}.`;
  }
}
// What went wrong with a payment and what an owner or admin can do about it.
export function paymentProblem({ organization, subscription }: BillingSummary) {
  const plan = subscription?.plan ? plans[subscription.plan].name : "the plan";
  if (subscription?.status === "unpaid")
    return `Payments for ${organization.name} failed and retries have stopped, so it is on Free. Pay the open invoice to get ${plan} back.`;
  return `A payment for ${organization.name} failed. Update the card to keep ${plan}; the payment is retried automatically.`;
}
const invoiceStatuses: Record<string, string> = {
  paid: "Paid",
  open: "Due",
  void: "Void",
  uncollectible: "Uncollectible",
};
export const invoiceStatus = (status: string | null) =>
  invoiceStatuses[status ?? ""] ?? status ?? "";
