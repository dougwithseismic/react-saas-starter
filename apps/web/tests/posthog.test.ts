import { afterEach, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
}));
vi.mock("posthog-js", () => ({ default: sdk }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
});
it("is disabled with no public project key", async () => {
  vi.stubEnv("VITE_POSTHOG_PROJECT_KEY", "");
  const { analytics } = await import("../src/lib/analytics");
  analytics.track("account_action_completed");
  expect(sdk.init).not.toHaveBeenCalled();
});
it("wires the configured adapter and scrubs SDK URL super-properties", async () => {
  vi.stubEnv("VITE_POSTHOG_PROJECT_KEY", "phc_test");
  vi.stubEnv("VITE_POSTHOG_HOST", "https://eu.i.posthog.com");
  const { analytics } = await import("../src/lib/analytics");
  analytics.identify("user-id");
  analytics.track("auth_flow_completed", { action: "sign-in" });
  analytics.reset();
  await vi.waitFor(() => expect(sdk.capture).toHaveBeenCalled());
  expect(sdk.init).toHaveBeenCalledWith(
    "phc_test",
    expect.objectContaining({
      api_host: "https://eu.i.posthog.com",
      autocapture: false,
      disable_session_recording: true,
    }),
  );
  const config = sdk.init.mock.calls[0]?.[1];
  const payload = config.before_send({
    event: "$pageview",
    properties: {
      $current_url: "https://app.example.com/reset-password?token=secret#hash",
      $pathname: "/invitations/private-id",
      email: "member@example.com",
      $set: {
        $initial_current_url:
          "https://app.example.com/invitations/private-id?token=secret",
      },
    },
  });
  expect(payload.properties.$current_url).toBe(
    "https://app.example.com/reset-password",
  );
  expect(payload.properties.$pathname).toBe("/invitations/:id");
  expect(payload.properties.email).toBeUndefined();
  expect(payload.properties.$set.$initial_current_url).toBe(
    "https://app.example.com/invitations/:id",
  );
  expect(sdk.identify).toHaveBeenCalledWith("user-id");
  expect(sdk.reset).toHaveBeenCalled();
});
