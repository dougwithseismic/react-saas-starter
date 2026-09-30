import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/get-session*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "null",
    }),
  );
});
test("private account URL leads to a working sign-in form", async ({
  page,
}) => {
  await page.goto("/account");
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
});
test("server authentication errors remain actionable", async ({ page }) => {
  await page.route("**/api/auth/sign-in/email", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        code: "INVALID_EMAIL_OR_PASSWORD",
        message: "Invalid email or password",
      }),
    }),
  );
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill("member@example.com");
  await page.getByLabel("Password", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByRole("alert")).toContainText(
    /invalid email or password/i,
  );
  await expect(page.getByRole("button", { name: /sign in/i })).toBeEnabled();
});

test("invitation links preserve the return destination through sign-in", async ({
  page,
}) => {
  await page.goto("/invitations/example");
  await expect(page).toHaveURL(/\/sign-in/);
  expect(new URL(page.url()).searchParams.get("redirect")).toBe(
    "/invitations/example",
  );
});

test("missing reset tokens give a recovery link instead of submitting an invalid request", async ({
  page,
}) => {
  await page.goto("/reset-password");
  await expect(page.getByRole("alert")).toContainText(/invalid or expired/i);
  await expect(
    page.getByRole("link", { name: "Forgot password?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save new password" }),
  ).toHaveCount(0);
});
