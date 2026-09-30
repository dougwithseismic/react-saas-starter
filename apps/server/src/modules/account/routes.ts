import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { accountResponseSchema, errorResponseSchema } from "@repo/contracts";
import type { AppEnv } from "../../lib/context.js";
import { authenticated } from "../../middleware/authenticated.js";
import type { Auth } from "../auth/auth.js";
export function accountRoutes(auth: Auth) {
  const routes = new OpenAPIHono<AppEnv>();
  routes.use("/me", authenticated(auth));
  return routes.openapi(
    createRoute({
      method: "get",
      path: "/me",
      tags: ["Account"],
      security: [{ sessionCookie: [] }],
      responses: {
        200: {
          description: "Current account without session credentials",
          content: { "application/json": { schema: accountResponseSchema } },
        },
        401: {
          description: "Authentication required",
          content: { "application/json": { schema: errorResponseSchema } },
        },
      },
    }),
    (c) => {
      const user = c.get("session").user;
      return c.json(
        {
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            emailVerified: user.emailVerified,
            image: user.image ?? null,
          },
        },
        200,
      );
    },
  );
}
