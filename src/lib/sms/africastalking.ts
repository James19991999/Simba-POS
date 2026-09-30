// Real Africa's Talking SMS client — replaces the earlier Firestore-only
// "mark campaign as sent" stub. Endpoint/fields verified against Africa's
// Talking's own docs (help.africastalking.com's API endpoint reference) on
// this build date:
//   POST https://api.africastalking.com/version1/messaging
//     (sandbox: https://api.sandbox.africastalking.com/version1/messaging)
//   Headers: apiKey, Accept: application/json, Content-Type: form-urlencoded
//   Body: username, to (comma-separated E.164 numbers), message, from? (sender ID)
//
// Chosen over a direct Safaricom/Airtel integration for the same reason
// IntaSend was chosen over raw Daraja: one account, one API, both telcos
// covered, lower integration cost for an SME-facing product.

// Resolved per-call rather than cached at module load: a module-level
// constant here would freeze whichever value AFRICASTALKING_USERNAME had at
// first import, which is wrong the moment env vars can change between calls
// (exactly the bug a test in africastalking.test.ts caught: switching to
// "sandbox" mid-test-run had no effect on an already-evaluated constant).
function getBaseUrl(): string {
  return process.env.AFRICASTALKING_USERNAME === "sandbox"
    ? "https://api.sandbox.africastalking.com/version1/messaging"
    : "https://api.africastalking.com/version1/messaging";
}

export interface SmsRecipientResult {
  number: string;
  status: string;
  statusCode: number;
  cost?: string;
  messageId?: string;
}

export interface SendSmsResult {
  message: string;
  recipients: SmsRecipientResult[];
}

export class SmsNotConfiguredError extends Error {
  constructor() {
    super(
      "SMS is not configured: set AFRICASTALKING_API_KEY and AFRICASTALKING_USERNAME " +
        "(use 'sandbox' for testing) in the environment to enable real SMS dispatch."
    );
    this.name = "SmsNotConfiguredError";
  }
}

/**
 * Sends a real SMS blast to up to 100 recipients per call (Africa's
 * Talking's own documented per-request practical limit for the bulk
 * endpoint's `to` field — batch larger audiences into multiple calls).
 * Throws SmsNotConfiguredError if no API key is set, so callers can
 * surface a clear "not configured" message rather than a confusing
 * network error or a silently-fake "sent" state.
 */
export async function sendBulkSms(recipients: string[], message: string, senderId?: string): Promise<SendSmsResult> {
  const apiKey = process.env.AFRICASTALKING_API_KEY;
  const username = process.env.AFRICASTALKING_USERNAME;
  if (!apiKey || !username) {
    throw new SmsNotConfiguredError();
  }
  if (recipients.length === 0) {
    return { message: "No recipients", recipients: [] };
  }

  const body = new URLSearchParams({
    username,
    to: recipients.join(","),
    message,
  });
  if (senderId) body.set("from", senderId);

  const res = await fetch(getBaseUrl(), {
    method: "POST",
    headers: {
      apiKey,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Africa's Talking SMS send failed (${res.status}): ${text}`);
  }

  const json = await res.json();
  const data = json.SMSMessageData;
  return {
    message: data?.Message ?? "Unknown",
    recipients: (data?.Recipients ?? []).map((r: { number: string; status: string; statusCode: number; cost?: string; messageId?: string }) => ({
      number: r.number,
      status: r.status,
      statusCode: r.statusCode,
      cost: r.cost,
      messageId: r.messageId,
    })),
  };
}
