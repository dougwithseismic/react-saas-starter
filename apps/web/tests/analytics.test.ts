import { expect, it, vi } from "vitest";
import {
  analyticsPath,
  createClientAnalytics,
} from "../src/lib/analytics-core";

it("drops credential properties and sensitive invitation URL state", () => {
  const track = vi.fn();
  const analytics = createClientAnalytics([{ name: "test", track }]);
  analytics.track("account_action_completed", {
    action: "profile",
    email: "member@example.com",
    password: "secret",
    reset_token: "secret",
    apiSecret: "secret",
    count: 1,
  });
  expect(track).toHaveBeenCalledWith("account_action_completed", {
    action: "profile",
    count: 1,
  });
  expect(analyticsPath("/invitations/private-id?token=secret#hash")).toBe(
    "/invitations/:id",
  );
  expect(analyticsPath("/reset-password?token=secret")).toBe("/reset-password");
});
it("resets prior identity before identifying another account", () => {
  const identify = vi.fn(),
    reset = vi.fn();
  const analytics = createClientAnalytics([
    { name: "test", track: vi.fn(), identify, reset },
  ]);
  analytics.identify("first");
  analytics.identify("first");
  analytics.identify("second");
  analytics.identify(null);
  expect(identify.mock.calls).toEqual([["first"], ["second"]]);
  expect(reset).toHaveBeenCalledTimes(2);
  expect(reset.mock.invocationCallOrder[0]).toBeLessThan(
    identify.mock.invocationCallOrder[1] ?? 0,
  );
});
it("isolates a failing plugin while delivering to the next plugin", () => {
  const track = vi.fn();
  const analytics = createClientAnalytics([
    {
      name: "broken",
      track() {
        throw new Error("offline");
      },
    },
    { name: "working", track },
  ]);
  expect(() => analytics.track("event")).not.toThrow();
  expect(track).toHaveBeenCalledWith("event", {});
});
