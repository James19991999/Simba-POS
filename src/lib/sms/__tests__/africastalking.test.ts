import { sendBulkSms, SmsNotConfiguredError } from "../africastalking";

const OLD_ENV = process.env;

beforeEach(() => {
  process.env = { ...OLD_ENV, AFRICASTALKING_API_KEY: "atsk_test", AFRICASTALKING_USERNAME: "sandbox" };
  global.fetch = jest.fn();
});

afterAll(() => {
  process.env = OLD_ENV;
});

describe("sendBulkSms", () => {
  it("throws SmsNotConfiguredError when no API key/username is set", async () => {
    delete process.env.AFRICASTALKING_API_KEY;
    await expect(sendBulkSms(["+254712345678"], "Hi")).rejects.toBeInstanceOf(SmsNotConfiguredError);
  });

  it("returns an empty result without calling the API for zero recipients", async () => {
    const result = await sendBulkSms([], "Hi");
    expect(result.recipients).toHaveLength(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("posts form-urlencoded body with apiKey header to the sandbox host", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        SMSMessageData: {
          Message: "Sent",
          Recipients: [{ number: "+254712345678", status: "Success", statusCode: 101, cost: "KES 0.80", messageId: "ATXid_1" }],
        },
      }),
    });

    const result = await sendBulkSms(["+254712345678"], "Friday Nyama Choma Rush!", "SIMBAPOS");

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("https://api.sandbox.africastalking.com/version1/messaging");
    expect(init.method).toBe("POST");
    expect(init.headers.apiKey).toBe("atsk_test");
    expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const params = new URLSearchParams(init.body);
    expect(params.get("username")).toBe("sandbox");
    expect(params.get("to")).toBe("+254712345678");
    expect(params.get("from")).toBe("SIMBAPOS");
    expect(result.recipients[0].status).toBe("Success");
  });

  it("throws with response body text on a non-2xx response", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 403, text: async () => "Invalid apiKey" });
    await expect(sendBulkSms(["+254712345678"], "Hi")).rejects.toThrow(/403/);
  });
});
