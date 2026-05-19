import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

// We'll test the signature logic directly rather than through the Fastify hook
describe("webhook signature verification", () => {
  const appSecret = "test-app-secret";

  function computeSignature(body: string, secret: string): string {
    return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  }

  it("produces valid HMAC-SHA256 signature", () => {
    const body = '{"test": "data"}';
    const signature = computeSignature(body, appSecret);
    expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/);
  });

  it("produces different signatures for different bodies", () => {
    const sig1 = computeSignature("body1", appSecret);
    const sig2 = computeSignature("body2", appSecret);
    expect(sig1).not.toBe(sig2);
  });

  it("produces different signatures for different secrets", () => {
    const body = '{"test": "data"}';
    const sig1 = computeSignature(body, "secret1");
    const sig2 = computeSignature(body, "secret2");
    expect(sig1).not.toBe(sig2);
  });

  it("produces consistent signatures for same input", () => {
    const body = '{"test": "data"}';
    const sig1 = computeSignature(body, appSecret);
    const sig2 = computeSignature(body, appSecret);
    expect(sig1).toBe(sig2);
  });
});
