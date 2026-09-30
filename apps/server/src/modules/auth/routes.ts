import { Hono } from "hono";
import type { AppEnv } from "../../lib/context.js";
import type { Auth } from "./auth.js";
// Better Auth exposes sign-in/email, sign-up/email, sign-out, get-session,
// password recovery and organisation endpoints beneath this mount.
export function authRoutes(auth: Auth) {
  return new Hono<AppEnv>().all("/*", (c) => auth.handler(c.req.raw));
}
