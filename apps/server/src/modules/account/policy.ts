import { type Database, eq, schema } from "@repo/db";
import { APIError } from "better-auth/api";
export function guardAccountDeletion(db: Database) {
  return async (user: { id: string }) => {
    const owned = await db
      .select()
      .from(schema.member)
      .where(eq(schema.member.userId, user.id));
    for (const membership of owned.filter((m) =>
      m.role.split(",").includes("owner"),
    )) {
      const owners = await db
        .select()
        .from(schema.member)
        .where(eq(schema.member.organizationId, membership.organizationId));
      if (owners.filter((m) => m.role.split(",").includes("owner")).length < 2)
        throw new APIError("BAD_REQUEST", {
          message:
            "Transfer ownership or delete your organisations before deleting your account.",
        });
    }
  };
}
