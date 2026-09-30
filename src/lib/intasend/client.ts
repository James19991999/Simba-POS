// Direct-fetch IntaSend client — deliberately NOT the community `intasend-node`
// package, so the payment path stays auditable end-to-end in this codebase
// rather than depending on an unaudited third-party SDK. This mirrors the
// pattern used on Verdant Enterprise and DispatchFlow.
//
// Endpoint shapes below were re-verified against IntaSend's published docs
// (developers.intasend.com, IntaSend/documentation on GitHub) on this build
// date rather than assumed from memory of an earlier project — IntaSend
// actually exposes THREE distinct APIs that are easy to conflate:
//   1. POST /payment/collection/  — direct M-Pesa STK push, no redirect,
//      matches the "Awaiting Customer PIN Entry" live-tracker UX.
//   2. POST /checkout/            — Express Checkout: returns a hosted
//      checkout URL + JWT `signature`, used here for card payments and for
//      platform subscription billing (both fine with a redirect).
//   3. POST /payment/status/      — status lookup by invoice_id (NOT a GET
//      on /checkout/{id}/, which an earlier draft of this file incorrectly
//      assumed).
// All server-to-server calls authenticate with `Authorization: Bearer
// <secret key>` (confirmed in IntaSend's Authentication docs); the
// `public_key` field is ALSO required in the body of Collection/Checkout
// calls to identify the account.
//
// IntaSend is used for BOTH payment surfaces in this app:
//   1. Platform subscription billing (org pays SimbaPOS) — see lib/billing/plans.ts
//   2. In-restaurant guest bill collection (M-Pesa STK Push + card) — see
//      app/api/pos/intasend-checkout
//
// Stripe is not used anywhere in this codebase.

// Resolved per-call, not cached at module load — a module-level constant
// would freeze whichever value INTASEND_LIVE_MODE had at first import. The
// identical bug shape was caught by a test in sms/africastalking.test.ts
// (a module-level URL constant not reflecting an env var changed after
// import); fixed here proactively for the same reason.
function getBaseUrl(): string {
  return process.env.INTASEND_LIVE_MODE === "true"
    ? "https://payment.intasend.com/api/v1"
    : "https://sandbox.intasend.com/api/v1";
}

function getSecretKey(): string {
  const key = process.env.INTASEND_SECRET_KEY;
  if (!key) {
    throw new Error("INTASEND_SECRET_KEY is not configured in the environment.");
  }
  return key;
}

function getPublicKey(): string {
  const key = process.env.INTASEND_PUBLIC_KEY;
  if (!key) {
    throw new Error("INTASEND_PUBLIC_KEY is not configured in the environment.");
  }
  return key;
}

function authHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${getSecretKey()}`,
  };
}

async function postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`IntaSend ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// 1) Direct M-Pesa STK Push — Collection API
// ---------------------------------------------------------------------------

export interface IntasendStkPushParams {
  amount: number;
  currency: "KES";
  api_ref: string;
  name: string;
  email: string;
  phone_number: string; // "2547XXXXXXXX"
}

export interface IntasendStkPushResponse {
  id: string;
  invoice: {
    invoice_id: string;
    state: "PENDING" | "PROCESSING" | "COMPLETE" | "FAILED";
    account?: string;
    failed_reason?: string | null;
  };
}

export async function triggerMpesaStkPush(
  params: IntasendStkPushParams
): Promise<IntasendStkPushResponse> {
  return postJson<IntasendStkPushResponse>("/payment/collection/", {
    public_key: getPublicKey(),
    currency: params.currency,
    method: "M-PESA",
    amount: params.amount,
    api_ref: params.api_ref,
    name: params.name,
    phone_number: params.phone_number,
    email: params.email,
  });
}

// ---------------------------------------------------------------------------
// 2) Express Checkout (hosted URL) — used for card payments and subscriptions
// ---------------------------------------------------------------------------

export interface IntasendCheckoutParams {
  amount: number;
  currency: "KES";
  email: string;
  first_name: string;
  last_name: string;
  country: string; // ISO alpha-2, "KE"
  phone_number?: string;
  api_ref: string;
  redirect_url?: string;
  comment?: string;
}

