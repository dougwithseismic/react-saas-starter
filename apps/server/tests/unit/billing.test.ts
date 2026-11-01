import assert from "node:assert/strict";
import test from "node:test";
import {
  entitlementsFor,
  hasFeature,
  isPaymentFailing,
  resolvePlan,
  withinLimit,
} from "@repo/contracts";
import { createDatabase } from "@repo/db";
import { createApp } from "../../src/app.js";
import { readEnvironment } from "../../src/config/env.js";
import { createAuth } from "../../src/modules/auth/auth.js";
import {
  missingBillingSettings,
  planForPrice,
  planPrices,
} from "../../src/modules/billing/config.js";

const base = {
  DATABASE_URL: "postgres://localhost/test",
  BETTER_AUTH_SECRET: "test-secret-with-at-least-thirty-two-characters",
  BETTER_AUTH_URL: "http://localhost:4300",
  APP_ORIGIN: "http://localhost:4300",
  LOG_LEVEL: "silent",
};

test("plans resolve from the subscription status and grant shared entitlements", () => {
  assert.equal(resolvePlan(null), "free");
  assert.equal(resolvePlan({ plan: "pro", status: "active" }), "pro");
  assert.equal(resolvePlan({ plan: "team", status: "trialing" }), "team");
  // Stripe is still retrying the payment, so the plan stays.
  assert.equal(resolvePlan({ plan: "pro", status: "past_due" }), "pro");
  for (const status of ["unpaid", "canceled", "incomplete", "paused"])
    assert.equal(resolvePlan({ plan: "pro", status }), "free", status);
  assert.equal(resolvePlan({ plan: null, status: "active" }), "free");
  assert.equal(resolvePlan({ plan: "enterprise", status: "active" }), "free");
  const free = entitlementsFor("free");
  const team = entitlementsFor("team");
  assert.equal(hasFeature(free, "apiAccess"), false);
  assert.equal(hasFeature(team, "auditLog"), true);
  assert.equal(withinLimit(free, "seats", 2), false);
  assert.equal(withinLimit(team, "projects", 10_000), true);
  team.features.pop();
  assert.equal(hasFeature(entitlementsFor("team"), "auditLog"), true);
});

test("a failed payment counts until the subscription ends", () => {
  const failedAt = new Date();
  assert.equal(
    isPaymentFailing({ status: "active", paymentFailedAt: null }),
    false,
  );
  assert.equal(
    isPaymentFailing({ status: "past_due", paymentFailedAt: null }),
    true,
  );
  assert.equal(
    isPaymentFailing({ status: "active", paymentFailedAt: failedAt }),
    true,
  );
  assert.equal(
    isPaymentFailing({ status: "canceled", paymentFailedAt: failedAt }),
    false,
  );
});

test("billing settings are named when missing and prices map to plans", () => {
  const off = readEnvironment(base);
  assert.deepEqual(missingBillingSettings(off), [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
  ]);
  assert.deepEqual(planPrices(off), { pro: [], team: [] });
  const on = readEnvironment({
    ...base,
    STRIPE_SECRET_KEY: "sk_test_starter",
    STRIPE_WEBHOOK_SECRET: "whsec_starter",
    STRIPE_PRICE_PRO: "price_pro",
    STRIPE_PRICE_TEAM: "price_team_new, price_team_old",
  });
  assert.deepEqual(missingBillingSettings(on), []);
  const prices = planPrices(on);
  assert.deepEqual(prices.team, ["price_team_new", "price_team_old"]);
  assert.equal(planForPrice(prices, "price_team_old"), "team");
  assert.equal(planForPrice(prices, "price_pro"), "pro");
  assert.equal(planForPrice(prices, "price_other"), null);
  assert.equal(planForPrice(prices, null), null);
  assert.throws(() =>
    readEnvironment({ ...base, STRIPE_SECRET_KEY: "pk_test_publishable" }),
  );
  assert.throws(() =>
    readEnvironment({ ...base, STRIPE_PRICE_PRO: "prod_not_a_price" }),
  );
  assert.equal(
    readEnvironment({ ...base, STRIPE_SECRET_KEY: "" }).STRIPE_SECRET_KEY,
    undefined,
  );
});

test("the webhook refuses unsigned, wrongly signed and unconfigured deliveries", async () => {
  const { db, pool } = createDatabase(base.DATABASE_URL);
  try {
    const off = readEnvironment(base);
    const disabled = createApp(db, createAuth(db, off), off);
    const response = await disabled.request("/api/billing/webhook", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=00" },
      body: "{}",
    });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error.message, /switched off/);
    const on = readEnvironment({
      ...base,
      STRIPE_SECRET_KEY: "sk_test_starter",
      STRIPE_WEBHOOK_SECRET: "whsec_starter",
    });
    const enabled = createApp(db, createAuth(db, on), on);
    const unsigned = await enabled.request("/api/billing/webhook", {
      method: "POST",
      body: "{}",
    });
    assert.equal(unsigned.status, 400);
    const forged = await enabled.request("/api/billing/webhook", {
      method: "POST",
      headers: {
        "stripe-signature": `t=${Math.floor(Date.now() / 1000)},v1=${"0".repeat(64)}`,
      },
      body: JSON.stringify({ id: "evt_forged", type: "invoice.paid" }),
    });
    assert.equal(forged.status, 400);
    assert.match(
      (await forged.json()).error.message,
      /Invalid Stripe signature/,
    );
  } finally {
    await pool.end();
  }
});
