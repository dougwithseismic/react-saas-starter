import {
  type BillingSubscription,
  type BillingSummary,
  entitlementsFor,
} from "@repo/contracts";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { PaymentAlert } from "../src/features/billing/banner";
import { formatMoney, subscriptionStatus } from "../src/features/billing/copy";
import { BillingDetails } from "../src/features/billing/page";

const subscription = (
  overrides: Partial<BillingSubscription> = {},
): BillingSubscription => ({
  plan: "pro",
  status: "active",
  cancelAtPeriodEnd: false,
  cancelAt: null,
  currentPeriodEnd: "2026-12-01T00:00:00.000Z",
  trialEnd: null,
  endedAt: null,
  cancellationReason: null,
  paymentFailedAt: null,
  ...overrides,
});
const summary = (overrides: Partial<BillingSummary> = {}): BillingSummary => ({
  enabled: true,
  organization: { id: "org_1", name: "Acme" },
  canManage: true,
  plan: "free",
  entitlements: entitlementsFor("free"),
  subscription: null,
  paymentFailed: false,
  hasBillingAccount: false,
  trialAvailable: true,
  purchasable: ["pro", "team"],
  ...overrides,
});
const pro = (overrides: Partial<BillingSummary> = {}) =>
  summary({
    plan: "pro",
    entitlements: entitlementsFor("pro"),
    subscription: subscription(),
    hasBillingAccount: true,
    trialAvailable: false,
    ...overrides,
  });
function details(
  value: BillingSummary,
  invoices: ComponentProps<typeof BillingDetails>["invoices"] = {
    retry: vi.fn(),
  },
) {
  const onCheckout = vi.fn(),
    onPortal = vi.fn();
  render(
    <BillingDetails
      summary={value}
      invoices={invoices}
      onCheckout={onCheckout}
      onPortal={onPortal}
    />,
  );
  return { onCheckout, onPortal };
}
async function withRouter(ui: ReactNode) {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const router = createRouter({
    routeTree: createRootRoute({ component: () => ui }),
    history: createMemoryHistory(),
  });
  render(<RouterProvider router={router} />);
  await router.load();
}

describe("billing page", () => {
  it("lets an owner or admin start Checkout, with a trial on the first subscription", async () => {
    const { onCheckout } = details(summary());
    expect(screen.getByRole("article", { name: "Free" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Try Pro free for 14 days" }),
    );
    expect(onCheckout).toHaveBeenCalledWith("pro");
    expect(
      screen.getByRole("button", { name: "Try Team free for 14 days" }),
    ).toBeEnabled();
    // No Stripe customer yet, so there is nothing to manage.
    expect(screen.queryByRole("button", { name: "Manage billing" })).toBeNull();
  });
  it("shows a member the plan but no way to change it", () => {
    details(pro({ canManage: false }));
    expect(screen.getByText("Pro", { selector: ".plan-name" })).toBeVisible();
    expect(
      screen.getByText("Only owners and admins can change the plan."),
    ).toBeVisible();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByRole("heading", { name: "Invoices" })).toBeNull();
  });
  it("sends plan changes on a live subscription to the portal", async () => {
    const { onPortal, onCheckout } = details(pro(), {
      data: [
        {
          id: "in_1",
          number: "ACME-0001",
          status: "paid",
          total: 1900,
          amountPaid: 1900,
          currency: "usd",
          createdAt: "2026-11-01T00:00:00.000Z",
          hostedInvoiceUrl: "https://invoice.stripe.com/i/test",
          invoicePdf: null,
        },
      ],
      retry: vi.fn(),
    });
    const team = screen.getByRole("article", { name: "Team" });
    expect(within(team).queryByRole("button")).toBeNull();
    expect(
      screen.getByText(/To switch plans, use Manage billing/),
    ).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: "Manage billing" }),
    );
    expect(onPortal).toHaveBeenCalledOnce();
    expect(onCheckout).not.toHaveBeenCalled();
    expect(screen.getByText(/19\.00/)).toBeVisible();
    expect(screen.getByText(/ACME-0001 · Paid/)).toBeVisible();
    expect(screen.getByRole("link", { name: "View" })).toHaveAttribute(
      "href",
      "https://invoice.stripe.com/i/test",
    );
  });
  it("tells admins a payment failed and how to fix it", async () => {
    const { onPortal } = details(
      pro({
        paymentFailed: true,
        subscription: subscription({ status: "past_due" }),
      }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "A payment for Acme failed. Update the card to keep Pro",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Update payment method" }),
    );
    expect(onPortal).toHaveBeenCalledOnce();
  });
  it("says why a cancelled subscription ended", () => {
    const ended = summary({
      subscription: subscription({
        status: "canceled",
        endedAt: "2026-12-01T00:00:00.000Z",
        cancellationReason: "payment_failed",
      }),
      hasBillingAccount: true,
      trialAvailable: false,
    });
    details(ended);
    expect(subscriptionStatus(ended)).toMatch(
      /^The subscription ended on .+ because a payment failed\.$/,
    );
    expect(screen.getByText(subscriptionStatus(ended))).toBeVisible();
    expect(screen.getByRole("button", { name: "Choose Pro" })).toBeVisible();
  });
  it("says billing is switched off and offers nothing to buy without Stripe keys", () => {
    details(summary({ enabled: false, purchasable: [] }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Billing is switched off because the server has no Stripe keys.",
    );
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
  it("marks a plan with no Stripe price as not available", () => {
    details(summary({ purchasable: ["pro"] }));
    expect(
      within(screen.getByRole("article", { name: "Team" })).getByText(
        "Not available yet.",
      ),
    ).toBeVisible();
  });
  it("formats amounts in the currency's smallest unit", () => {
    expect(formatMoney(1900, "usd")).toMatch(/19\.00/);
    expect(formatMoney(1900, "jpy")).toMatch(/1,900/);
    expect(formatMoney(1900, "jpy")).not.toMatch(/19\.00/);
  });
});

describe("payment banner", () => {
  it("links owners and admins to billing when a payment failed", async () => {
    await withRouter(<PaymentAlert summary={pro({ paymentFailed: true })} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A payment for Acme failed.",
    );
    expect(screen.getByRole("link", { name: "Go to billing" })).toHaveAttribute(
      "href",
      "/organisations/org_1/billing",
    );
  });
  it("stays hidden from members and when payments are fine", async () => {
    await withRouter(
      <>
        <PaymentAlert
          summary={pro({ paymentFailed: true, canManage: false })}
        />
        <PaymentAlert summary={pro()} />
        <p>Page</p>
      </>,
    );
    expect(await screen.findByText("Page")).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
