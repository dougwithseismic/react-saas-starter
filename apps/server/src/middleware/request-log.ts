import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../lib/context.js";
import type { Logger } from "../lib/logger.js";
export function requestLog(logger: Logger) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const start = performance.now();
    await next();
    logger.info(
      {
        requestId: c.get("requestId"),
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Math.round(performance.now() - start),
      },
      "request completed",
    );
  });
}
