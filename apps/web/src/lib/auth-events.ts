import { analytics } from "./analytics";
import { queryClient } from "./query-client";

const channel =
  typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("account-session")
    : null;
export function publishAuthChange() {
  channel?.postMessage("changed");
}
export function onRemoteAuthChange(listener: () => void) {
  if (!channel) return () => {};
  const handle = () => {
    analytics.reset();
    queryClient.clear();
    listener();
  };
  channel.addEventListener("message", handle);
  return () => channel.removeEventListener("message", handle);
}
