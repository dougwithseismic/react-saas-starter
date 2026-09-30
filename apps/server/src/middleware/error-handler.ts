import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../lib/context.js";
import type { Logger } from "../lib/logger.js";
export function errorHandler(logger: Logger): ErrorHandler<AppEnv> {
  return (error, c) => {
    const requestId = c.get("requestId");
    if (error instanceof HTTPException)
      return c.json(
        {
          error: {
            code: error.status === 401 ? "UNAUTHORIZED" : "REQUEST_ERROR",
            message: error.message,
            requestId,
          },
        },
        error.status,
      );
    logger.error({ requestId, errorName: error.name }, "request failed");
    return c.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "The request could not be completed",
          requestId,
        },
      },
      500,
    );
  };
}
