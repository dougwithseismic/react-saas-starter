import assert from "node:assert/strict";
import test from "node:test";
import {
  CLIENT_IP_HEADER,
  normalizeIp,
  parseTrustedProxyIps,
  resolveClientIp,
  withClientIp,
} from "../../src/lib/client-ip.js";

const none = parseTrustedProxyIps("");
const loopback = parseTrustedProxyIps("127.0.0.1");
test("direct socket overrides spoofed internal and forwarding headers", () => {
  const request = new Request("http://localhost/api/auth/get-session", {
    headers: { [CLIENT_IP_HEADER]: "1.2.3.4", "x-forwarded-for": "5.6.7.8" },
  });
  assert.equal(
    withClientIp(request, "::ffff:192.0.2.10", none).headers.get(
      CLIENT_IP_HEADER,
    ),
    "192.0.2.10",
  );
  assert.equal(
    withClientIp(request, undefined, none).headers.get(CLIENT_IP_HEADER),
    null,
  );
});
test("trusted proxy chain selects first untrusted hop from the right", () => {
  assert.equal(
    resolveClientIp(
      "127.0.0.1",
      "198.51.100.1, 192.0.2.20, 10.0.0.2",
      parseTrustedProxyIps("127.0.0.1,10.0.0.2"),
    ),
    "192.0.2.20",
  );
  assert.equal(
    resolveClientIp("127.0.0.1", "198.51.100.1, invalid", loopback),
    "127.0.0.1",
  );
  assert.equal(
    resolveClientIp("127.0.0.1", "::ffff:198.51.100.1", loopback),
    "198.51.100.1",
  );
  assert.equal(
    resolveClientIp("192.0.2.10", "198.51.100.1", loopback),
    "192.0.2.10",
  );
});
test("proxy configuration validates exact addresses", () => {
  const trusted = parseTrustedProxyIps("127.0.0.1, ::ffff:10.0.0.2");
  assert.equal(trusted.check("127.0.0.1", "ipv4"), true);
  assert.equal(trusted.check("10.0.0.2", "ipv4"), true);
  assert.equal(trusted.check("10.0.0.3", "ipv4"), false);
  assert.throws(() => parseTrustedProxyIps("127.0.0.1,"));
  assert.equal(normalizeIp("bad"), undefined);
});
test("proxy configuration accepts CIDR ranges for unfixed proxy addresses", () => {
  const trusted = parseTrustedProxyIps("10.0.0.0/8, 100.64.0.0/10, fc00::/7");
  assert.equal(
    resolveClientIp("::ffff:10.12.0.7", "203.0.113.9", trusted),
    "203.0.113.9",
  );
  assert.equal(
    resolveClientIp("fd12:3456::2", "203.0.113.9, 100.64.3.4", trusted),
    "203.0.113.9",
  );
  assert.equal(
    resolveClientIp("192.0.2.10", "203.0.113.9", trusted),
    "192.0.2.10",
  );
  for (const invalid of [
    "0.0.0.0/0",
    "::/0",
    "10.0.0.0/33",
    "fc00::/129",
    "10.0.0.0/",
    "10.0.0.0/8/8",
    "10.0.0.0/0x8",
    "bad/8",
  ])
    assert.throws(() => parseTrustedProxyIps(invalid), invalid);
});
