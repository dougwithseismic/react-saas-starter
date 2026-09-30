import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { healthResponseSchema } from "@repo/contracts";
import { type Database, sql } from "@repo/db";
import type { AppEnv } from "../../lib/context.js";

const content = { "application/json": { schema: healthResponseSchema } };
export function healthRoutes(db: Database) {
  return new OpenAPIHono<AppEnv>()
    .openapi(
      createRoute({
        method: "get",
        path: "/health",
        tags: ["Health"],
        responses: { 200: { description: "Process is alive", content } },
      }),
      (c) => c.json({ status: "ok" as const }, 200),
    )
    .openapi(
      createRoute({
        method: "get",
        path: "/health/ready",
        tags: ["Health"],
        responses: {
          200: { description: "Database is available", content },
          503: { description: "Database unavailable", content },
        },
      }),
      async (c) => {
        try {
          await db.execute(sql`select 1`);
          return c.json({ status: "ready" as const }, 200);
        } catch {
          return c.json({ status: "unavailable" as const }, 503);
        }
      },
    );
}
