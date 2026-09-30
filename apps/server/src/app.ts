import { OpenAPIHono } from "@hono/zod-openapi";
import type { Database } from "@repo/db";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import type { Environment } from "./config/env.js";
import type { AppEnv } from "./lib/context.js";
import { createLogger, type Logger } from "./lib/logger.js";
import { errorHandler } from "./middleware/error-handler.js";
import { requestLog } from "./middleware/request-log.js";
import type { Auth } from "./modules/auth/auth.js";
import { registerDocumentation } from "./modules/docs/routes.js";
import { apiRoutes } from "./routes/index.js";
export function createApp(
  db: Database,
  auth: Auth,
  env: Environment,
  logger: Logger = createLogger(env),
) {
  const app = new OpenAPIHono<AppEnv>();
  app.use("*", requestId());
  app.use("*", requestLog(logger));
  app.use("*", secureHeaders());
  app.use(
    "*",
    cors({
      origin: env.APP_ORIGIN,
      credentials: true,
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type"],
      exposeHeaders: ["X-Request-Id"],
    }),
  );
  app.use(
    "*",
    bodyLimit({
      maxSize: 1024 * 1024,
      onError: (c) =>
        c.json(
          {
            error: {
              code: "PAYLOAD_TOO_LARGE",
              message: "Request exceeds 1 MB",
              requestId: c.get("requestId"),
            },
          },
          413,
        ),
    }),
  );
  app.onError(errorHandler(logger));
  const routes = app.route("/", apiRoutes(db, auth));
  app.openAPIRegistry.registerComponent("securitySchemes", "sessionCookie", {
    type: "apiKey",
    in: "cookie",
    name:
      env.NODE_ENV === "production"
        ? "__Secure-better-auth.session_token"
        : "better-auth.session_token",
  });
  registerDocumentation(app, auth);
  app.notFound((c) =>
    c.json(
      {
        error: {
          code: "NOT_FOUND",
          message: "Route not found",
          requestId: c.get("requestId"),
        },
      },
      404,
    ),
  );
  return routes;
}
export type AppType = ReturnType<typeof createApp>;
