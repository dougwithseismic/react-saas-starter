import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

// Applies the reviewed SQL in packages/db/drizzle with the same journal table
// as drizzle-kit, so either runner sees the other's history. Already applied
// migrations are skipped, so running it again is a no-op.
export async function migrateDatabase(
  connectionString: string,
  migrationsFolder: string,
) {
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 10_000,
  });
  try {
    await migrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}
