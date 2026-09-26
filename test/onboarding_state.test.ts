import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { applyVerificationEvent, verifyWebhook } from "../src/matter_ledger.js";

test("a signed verification event activates the tenant domain and stops polling", () => {
  const secret = "local-test-secret";
  const raw = JSON.stringify({ type: "dns.domain.verified", domain: "cases.example.com" });
  const signature = createHmac("sha256", secret).update(raw).digest("hex");

  assert.equal(verifyWebhook(raw, signature, secret), true);
  const next = applyVerificationEvent(
    { domain: "cases.example.com", zoneId: "zone_test", status: "pending_verification", polling: true },
    JSON.parse(raw),
  );
  assert.deepEqual(next, {
    domain: "cases.example.com",
    zoneId: "zone_test",
    status: "active",
    polling: false,
  });
});
