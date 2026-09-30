import assert from "node:assert/strict";
import test from "node:test";
import {
  CLIENT_IP_HEADER,
  normalizeIp,
  parseTrustedProxyIps,
  resolveClientIp,
  withClientIp,
} from "../../src/lib/client-ip.js";

test("direct socket overrides spoofed internal and forwarding headers", () => {
  const request = new Request("http://localhost/api/auth/get-session", {
    headers: { [CLIENT_IP_HEADER]: "1.2.3.4", "x-forwarded-for": "5.6.7.8" },
  });
  assert.equal(
    withClientIp(request, "::ffff:192.0.2.10", []).headers.get(
      CLIENT_IP_HEADER,
    ),
    "192.0.2.10",
  );
  assert.equal(
    withClientIp(request, undefined, []).headers.get(CLIENT_IP_HEADER),
    null,
  );
});
test("trusted proxy chain selects first untrusted hop from the right", () => {
  assert.equal(
    resolveClientIp("127.0.0.1", "198.51.100.1, 192.0.2.20, 10.0.0.2", [
      "127.0.0.1",
      "10.0.0.2",
    ]),
    "192.0.2.20",
  );
  assert.equal(
    resolveClientIp("127.0.0.1", "198.51.100.1, invalid", ["127.0.0.1"]),
    "127.0.0.1",
  );
  assert.equal(
    resolveClientIp("127.0.0.1", "::ffff:198.51.100.1", ["127.0.0.1"]),
    "198.51.100.1",
  );
  assert.equal(
    resolveClientIp("192.0.2.10", "198.51.100.1", ["127.0.0.1"]),
    "192.0.2.10",
  );
});
test("proxy configuration validates exact addresses", () => {
  assert.deepEqual(parseTrustedProxyIps("127.0.0.1, ::ffff:10.0.0.2"), [
    "127.0.0.1",
    "10.0.0.2",
  ]);
  assert.throws(() => parseTrustedProxyIps("10.0.0.0/8"));
  assert.equal(normalizeIp("bad"), undefined);
});
