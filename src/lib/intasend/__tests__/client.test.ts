import { timingSafeEqual } from "crypto";
import { verifyIntasendChallenge } from "../client";

describe("verifyIntasendChallenge", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV, INTASEND_WEBHOOK_CHALLENGE: "correct-challenge-value" };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it("accepts the exact configured challenge string", () => {
    expect(verifyIntasendChallenge("correct-challenge-value", timingSafeEqual)).toBe(true);
  });

  it("rejects a wrong challenge string", () => {
    expect(verifyIntasendChallenge("wrong-value", timingSafeEqual)).toBe(false);
  });

  it("rejects a missing challenge", () => {
    expect(verifyIntasendChallenge(undefined, timingSafeEqual)).toBe(false);
  });

  it("rejects when no challenge is configured on the server", () => {
    delete process.env.INTASEND_WEBHOOK_CHALLENGE;
    expect(verifyIntasendChallenge("anything", timingSafeEqual)).toBe(false);
  });

  it("never throws on mismatched lengths (timingSafeEqual would throw on unequal buffers)", () => {
    expect(() => verifyIntasendChallenge("short", timingSafeEqual)).not.toThrow();
    expect(verifyIntasendChallenge("short", timingSafeEqual)).toBe(false);
  });
});
