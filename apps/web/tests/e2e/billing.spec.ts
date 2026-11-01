import { expect, type Page, test } from "@playwright/test";

// The API and Stripe are stubbed: these runs prove the page, not the payment.
// The webhook and the server side of each step are tested in apps/server.
const organization = { id: "org_e2e", name: "Acme" };
const billingUrl = `**/api/organizations/${organization.id}/billing`;
const free = {
  enabled: true,
  organization,
  canManage: true,
  plan: "free",
  entitlements: { seats: 1, projects: 3, features: [] },
  subscription: null,
  paymentFailed: false,
  hasBillingAccount: false,
  trialAvailable: true,
  purchasable: ["pro", "team"],
};
const subscription = {
  plan: "pro",
  status: "trialing",
  cancelAtPeriodEnd: false,
  cancelAt: null,
  currentPeriodEnd: "2026-12-15T00:00:00.000Z",
  trialEnd: "2026-12-15T00:00:00.000Z",
  endedAt: null,
  cancellationReason: null,
  paymentFailedAt: null,
};
const pro = {
  ...free,
  plan: "pro",
  entitlements: { seats: 5, projects: 25, features: ["apiAccess"] },
  subscription,
  hasBillingAccount: true,
  trialAvailable: false,
};

const runtimeErrors = new WeakMap<Page, string[]>();
test.afterEach(async ({ page }) => {
  expect(runtimeErrors.get(page) ?? []).toEqual([]);
});
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  runtimeErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().startsWith("Failed to load resource:")
    )
      errors.push(message.text());
  });
  const now = new Date().toISOString();
  await page.route("**/api/auth/get-session*", (route) =>
    route.fulfill({
      json: {
        session: {
          id: "session_e2e",
          userId: "user_e2e",
          activeOrganizationId: organization.id,
          expiresAt: "2027-01-01T00:00:00.000Z",
          createdAt: now,
          updatedAt: now,
        },
        user: {
          id: "user_e2e",
          name: "Owner",
          email: "owner@example.com",
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        },
      },
    }),
  );
  await page.route(`${billingUrl}/invoices`, (route) =>
    route.fulfill({ json: { invoices: [] } }),
  );
  await page.route("**/api/auth/list-sessions*", (route) =>
    route.fulfill({ json: [] }),
  );
});

test("an owner picks a plan, goes to Checkout and sees it active on return", async ({
  page,
}) => {
  let paid = false;
  await page.route(billingUrl, (route) =>
    route.fulfill({ json: paid ? pro : free }),
  );
  await page.route(`${billingUrl}/checkout`, (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({ plan: "pro" });
    return route.fulfill({
      json: { url: "https://checkout.stripe.com/c/pay/cs_test_e2e" },
    });
  });
  await page.route("https://checkout.stripe.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<title>Checkout</title><h1>Stripe Checkout</h1>",
    }),
  );
  await page.goto(`/organisations/${organization.id}/billing`);
  await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
  await page.getByRole("button", { name: "Try Pro free for 14 days" }).click();
  await expect(page).toHaveURL(/^https:\/\/checkout\.stripe\.com\//);
  await page.goto(`/organisations/${organization.id}/billing?checkout=success`);
  await expect(page.getByText(/Confirming the payment/)).toBeVisible();
  paid = true; // Stripe's webhook lands; the page notices on its next check.
  await expect(page.getByText("Thank you. Acme is on Pro.")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator(".plan-name")).toHaveText("Pro");
  await expect(
    page.getByRole("button", { name: "Manage billing" }),
  ).toBeVisible();
});

test("a member sees the plan but cannot change it", async ({ page }) => {
  await page.route(billingUrl, (route) =>
    route.fulfill({ json: { ...pro, canManage: false } }),
  );
  await page.goto(`/organisations/${organization.id}/billing`);
  await expect(page.locator(".plan-name")).toHaveText("Pro");
  await expect(
    page.getByText("Only owners and admins can change the plan."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Try|Choose|Manage billing/ }),
  ).toHaveCount(0);
});

test("without Stripe keys the billing page says billing is off", async ({
  page,
}) => {
  await page.route(billingUrl, (route) =>
    route.fulfill({ json: { ...free, enabled: false, purchasable: [] } }),
  );
  await page.goto(`/organisations/${organization.id}/billing`);
  await expect(
    page.getByText(
      "Billing is switched off because the server has no Stripe keys.",
      { exact: false },
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Try|Choose/ })).toHaveCount(0);
});

test("a failed payment shows admins a banner that leads to billing", async ({
  page,
}) => {
  await page.route(billingUrl, (route) =>
    route.fulfill({
      json: {
        ...pro,
        paymentFailed: true,
        subscription: { ...subscription, status: "past_due" },
      },
    }),
  );
  await page.goto("/account");
  const banner = page.locator(".billing-banner");
  await expect(banner).toContainText("A payment for Acme failed.");
  await banner.getByRole("link", { name: "Go to billing" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/organisations/${organization.id}/billing$`),
  );
  await expect(banner).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Update payment method" }),
  ).toBeVisible();
});
