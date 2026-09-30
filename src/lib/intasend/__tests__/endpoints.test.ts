/**
 * Verifies the client hits the correct IntaSend endpoints/fields per the
 * re-verified API shape (see the comment block at the top of client.ts) —
 * this is what caught, during this same pass, that the original
 * implementation had collapsed 3 distinct IntaSend APIs (Collection,
 * Express Checkout, Status) into one incorrect unified `/checkout/` call.
 */
import { triggerMpesaStkPush, createIntasendCheckout, getIntasendInvoiceStatus, sendMpesaB2C } from "../client";

const OLD_ENV = process.env;

beforeEach(() => {
  process.env = {
    ...OLD_ENV,
    INTASEND_SECRET_KEY: "ISSecretKey_test",
    INTASEND_PUBLIC_KEY: "ISPubKey_test",
    INTASEND_LIVE_MODE: "false",
  };
  global.fetch = jest.fn();
});

afterAll(() => {
  process.env = OLD_ENV;
});

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

describe("triggerMpesaStkPush", () => {
  it("POSTs to the direct Collection API endpoint with public_key + method M-PESA", async () => {
    mockFetchOnce({ id: "abc", invoice: { invoice_id: "inv_1", state: "PENDING" } });
    await triggerMpesaStkPush({
      amount: 7140,
      currency: "KES",
      api_ref: "ref-1",
      name: "Guest",
      email: "guest@example.com",
      phone_number: "254712345678",
    });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("https://sandbox.intasend.com/api/v1/payment/collection/");
    const body = JSON.parse(init.body);
    expect(body.public_key).toBe("ISPubKey_test");
    expect(body.method).toBe("M-PESA");
    expect(body.phone_number).toBe("254712345678");
    expect(init.headers.Authorization).toBe("Bearer ISSecretKey_test");
  });
});

describe("createIntasendCheckout", () => {
  it("POSTs to the Express Checkout endpoint with first_name/last_name/country", async () => {
    mockFetchOnce({ id: "chk_1", url: "https://sandbox.intasend.com/checkout/chk_1", signature: "jwt", api_ref: "ref-2" });
    await createIntasendCheckout({
      amount: 4900,
      currency: "KES",
      email: "owner@example.com",
      first_name: "James",
      last_name: "Maruti",
      country: "KE",
      api_ref: "ref-2",
    });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("https://sandbox.intasend.com/api/v1/checkout/");
    const body = JSON.parse(init.body);
    expect(body.first_name).toBe("James");
    expect(body.country).toBe("KE");
  });
});

describe("getIntasendInvoiceStatus", () => {
  it("POSTs to /payment/status/ with invoice_id (not a GET on /checkout/{id}/)", async () => {
    mockFetchOnce({ invoice: { invoice_id: "inv_1", state: "COMPLETE", api_ref: "ref-1" } });
    await getIntasendInvoiceStatus("inv_1");
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("https://sandbox.intasend.com/api/v1/payment/status/");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body).invoice_id).toBe("inv_1");
  });
});

describe("sendMpesaB2C", () => {
  it("POSTs a batch of transactions to the send-money endpoint", async () => {
    mockFetchOnce({ tracking_id: "t1", status: "PROCESSING", transactions: [] });
    await sendMpesaB2C({
      currency: "KES",
      transactions: [{ name: "Faith W.", account: "254712000111", amount: 925, narrative: "Tip pool" }],
    });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("https://sandbox.intasend.com/api/v1/send-money/initiate/");
    const body = JSON.parse(init.body);
    expect(body.transactions).toHaveLength(1);
    expect(body.requires_approval).toBe("NO");
  });
});

describe("error surfacing", () => {
  it("throws when INTASEND_SECRET_KEY is missing", async () => {
    delete process.env.INTASEND_SECRET_KEY;
    await expect(
      triggerMpesaStkPush({ amount: 100, currency: "KES", api_ref: "r", name: "n", email: "e@e.com", phone_number: "254700000000" })
    ).rejects.toThrow(/INTASEND_SECRET_KEY/);
  });

  it("throws with the response body on a non-2xx IntaSend response", async () => {
    mockFetchOnce({ error: "invalid public_key" }, false, 401);
    await expect(
      triggerMpesaStkPush({ amount: 100, currency: "KES", api_ref: "r", name: "n", email: "e@e.com", phone_number: "254700000000" })
    ).rejects.toThrow(/401/);
  });
});
