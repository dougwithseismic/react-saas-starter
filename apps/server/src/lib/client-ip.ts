import { isIP } from "node:net";
export const CLIENT_IP_HEADER = "x-kestrel-client-ip";
export function normalizeIp(value: string): string | undefined {
  const candidate = value.trim().toLowerCase();
  const normalized =
    candidate.startsWith("::ffff:") && isIP(candidate.slice(7)) === 4
      ? candidate.slice(7)
      : candidate;
  return isIP(normalized) ? normalized : undefined;
}
export function parseTrustedProxyIps(value: string): string[] {
  if (!value.trim()) return [];
  return value.split(",").map((value) => {
    const ip = normalizeIp(value);
    if (!ip)
      throw new Error(
        "TRUSTED_PROXY_IPS must contain comma-separated IP addresses",
      );
    return ip;
  });
}
export function resolveClientIp(
  remoteAddress: string | undefined,
  forwardedFor: string | null,
  trustedProxyIps: readonly string[],
): string | undefined {
  const peer = remoteAddress && normalizeIp(remoteAddress);
  if (!peer) return undefined;
  if (!trustedProxyIps.includes(peer) || !forwardedFor) return peer;
  const chain = forwardedFor.split(",").map(normalizeIp);
  // Fail closed on malformed forwarding data; retain the verified socket peer.
  if (chain.some((ip) => !ip)) return peer;
  for (let index = chain.length - 1; index >= 0; index--) {
    const ip = chain[index];
    if (ip && !trustedProxyIps.includes(ip)) return ip;
  }
  return chain[0] ?? peer;
}
export function withClientIp(
  request: Request,
  remoteAddress: string | undefined,
  trustedProxyIps: readonly string[],
): Request {
  const headers = new Headers(request.headers);
  headers.delete(CLIENT_IP_HEADER);
  const ip = resolveClientIp(
    remoteAddress,
    headers.get("x-forwarded-for"),
    trustedProxyIps,
  );
  if (ip) headers.set(CLIENT_IP_HEADER, ip);
  return new Request(request, { headers });
}
