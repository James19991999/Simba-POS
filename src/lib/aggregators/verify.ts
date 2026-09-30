import { createHmac, timingSafeEqual } from "crypto";

/**
 * Generic HMAC-SHA256 webhook signature verification, used as the shared
 * default for every aggregator receiver in app/api/webhooks/aggregator/[channel].
 *
 * Honest scope note: Glovo, Uber Eats, and Jumia each have their OWN
 * partner-integration program with their own webhook signing scheme, and
 * none of them hand out real webhook credentials without an approved
 * partner/merchant account — which does not exist in a build sandbox. This
 * function implements the industry-standard HMAC-SHA256-over-raw-body
 * pattern that most of these platforms actually use (Uber's partner APIs
 * document exactly this scheme), as a real, working verification mechanism
 * that the org can point at once they have a real per-aggregator secret —
 * NOT a guess dressed up as "the real Glovo scheme" without ever having
 * seen Glovo's actual partner docs. Confirm the exact header name and
 * signing scheme against each aggregator's own partner documentation before
 * relying on this in production; swap in that aggregator's exact scheme if
 * it differs (e.g. a different header name or a timestamp-prefixed payload).
 */
export function verifyHmacSignature(rawBody: string, signatureHeader: string | null, secret: string | undefined): boolean {
  if (!secret || !signatureHeader) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
