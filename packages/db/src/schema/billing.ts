import { boolean, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organization } from "./organizations.js";

const at = (name: string) => timestamp(name, { withTimezone: true });

// One Stripe customer per organisation, created on its first checkout.
export const billingCustomers = pgTable("billing_customers", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  stripeCustomerId: text("stripe_customer_id").notNull().unique(),
  createdAt: at("created_at").defaultNow().notNull(),
});

// Mirrors Stripe subscriptions; only the webhook writes it. The id is
// Stripe's subscription id.
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    stripePriceId: text("stripe_price_id"),
    // Plan id from packages/contracts, or null for a price not in the config.
    plan: text("plan"),
    status: text("status").notNull(),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),
    cancelAt: at("cancel_at"),
    canceledAt: at("canceled_at"),
    endedAt: at("ended_at"),
    cancellationReason: text("cancellation_reason"),
    trialStart: at("trial_start"),
    trialEnd: at("trial_end"),
    currentPeriodStart: at("current_period_start"),
    currentPeriodEnd: at("current_period_end"),
    // Set by invoice.payment_failed, cleared by invoice.paid.
    paymentFailedAt: at("payment_failed_at"),
    // Creation time of the last Stripe event applied. Stripe does not promise
    // order, so an older event never overwrites a newer one.
    stripeEventAt: at("stripe_event_at").notNull(),
    createdAt: at("created_at").defaultNow().notNull(),
    updatedAt: at("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("subscriptions_org_idx").on(t.organizationId)],
);

// Stripe event ids already applied, so a redelivered event is applied once.
export const billingEvents = pgTable("billing_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  stripeCreatedAt: at("stripe_created_at").notNull(),
  processedAt: at("processed_at").defaultNow().notNull(),
});
