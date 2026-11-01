import { type PaidPlanId, paidPlanIds } from "@repo/contracts";
import type { Environment } from "../../config/env.js";

const billingSettings = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"] as const;

// Billing runs only with both keys. Without them checkout, the portal and the
// webhook answer 503 and the billing page says billing is switched off.
export function missingBillingSettings(env: Environment) {
  return billingSettings.filter((name) => !env[name]);
}

export type PlanPrices = Record<PaidPlanId, readonly string[]>;

// The Stripe prices behind each paid plan. Checkout offers the first; the
// rest still map existing subscribers to the plan. A plan without a price is
// not offered. Add a plan here, in packages/contracts and in the env files.
export function planPrices(env: Environment): PlanPrices {
  return { pro: env.STRIPE_PRICE_PRO, team: env.STRIPE_PRICE_TEAM };
}

export function planForPrice(
  prices: PlanPrices,
  priceId: string | null | undefined,
): PaidPlanId | null {
  if (!priceId) return null;
  return paidPlanIds.find((plan) => prices[plan].includes(priceId)) ?? null;
}
