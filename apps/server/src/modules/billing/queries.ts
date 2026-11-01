import { isEntitled } from "@repo/contracts";
import { type Database, desc, eq, schema } from "@repo/db";

export type SubscriptionRow = typeof schema.subscriptions.$inferSelect;

// A subscription Stripe may still charge. Incomplete ones expire by
// themselves, so they block neither a new checkout nor deletion.
export function isOpen(status: string) {
  return !["canceled", "incomplete", "incomplete_expired"].includes(status);
}

// The organisation's subscriptions, newest first, with the one that decides
// its plan: the live one, or else the latest so the page can say what ended.
export async function organizationSubscriptions(
  db: Database,
  organizationId: string,
) {
  const rows = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.organizationId, organizationId))
    .orderBy(desc(schema.subscriptions.createdAt));
  const current = rows.find((row) => isEntitled(row.status)) ?? rows[0] ?? null;
  return { rows, current, open: rows.find((row) => isOpen(row.status)) };
}
