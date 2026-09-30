import { serve } from "@hono/node-server";
import { createDatabase } from "@repo/db";
import { createApp } from "./app.js";
import { readEnvironment } from "./config/env.js";
import { withClientIp } from "./lib/client-ip.js";
import { createLogger } from "./lib/logger.js";
import { createAnalytics } from "./modules/analytics/analytics.js";
import { createAuth } from "./modules/auth/auth.js";

const env = readEnvironment();
const { db, pool } = createDatabase(env.DATABASE_URL);
const logger = createLogger(env);
pool.on("error", (error) => {
  const code =
    "code" in error && typeof error.code === "string" ? error.code : undefined;
  logger.error(
    { errorName: error.name, errorCode: code },
    "Idle database connection failed",
  );
});
const analytics = createAnalytics(env, logger);
const app = createApp(db, createAuth(db, env, analytics), env, logger);
const server = serve({
  fetch: (request, bindings) =>
    app.fetch(
      withClientIp(
        request,
        bindings.incoming.socket.remoteAddress,
        env.TRUSTED_PROXY_IPS,
      ),
    ),
  port: env.PORT,
});
logger.info({ port: env.PORT }, "API started");
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  server.close(async () => {
    await analytics.shutdown();
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
