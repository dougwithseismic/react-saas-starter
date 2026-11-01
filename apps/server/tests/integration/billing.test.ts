import assert from "node:assert/strict";
import { createHmac, randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Invoice } from "@repo/contracts";
import { createDatabase, eq, inArray, schema } from "@repo/db";
import { createApp } from "../../src/app.js";
import { readEnvironment } from "../../src/config/env.js";
import { CLIENT_IP_HEADER } from "../../src/lib/client-ip.js";
import { createAuth } from "../../src/modules/auth/auth.js";
import type { InvoicePaid } from "../../src/modules/billing/hooks.js";
import { createBilling } from "../../src/modules/billing/service.js";
import type { BillingGateway } from "../../src/modules/billing/stripe.js";

const webhookSecret = "whsec_starter_billing_test";
// Stripe's v1 scheme: HMAC-SHA256 of "<timestamp>.<raw body>".
function sign(payload: string, secret = webhookSecret) {
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

test("billing follows Stripe through checkout, failed payment and cancellation", {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const env = readEnvironment({
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    BETTER_AUTH_SECRET: "test-secret-with-at-least-thirty-two-characters",
    BETTER_AUTH_URL: "http://localhost:4300",
    APP_ORIGIN: "http://localhost:4300",
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    STRIPE_SECRET_KEY: "sk_test_starter_billing",
    STRIPE_WEBHOOK_SECRET: webhookSecret,
    STRIPE_PRICE_PRO: "price_pro_test",
    STRIPE_PRICE_TEAM: "price_team_test",
  });
  const { db, pool } = createDatabase(env.DATABASE_URL);
  const suffix = crypto.randomUUID().replaceAll("-", "");
  const captured: { event: string; userId: string; plan?: string }[] = [];
  const analytics = {
    capture(event: string, userId: string, properties?: { plan?: string }) {
      captured.push({ event, userId, plan: properties?.plan });
    },
    identify() {},
    async shutdown() {},
  };
  const customers: Parameters<BillingGateway["createCustomer"]>[0][] = [];
  const checkouts: Parameters<BillingGateway["createCheckout"]>[0][] = [];
  const portals: Parameters<BillingGateway["createPortal"]>[0][] = [];
  const invoices: Invoice[] = [
    {
      id: `in_create_${suffix}`,
      number: "STARTER-0001",
      status: "paid",
      total: 1900,
      amountPaid: 1900,
      currency: "usd",
      createdAt: new Date(1793519999000).toISOString(),
      hostedInvoiceUrl: "https://invoice.stripe.com/i/acct_test/test",
      invoicePdf: null,
    },
  ];
  // Stands in for the Stripe API; signature checks still use the Stripe SDK.
  const gateway: BillingGateway = {
    async createCustomer(input) {
      customers.push(input);
      return `cus_${suffix}`;
    },
    async createCheckout(input) {
      checkouts.push(input);
      return `https://checkout.stripe.com/c/pay/cs_test_${suffix}`;
    },
    async createPortal(input) {
      portals.push(input);
      return `https://billing.stripe.com/p/session/test_${suffix}`;
    },
    async listInvoices(customerId) {
      assert.equal(customerId, `cus_${suffix}`);
      return invoices;
    },
  };
  const paid: InvoicePaid[] = [];
  let failNextInvoice = false;
  const billing = createBilling(db, env, {
    analytics,
    gateway,
    hooks: {
      invoicePaid: [
        async (invoice, tx) => {
          // Runs in the webhook transaction; a later throw undoes this read.
          await tx.select().from(schema.subscriptions).limit(1);
          if (failNextInvoice) {
            failNextInvoice = false;
            throw new Error("listener failed");
          }
          paid.push(invoice);
        },
      ],
    },
  });
  const auth = createAuth(db, env);
  const app = createApp(db, auth, env, undefined, billing);
  const users: string[] = [];
  const orgs: string[] = [];
  const events: string[] = [];
  const ipBase = randomInt(1, 200);
  async function signup(name: string, index: number) {
    const response = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: env.APP_ORIGIN,
        [CLIENT_IP_HEADER]: `198.51.100.${ipBase + index}`,
      },
      body: JSON.stringify({
        email: `${name}-${suffix}@example.com`,
        name,
        password: "correct-horse-battery-staple",
      }),
    });
    assert.equal(response.status, 200, await response.clone().text());
    const result = await response.json();
    users.push(result.user.id);
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    return { id: result.user.id as string, cookie };
  }
  function call(path: string, cookie: string, body?: unknown, target = app) {
    return target.request(path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        cookie,
        origin: env.APP_ORIGIN,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  function fixture(name: string, organizationId: string, userId: string) {
    return readFileSync(
      new URL(`../fixtures/stripe/${name}.json`, import.meta.url),
      "utf8",
    )
      .replaceAll("{{suffix}}", suffix)
      .replaceAll("{{organizationId}}", organizationId)
      .replaceAll("{{userId}}", userId);
  }
  async function deliver(payload: string, target = app) {
    events.push(JSON.parse(payload).id);
    const response = await target.request("/api/billing/webhook", {
      method: "POST",
      headers: { "stripe-signature": sign(payload) },
      body: payload,
    });
    return response;
  }
  async function delivered(payload: string) {
    const response = await deliver(payload);
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()) as { duplicate: boolean };
  }
  try {
    const owner = await signup("owner", 0);
    const admin = await signup("admin", 1);
    const member = await signup("member", 2);
    const outsider = await signup("outsider", 3);
    const created = await call("/api/auth/organization/create", owner.cookie, {
      name: "Kestrel",
      slug: `kestrel-${suffix}`,
    });
    assert.equal(created.status, 200, await created.clone().text());
    const org = (await created.json()) as { id: string };
    orgs.push(org.id);
    await db.insert(schema.member).values([
      {
        id: crypto.randomUUID(),
        organizationId: org.id,
        userId: admin.id,
        role: "admin",
      },
      {
        id: crypto.randomUUID(),
        organizationId: org.id,
        userId: member.id,
        role: "member",
      },
    ]);
    const billingPath = `/api/organizations/${org.id}/billing`;
    const summary = async (cookie: string) => {
      const response = await call(billingPath, cookie);
      assert.equal(response.status, 200, await response.clone().text());
      return response.json();
    };

    // A new organisation is on Free and can buy either configured plan.
    const fresh = await summary(owner.cookie);
    assert.equal(fresh.enabled, true);
    assert.equal(fresh.plan, "free");
    assert.equal(fresh.canManage, true);
    assert.equal(fresh.trialAvailable, true);
    assert.equal(fresh.hasBillingAccount, false);
    assert.deepEqual(fresh.purchasable, ["pro", "team"]);
    assert.deepEqual(fresh.organization, { id: org.id, name: "Kestrel" });

    // Members see the plan but cannot change it; outsiders see nothing.
    assert.equal((await summary(admin.cookie)).canManage, true);
    const viewer = await summary(member.cookie);
    assert.equal(viewer.canManage, false);
    assert.equal(viewer.plan, "free");
    for (const [path, body] of [
      [`${billingPath}/checkout`, { plan: "pro" }],
      [`${billingPath}/portal`, {}],
      [`${billingPath}/invoices`, undefined],
    ] as const)
      assert.equal((await call(path, member.cookie, body)).status, 403, path);
    assert.equal((await call(billingPath, outsider.cookie)).status, 403);
    assert.equal((await app.request(billingPath)).status, 401);
    assert.equal(checkouts.length, 0);

    // The owner is sent to Checkout with the plan's price and a trial.
    assert.equal(
      (await call(`${billingPath}/checkout`, owner.cookie, { plan: "free" }))
        .status,
      400,
    );
    const checkout = await call(`${billingPath}/checkout`, owner.cookie, {
      plan: "pro",
    });
    assert.equal(checkout.status, 200, await checkout.clone().text());
    assert.equal(
      (await checkout.json()).url,
      `https://checkout.stripe.com/c/pay/cs_test_${suffix}`,
    );
    assert.deepEqual(customers, [
      {
        organizationId: org.id,
        name: "Kestrel",
        email: `owner-${suffix}@example.com`,
      },
    ]);
    assert.deepEqual(checkouts[0], {
      customerId: `cus_${suffix}`,
      priceId: "price_pro_test",
      organizationId: org.id,
      userId: owner.id,
      plan: "pro",
      trialDays: 14,
      successUrl: `http://localhost:4300/organisations/${org.id}/billing?checkout=success`,
      cancelUrl: `http://localhost:4300/organisations/${org.id}/billing?checkout=cancelled`,
    });
    assert.ok(
      captured.some(
        (entry) =>
          entry.event === "billing.checkout_started" &&
          entry.userId === owner.id &&
          entry.plan === "pro",
      ),
    );

    // A forged delivery changes nothing and is not recorded.
    const completed = fixture("checkout.session.completed", org.id, owner.id);
    const forged = await app.request("/api/billing/webhook", {
      method: "POST",
      headers: { "stripe-signature": sign(completed, "whsec_wrong_secret") },
      body: completed,
    });
    assert.equal(forged.status, 400);
    assert.equal(
      (
        await db
          .select()
          .from(schema.billingEvents)
          .where(eq(schema.billingEvents.id, JSON.parse(completed).id))
      ).length,
      0,
    );

    // Payment: the plan is active as soon as Stripe reports the subscription.
    assert.equal((await delivered(completed)).duplicate, false);
    const subscriptionCreated = fixture(
      "customer.subscription.created",
      org.id,
      owner.id,
    );
    assert.equal((await delivered(subscriptionCreated)).duplicate, false);
    const active = await summary(owner.cookie);
    assert.equal(active.plan, "pro");
    assert.equal(active.subscription.status, "active");
    assert.equal(active.subscription.plan, "pro");
    assert.equal(
      active.subscription.currentPeriodEnd,
      new Date(1796198399000).toISOString(),
    );
    assert.equal(active.entitlements.seats, 5);
    assert.equal(active.hasBillingAccount, true);
    assert.equal(active.trialAvailable, false);
    assert.equal(active.paymentFailed, false);
    assert.equal((await summary(member.cookie)).plan, "pro");
    assert.deepEqual(await billing.entitlements(org.id), active.entitlements);
    assert.ok(
      captured.some(
        (entry) =>
          entry.event === "billing.subscribed" && entry.userId === owner.id,
      ),
    );

    // The same events delivered again are applied once.
    assert.equal((await delivered(completed)).duplicate, true);
    assert.equal((await delivered(subscriptionCreated)).duplicate, true);
    assert.equal(
      captured.filter((entry) => entry.event === "billing.subscribed").length,
      1,
    );

    // invoice.paid reaches the hook once, inside the webhook transaction.
    const invoicePaid = fixture("invoice.paid", org.id, owner.id);
    failNextInvoice = true;
    const failed = await deliver(invoicePaid);
    assert.equal(failed.status, 500);
    assert.equal(paid.length, 0);
    assert.equal((await delivered(invoicePaid)).duplicate, false);
    assert.equal((await delivered(invoicePaid)).duplicate, true);
    assert.equal(paid.length, 1);
    assert.deepEqual(paid[0], {
      eventId: `evt_invoice_paid_${suffix}`,
      invoiceId: `in_create_${suffix}`,
      organizationId: org.id,
      stripeCustomerId: `cus_${suffix}`,
      subscriptionId: `sub_${suffix}`,
      plan: "pro",
      amountPaid: 1900,
      currency: "usd",
      billingReason: "subscription_create",
      paidAt: new Date(1793520001000),
    });

    // A second checkout is refused while the subscription is live.
    assert.equal(
      (await call(`${billingPath}/checkout`, admin.cookie, { plan: "team" }))
        .status,
      409,
    );
    const portal = await call(`${billingPath}/portal`, admin.cookie, {});
    assert.equal(portal.status, 200);
    assert.deepEqual(portals, [
      {
        customerId: `cus_${suffix}`,
        returnUrl: `http://localhost:4300/organisations/${org.id}/billing`,
      },
    ]);
    const listed = await call(`${billingPath}/invoices`, owner.cookie);
    assert.equal(listed.status, 200);
    assert.deepEqual(await listed.json(), { invoices });

    // A failed renewal: admins see why, and the plan holds while Stripe retries.
    await delivered(fixture("invoice.payment_failed", org.id, owner.id));
    await delivered(
      fixture("customer.subscription.updated.past_due", org.id, owner.id),
    );
    const pastDue = await summary(owner.cookie);
    assert.equal(pastDue.paymentFailed, true);
    assert.equal(pastDue.subscription.status, "past_due");
    assert.ok(pastDue.subscription.paymentFailedAt);
    assert.equal(pastDue.plan, "pro");
    assert.ok(
      captured.some(
        (entry) =>
          entry.event === "billing.payment_failed" && entry.userId === owner.id,
      ),
    );

    // An older event that arrives late does not undo a newer one.
    const late = JSON.parse(subscriptionCreated);
    late.id = `evt_subscription_late_${suffix}`;
    late.type = "customer.subscription.updated";
    assert.equal((await delivered(JSON.stringify(late))).duplicate, false);
    assert.equal((await summary(owner.cookie)).subscription.status, "past_due");

    // An open subscription keeps the organisation from being deleted.
    const deletion = await call("/api/auth/organization/delete", owner.cookie, {
      organizationId: org.id,
    });
    assert.equal(deletion.status, 400);
    assert.match(await deletion.text(), /Cancel this organisation/);

    // Stripe gives up and cancels: entitlements drop to Free, with the reason.
    await delivered(fixture("customer.subscription.deleted", org.id, owner.id));
    const cancelled = await summary(owner.cookie);
    assert.equal(cancelled.plan, "free");
    assert.equal(cancelled.entitlements.seats, 1);
    assert.equal(cancelled.subscription.status, "canceled");
    assert.equal(cancelled.subscription.cancellationReason, "payment_failed");
    assert.ok(cancelled.subscription.endedAt);
    assert.equal(cancelled.paymentFailed, false);
    assert.ok(
      captured.some(
        (entry) =>
          entry.event === "billing.cancelled" &&
          entry.userId === owner.id &&
          entry.plan === "pro",
      ),
    );

    // Coming back reuses the customer and offers no second trial.
    assert.equal(
      (await call(`${billingPath}/checkout`, owner.cookie, { plan: "team" }))
        .status,
      200,
    );
    assert.equal(customers.length, 1);
    assert.equal(checkouts[1]?.trialDays, 0);

    // Events for a customer the app does not know are recorded and skipped.
    const stranger = JSON.parse(subscriptionCreated);
    stranger.id = `evt_unknown_customer_${suffix}`;
    stranger.data.object.id = `sub_unknown_${suffix}`;
    stranger.data.object.customer = `cus_unknown_${suffix}`;
    stranger.data.object.metadata = {};
    assert.equal((await delivered(JSON.stringify(stranger))).duplicate, false);
    assert.equal(
      (
        await db
          .select()
          .from(schema.subscriptions)
          .where(eq(schema.subscriptions.id, `sub_unknown_${suffix}`))
      ).length,
      0,
    );

    // Without Stripe keys the app runs, says billing is off and keeps the plan.
    const off = readEnvironment({
      ...process.env,
      DATABASE_URL: env.DATABASE_URL,
      BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
      BETTER_AUTH_URL: env.BETTER_AUTH_URL,
      APP_ORIGIN: env.APP_ORIGIN,
      LOG_LEVEL: "silent",
      STRIPE_SECRET_KEY: "",
      STRIPE_WEBHOOK_SECRET: "",
    });
    const offline = createApp(db, auth, off);
    const disabled = await call(billingPath, owner.cookie, undefined, offline);
    assert.equal(disabled.status, 200);
    const disabledSummary = await disabled.json();
    assert.equal(disabledSummary.enabled, false);
    assert.deepEqual(disabledSummary.purchasable, []);
    assert.equal(disabledSummary.plan, "free");
    assert.equal(
      (
        await call(
          `${billingPath}/checkout`,
          owner.cookie,
          { plan: "pro" },
          offline,
        )
      ).status,
      503,
    );
    assert.equal((await deliver(completed, offline)).status, 503);
  } finally {
    for (const id of orgs)
      await db
        .delete(schema.organization)
        .where(eq(schema.organization.id, id));
    if (events.length)
      await db
        .delete(schema.billingEvents)
        .where(inArray(schema.billingEvents.id, events));
    for (const id of users)
      await db.delete(schema.user).where(eq(schema.user.id, id));
    await pool.end();
  }
});
