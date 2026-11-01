import type { Invoice, PaidPlanId } from "@repo/contracts";
import Stripe from "stripe";

// The Stripe calls billing makes, behind one interface so tests can replace
// them. Webhook signatures are checked with the Stripe SDK directly.
export interface BillingGateway {
  createCustomer(input: {
    organizationId: string;
    name: string;
    email: string;
  }): Promise<string>;
  createCheckout(input: {
    customerId: string;
    priceId: string;
    organizationId: string;
    userId: string;
    plan: PaidPlanId;
    trialDays: number;
    successUrl: string;
    cancelUrl: string;
  }): Promise<string>;
  createPortal(input: {
    customerId: string;
    returnUrl: string;
  }): Promise<string>;
  listInvoices(customerId: string): Promise<Invoice[]>;
}

export function createStripeClient(secretKey: string) {
  return new Stripe(secretKey, { maxNetworkRetries: 2, timeout: 10_000 });
}

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

export function createStripeGateway(stripe: Stripe): BillingGateway {
  return {
    async createCustomer({ organizationId, name, email }) {
      // The key makes concurrent first checkouts share one customer.
      const customer = await stripe.customers.create(
        { name, email, metadata: { organizationId } },
        { idempotencyKey: `organization-customer-${organizationId}` },
      );
      return customer.id;
    },
    async createCheckout(input) {
      const metadata = {
        organizationId: input.organizationId,
        userId: input.userId,
        plan: input.plan,
      };
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: input.customerId,
        client_reference_id: input.organizationId,
        line_items: [{ price: input.priceId, quantity: 1 }],
        allow_promotion_codes: true,
        metadata,
        subscription_data: {
          metadata,
          ...(input.trialDays > 0
            ? { trial_period_days: input.trialDays }
            : {}),
        },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      });
      if (!session.url) throw new Error("Checkout session has no URL");
      return session.url;
    },
    async createPortal({ customerId, returnUrl }) {
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      });
      return session.url;
    },
    async listInvoices(customerId) {
      const invoices = await stripe.invoices.list({
        customer: customerId,
        limit: 24,
      });
      return invoices.data.flatMap((invoice) =>
        invoice.id && invoice.status !== "draft"
          ? [
              {
                id: invoice.id,
                number: invoice.number,
                status: invoice.status,
                total: invoice.total,
                amountPaid: invoice.amount_paid,
                currency: invoice.currency,
                createdAt: iso(invoice.created),
                hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
                invoicePdf: invoice.invoice_pdf ?? null,
              },
            ]
          : [],
      );
    },
  };
}
