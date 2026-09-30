import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../lib/context.js";
import type { Auth } from "../modules/auth/auth.js";
export function authenticated(auth: Auth) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session)
      throw new HTTPException(401, { message: "Sign in to continue" });
    c.set("session", session);
    await next();
  });
}
