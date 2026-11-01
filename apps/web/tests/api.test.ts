import { accountResponseSchema, billingRedirectSchema } from "@repo/contracts";
import { afterEach, expect, it, vi } from "vitest";
import { api, post } from "../src/lib/api";

afterEach(() => vi.unstubAllGlobals());
it("decodes account DTOs and omits unexpected sensitive fields", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          user: {
            id: "1",
            name: "Member",
            email: "member@example.com",
            emailVerified: true,
            password: "secret",
          },
          session: { token: "secret" },
        }),
        { status: 200 },
      ),
    ),
  );
  const result = await api("/api/me", accountResponseSchema);
  expect(result).toEqual({
    user: {
      id: "1",
      name: "Member",
      email: "member@example.com",
      emailVerified: true,
    },
  });
  expect(fetch).toHaveBeenCalledWith(
    "/api/me",
    expect.objectContaining({ credentials: "include" }),
  );
});
it("preserves HTTP status for authentication and retry decisions", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "UNAUTHORIZED", message: "Sign in to continue" },
        }),
        { status: 401 },
      ),
    ),
  );
  await expect(api("/api/me", accountResponseSchema)).rejects.toMatchObject({
    status: 401,
    code: "UNAUTHORIZED",
    message: "Sign in to continue",
  });
});
it("rejects malformed success responses instead of caching them as accounts", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("{}", { status: 200 })),
  );
  await expect(api("/api/me", accountResponseSchema)).rejects.toThrow();
});
it("posts JSON with the session cookie and decodes the reply", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ url: "https://checkout.stripe.com/c/pay/test" }),
          { status: 200 },
        ),
      ),
  );
  const result = await post("/api/checkout", billingRedirectSchema, {
    plan: "pro",
  });
  expect(result.url).toBe("https://checkout.stripe.com/c/pay/test");
  expect(fetch).toHaveBeenCalledWith(
    "/api/checkout",
    expect.objectContaining({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ plan: "pro" }),
      headers: expect.objectContaining({ "Content-Type": "application/json" }),
    }),
  );
});
