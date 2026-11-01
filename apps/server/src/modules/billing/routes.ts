import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import {
  billingRedirectSchema,
  billingSummarySchema,
  checkoutInputSchema,
  errorResponseSchema,
  invoiceListSchema,
} from "@repo/contracts";
import { z } from "zod";
import type { AppEnv } from "../../lib/context.js";
import { authenticated } from "../../middleware/authenticated.js";
import type { Auth } from "../auth/auth.js";
import type { Billing } from "./service.js";

const params = z.object({ organizationId: z.string().min(1).max(200) });
const json = <T extends z.ZodType>(schema: T) => ({
  "application/json": { schema },
});
const errors = {
  401: {
    description: "Authentication required",
    content: json(errorResponseSchema),
  },
  403: {
    description: "Not a member, or not an owner or admin",
    content: json(errorResponseSchema),
  },
  503: {
    description: "Billing is switched off",
    content: json(errorResponseSchema),
  },
};
const security = [{ sessionCookie: [] }];

export function billingRoutes(auth: Auth, billing: Billing) {
  const routes = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success)
        return c.json(
          {
            error: {
              code: "INVALID_REQUEST",
              message: "Choose a valid plan",
              requestId: c.get("requestId"),
            },
          },
          400,
        );
    },
  });
  routes.use("/organizations/*", authenticated(auth));
  // Stripe calls this with a signed raw body; it is not a browser endpoint.
  routes.post("/billing/webhook", async (c) => {
    const signature = c.req.header("stripe-signature");
    if (!signature)
      return c.json(
        {
          error: {
            code: "REQUEST_ERROR",
            message: "Missing Stripe signature",
            requestId: c.get("requestId"),
          },
        },
        400,
      );
    const result = await billing.receiveWebhook(await c.req.text(), signature);
    return c.json({ received: true, duplicate: result.duplicate }, 200);
  });
  return routes
    .openapi(
      createRoute({
        method: "get",
        path: "/organizations/{organizationId}/billing",
        tags: ["Billing"],
        security,
        request: { params },
        responses: {
          200: {
            description: "Plan, entitlements and subscription state",
            content: json(billingSummarySchema),
          },
          401: errors[401],
          403: errors[403],
        },
      }),
      async (c) =>
        c.json(
          await billing.summary(
            c.req.valid("param").organizationId,
            c.get("session").user.id,
          ),
          200,
        ),
    )
    .openapi(
      createRoute({
        method: "post",
        path: "/organizations/{organizationId}/billing/checkout",
        tags: ["Billing"],
        security,
        request: {
          params,
          body: { content: json(checkoutInputSchema), required: true },
        },
        responses: {
          200: {
            description: "Stripe Checkout URL",
            content: json(billingRedirectSchema),
          },
          ...errors,
          409: {
            description: "The organisation already has a subscription",
            content: json(errorResponseSchema),
          },
        },
      }),
      async (c) => {
        const user = c.get("session").user;
        const url = await billing.startCheckout(
          c.req.valid("param").organizationId,
          { id: user.id, email: user.email },
          c.req.valid("json").plan,
        );
        return c.json({ url }, 200);
      },
    )
    .openapi(
      createRoute({
        method: "post",
        path: "/organizations/{organizationId}/billing/portal",
        tags: ["Billing"],
        security,
        request: { params },
        responses: {
          200: {
            description: "Stripe Customer Portal URL",
            content: json(billingRedirectSchema),
          },
          ...errors,
          409: {
            description: "No billing account yet",
            content: json(errorResponseSchema),
          },
        },
      }),
      async (c) => {
        const url = await billing.openPortal(
          c.req.valid("param").organizationId,
          c.get("session").user.id,
        );
        return c.json({ url }, 200);
      },
    )
    .openapi(
      createRoute({
        method: "get",
        path: "/organizations/{organizationId}/billing/invoices",
        tags: ["Billing"],
        security,
        request: { params },
        responses: {
          200: {
            description: "Recent invoices, newest first",
            content: json(invoiceListSchema),
          },
          ...errors,
        },
      }),
      async (c) =>
        c.json(
          {
            invoices: await billing.invoices(
              c.req.valid("param").organizationId,
              c.get("session").user.id,
            ),
          },
          200,
        ),
    );
}