export interface IntasendCheckoutResponse {
  id: string; // checkout session id (== invoice_id for status lookups)
  url: string;
  signature: string;
  api_ref: string;
}

export async function createIntasendCheckout(
  params: IntasendCheckoutParams
): Promise<IntasendCheckoutResponse> {
  return postJson<IntasendCheckoutResponse>("/checkout/", {
    public_key: getPublicKey(),
    amount: params.amount,
    currency: params.currency,
    email: params.email,
    first_name: params.first_name,
    last_name: params.last_name,
    country: params.country,
    phone_number: params.phone_number,
    api_ref: params.api_ref,
    redirect_url: params.redirect_url,
  });
}

// ---------------------------------------------------------------------------
// 3) Status lookup — POST /payment/status/, keyed by invoice_id
// ---------------------------------------------------------------------------

export interface IntasendStatusResponse {
  invoice: {
    invoice_id: string;
    state: "PENDING" | "PROCESSING" | "COMPLETE" | "FAILED" | "CANCELLED";
    net_amount?: string;
    api_ref: string;
  };
}

export async function getIntasendInvoiceStatus(invoiceId: string): Promise<IntasendStatusResponse> {
  return postJson<IntasendStatusResponse>("/payment/status/", {
    public_key: getPublicKey(),
    invoice_id: invoiceId,
  });
}

// ---------------------------------------------------------------------------
// 4) M-Pesa B2C Payout — used for real tip-pool disbursement
// ---------------------------------------------------------------------------

export interface IntasendB2CTransaction {
  name: string;
  account: string; // phone number, "2547XXXXXXXX"
  amount: number;
  narrative?: string;
}

export interface IntasendB2CParams {
  currency: "KES";
  transactions: IntasendB2CTransaction[];
  requires_approval?: "YES" | "NO";
}

export interface IntasendB2CResponse {
  tracking_id: string;
  status: string;
  transactions: Array<{ account: string; status: string; amount: string }>;
}

/**
 * Real M-Pesa B2C send-money call (IntaSend's "Send Money" API), used to pay
 * out each crew member's tip-pool share directly to their M-Pesa number.
 * Requires each recipient's own verified phone number on file — the caller
 * is responsible for only including crew members who have one.
 */
export async function sendMpesaB2C(params: IntasendB2CParams): Promise<IntasendB2CResponse> {
  return postJson<IntasendB2CResponse>("/send-money/initiate/", {
    currency: params.currency,
    transactions: params.transactions,
    requires_approval: params.requires_approval ?? "NO",
  });
}

/**
 * IntaSend's webhook does not sign the payload with an HMAC the way Stripe
 * does — it echoes back a shared "challenge" string configured in the
 * IntaSend dashboard, inside the JSON body itself. This is a structurally
 * weaker verification scheme than an HMAC signature (anyone who has read
 * access to one delivered webhook payload learns the challenge value), and
 * is documented as such rather than presented as equivalent to Stripe-style
 * verification. `crypto.timingSafeEqual` is used purely to avoid adding a
 * timing side-channel on top of that already-weaker scheme.
 *
 * Caveat found while re-verifying this build: IntaSend's current public
 * docs (developers.intasend.com/docs/webhooks) do not spell out the
 * verification mechanism in the pages this build could reach — the
 * challenge-string scheme here follows the pattern already used on prior
 * IntaSend integrations (Verdant Enterprise, DispatchFlow) but has not been
 * re-confirmed against a live webhook delivery in this session. Treat this
 * as the best-known scheme, not a guaranteed-current spec, and re-check
 * developers.intasend.com's webhook setup page against your actual
 * dashboard configuration before relying on it in production.
 */
export function verifyIntasendChallenge(
  receivedChallenge: string | undefined,
  timingSafeEqual: (a: Buffer, b: Buffer) => boolean
): boolean {
  const expected = process.env.INTASEND_WEBHOOK_CHALLENGE;
  if (!expected || !receivedChallenge) return false;
  const a = Buffer.from(receivedChallenge);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
