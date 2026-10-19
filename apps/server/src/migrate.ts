import { fileURLToPath } from "node:url";
import { migrateDatabase } from "@repo/db/migrate";
import pino from "pino";

// Production migration entry: `node apps/server/dist/migrate.mjs`. It runs as
// a pre-deploy step or one-shot container, never inside the API process, and
// needs no package manager, so it works in the read-only runtime image.
const logger = pino({ base: { service: "migrate" } });
const url = process.env.DATABASE_URL;
if (!url) {
  logger.error("DATABASE_URL is required");
  process.exit(1);
}
const folder = fileURLToPath(
  new URL("../../../packages/db/drizzle", import.meta.url),
);
try {
  await migrateDatabase(url, folder);
  logger.info({ folder }, "Migrations applied");
} catch (error) {
  // Drizzle wraps driver errors; the cause carries the connection or SQL code.
  const cause = error instanceof Error ? (error.cause ?? error) : error;
  const detail = cause instanceof Error ? cause : new Error("Migration failed");
  const code =
    "code" in detail && typeof detail.code === "string"
      ? detail.code
      : undefined;
  logger.error(
    { errorName: detail.name, errorCode: code },
    `Migration failed: ${detail.message}`,
  );
  process.exit(1);
}
