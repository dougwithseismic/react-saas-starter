import { OpenAPIHono } from "@hono/zod-openapi";
import type { Database } from "@repo/db";
import type { AppEnv } from "../lib/context.js";
import { accountRoutes } from "../modules/account/routes.js";
import type { Auth } from "../modules/auth/auth.js";
import { authRoutes } from "../modules/auth/routes.js";
import { healthRoutes } from "../modules/health/routes.js";
export function apiRoutes(db: Database, auth: Auth) {
  return new OpenAPIHono<AppEnv>()
    .route("/api/auth", authRoutes(auth))
    .route("/api", accountRoutes(auth))
    .route("/", healthRoutes(db));
}
