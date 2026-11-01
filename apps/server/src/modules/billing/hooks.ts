import type { Database } from "@repo/db";

export type BillingTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

// A paid invoice, resolved to the organisation that owns it. Amounts are in
// the currency's smallest unit, as Stripe sends them.
export type InvoicePaid = {
  eventId: string;
  invoiceId: string;
  organizationId: string;
  stripeCustomerId: string;
  subscriptionId: string | null;
  plan: string | null;
  amountPaid: number;
  currency: string;
  billingReason: string | null;
  paidAt: Date;
};

// Other modules subscribe here; an affiliate module, for example, writes a
// commission when an attributed organisation pays. Listeners run inside the
// webhook's transaction with the event's processed-id insert, so their writes
// happen once per Stripe event. A listener that throws rolls the event back;
// the webhook answers 500 and Stripe delivers it again later.
export type BillingHooks = {
  invoicePaid?: Array<
    (invoice: InvoicePaid, tx: BillingTransaction) => Promise<void>
  >;
};
