import { BlockList, isIP } from "node:net";
export const CLIENT_IP_HEADER = "x-kestrel-client-ip";
export type TrustedProxies = Pick<BlockList, "check">;
export function normalizeIp(value: string): string | undefined {
  const candidate = value.trim().toLowerCase();
  const normalized =
    candidate.startsWith("::ffff:") && isIP(candidate.slice(7)) === 4
      ? candidate.slice(7)
      : candidate;
  return isIP(normalized) ? normalized : undefined;
}
function family(ip: string) {
  return isIP(ip) === 6 ? "ipv6" : "ipv4";
}
// Accepts exact addresses and CIDR ranges, for hosts whose proxy addresses
// are assigned from a private range rather than fixed. /0 is refused.
export function parseTrustedProxyIps(value: string): TrustedProxies {
  const trusted = new BlockList();
  if (!value.trim()) return trusted;
  for (const entry of value.split(",")) {
    const [address = "", prefix, extra] = entry.split("/");
    const ip = normalizeIp(address);
    const bits = prefix?.trim();
    const max = ip && family(ip) === "ipv6" ? 128 : 32;
    if (
      !ip ||
      extra !== undefined ||
      (bits !== undefined &&
        (!/^\d{1,3}$/.test(bits) || Number(bits) < 1 || Number(bits) > max))
    )
      throw new Error(
        "TRUSTED_PROXY_IPS must contain comma-separated IP addresses or CIDR ranges",
      );
    if (bits === undefined) trusted.addAddress(ip, family(ip));
    else trusted.addSubnet(ip, Number(bits), family(ip));
  }
  return trusted;
}
function isTrusted(ip: string, trusted: TrustedProxies) {
  return trusted.check(ip, family(ip));
}
export function resolveClientIp(
  remoteAddress: string | undefined,
  forwardedFor: string | null,
  trustedProxies: TrustedProxies,
): string | undefined {
  const peer = remoteAddress && normalizeIp(remoteAddress);
  if (!peer) return undefined;
  if (!isTrusted(peer, trustedProxies) || !forwardedFor) return peer;
  const chain = forwardedFor.split(",").map(normalizeIp);
  // Fail closed on malformed forwarding data; retain the verified socket peer.
  if (chain.some((ip) => !ip)) return peer;
  for (let index = chain.length - 1; index >= 0; index--) {
    const ip = chain[index];
    if (ip && !isTrusted(ip, trustedProxies)) return ip;
  }
  return chain[0] ?? peer;
}
export function withClientIp(
  request: Request,
  remoteAddress: string | undefined,
  trustedProxies: TrustedProxies,
): Request {
  const headers = new Headers(request.headers);
  headers.delete(CLIENT_IP_HEADER);
  const ip = resolveClientIp(
    remoteAddress,
    headers.get("x-forwarded-for"),
    trustedProxies,
  );
  if (ip) headers.set(CLIENT_IP_HEADER, ip);
  return new Request(request, { headers });
}
