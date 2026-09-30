import type { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import type { AppEnv } from "../../lib/context.js";
import type { Auth } from "../auth/auth.js";
export function registerDocumentation(app: OpenAPIHono<AppEnv>, auth: Auth) {
  app.get("/openapi.json", async (c) => {
    const authDocument = await auth.api.generateOpenAPISchema();
    const document = app.getOpenAPIDocument({
      openapi: "3.0.0",
      info: { title: "Account API", version: "1.0.0" },
    });
    const paths = Object.fromEntries(
      Object.entries(authDocument.paths ?? {}).map(([path, value]) => [
        path.startsWith("/api/auth/") ? path : `/api/auth${path}`,
        value,
      ]),
    );
    return c.json({
      ...document,
      paths: { ...document.paths, ...paths },
      components: {
        ...document.components,
        schemas: {
          ...document.components?.schemas,
          ...authDocument.components?.schemas,
        },
        securitySchemes: {
          ...authDocument.components?.securitySchemes,
          ...document.components?.securitySchemes,
        },
      },
    });
  });
  app.get("/docs", Scalar({ url: "/openapi.json", theme: "default" }));
}
