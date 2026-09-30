import { rateLimit } from "../index";

describe("rateLimit (in-memory backend)", () => {
  it("allows requests up to the limit and then blocks", async () => {
    const key = `test-${crypto.randomUUID()}`;
    for (let i = 0; i < 5; i++) {
      const res = await rateLimit(key, 5, 60);
      expect(res.allowed).toBe(true);
    }
    const blocked = await rateLimit(key, 5, 60);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("tracks distinct keys independently", async () => {
    const keyA = `a-${crypto.randomUUID()}`;
    const keyB = `b-${crypto.randomUUID()}`;
    await rateLimit(keyA, 1, 60);
    const blockedA = await rateLimit(keyA, 1, 60);
    const allowedB = await rateLimit(keyB, 1, 60);
    expect(blockedA.allowed).toBe(false);
    expect(allowedB.allowed).toBe(true);
  });

  it("resets after the window elapses", async () => {
    jest.useFakeTimers();
    const key = `window-${crypto.randomUUID()}`;
    await rateLimit(key, 1, 1);
    const blocked = await rateLimit(key, 1, 1);
    expect(blocked.allowed).toBe(false);
    jest.advanceTimersByTime(1100);
    const allowedAgain = await rateLimit(key, 1, 1);
    expect(allowedAgain.allowed).toBe(true);
    jest.useRealTimers();
  });
});
