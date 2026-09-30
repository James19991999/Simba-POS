/**
 * Regression test for a real bug class caught while building the SMS
 * client: a module-level `const BASE_URL = process.env.X === "y" ? ... `
 * freezes whichever env value was set at first import, so a test (or a
 * server process) that changes INTASEND_LIVE_MODE after the module has
 * already been imported once would silently keep hitting the wrong host.
 * The fix resolves the base URL inside the function call instead.
 */
import { triggerMpesaStkPush } from "../client";

const OLD_ENV = process.env;

beforeEach(() => {
  process.env = { ...OLD_ENV, INTASEND_SECRET_KEY: "sk", INTASEND_PUBLIC_KEY: "pk" };
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ id: "x", invoice: { invoice_id: "inv", state: "PENDING" } }),
  });
});

afterAll(() => {
  process.env = OLD_ENV;
});

it("uses the sandbox host by default", async () => {
  process.env.INTASEND_LIVE_MODE = "false";
  await triggerMpesaStkPush({ amount: 1, currency: "KES", api_ref: "r", name: "n", email: "e@e.com", phone_number: "254700000000" });
  expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain("sandbox.intasend.com");
});

it("switches to the live host when INTASEND_LIVE_MODE=true, even after a prior sandbox call in the same process", async () => {
  process.env.INTASEND_LIVE_MODE = "true";
  await triggerMpesaStkPush({ amount: 1, currency: "KES", api_ref: "r", name: "n", email: "e@e.com", phone_number: "254700000000" });
  expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain("payment.intasend.com");
});
