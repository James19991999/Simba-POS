import { createHmac } from "crypto";
import { verifyHmacSignature } from "../verify";

describe("verifyHmacSignature", () => {
  const secret = "test-secret";
  const body = JSON.stringify({ orderId: "GLV-1049", total: 1450 });
  const validSig = createHmac("sha256", secret).update(body).digest("hex");

  it("accepts a correctly computed HMAC-SHA256 signature", () => {
    expect(verifyHmacSignature(body, validSig, secret)).toBe(true);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const wrongSig = createHmac("sha256", "other-secret").update(body).digest("hex");
    expect(verifyHmacSignature(body, wrongSig, secret)).toBe(false);
  });

  it("rejects a signature for a tampered body (integrity check)", () => {
    const tampered = JSON.stringify({ orderId: "GLV-1049", total: 999999 });
    expect(verifyHmacSignature(tampered, validSig, secret)).toBe(false);
  });

  it("rejects when no secret is configured for that aggregator", () => {
    expect(verifyHmacSignature(body, validSig, undefined)).toBe(false);
  });

  it("rejects when the signature header is missing", () => {
    expect(verifyHmacSignature(body, null, secret)).toBe(false);
  });

  it("never throws on a garbage/mismatched-length signature", () => {
    expect(() => verifyHmacSignature(body, "short", secret)).not.toThrow();
    expect(verifyHmacSignature(body, "short", secret)).toBe(false);
  });
});
