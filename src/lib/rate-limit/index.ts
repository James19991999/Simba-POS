// Storage-agnostic sliding-window rate limiter. In-memory by default; auto-
// upgrades to Upstash Redis when UPSTASH_REDIS_REST_URL/TOKEN are configured,
// so a single-instance dev/sandbox deploy and a multi-instance production
// deploy both get real limiting without a code change at the call site.

interface Bucket {
  count: number;
  windowStartMs: number;
}

const memoryStore = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds?: number;
}

export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (upstashUrl && upstashToken) {
    return rateLimitUpstash(key, limit, windowSeconds, upstashUrl, upstashToken);
  }
  return rateLimitMemory(key, limit, windowSeconds);
}

function rateLimitMemory(key: string, limit: number, windowSeconds: number): RateLimitResult {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const bucket = memoryStore.get(key);

  if (!bucket || now - bucket.windowStartMs >= windowMs) {
    memoryStore.set(key, { count: 1, windowStartMs: now });
    return { allowed: true, remaining: limit - 1 };
  }

  if (bucket.count < limit) {
    bucket.count += 1;
    return { allowed: true, remaining: limit - bucket.count };
  }

  const retryAfterSeconds = Math.ceil((bucket.windowStartMs + windowMs - now) / 1000);
  return { allowed: false, remaining: 0, retryAfterSeconds };
}

async function rateLimitUpstash(
  key: string,
  limit: number,
  windowSeconds: number,
  url: string,
  token: string
): Promise<RateLimitResult> {
  try {
    const res = await fetch(`${url}/incr/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = (await res.json()) as { result: number };
    const count = data.result;
    if (count === 1) {
      await fetch(`${url}/expire/${encodeURIComponent(key)}/${windowSeconds}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    if (count > limit) {
      return { allowed: false, remaining: 0, retryAfterSeconds: windowSeconds };
    }
    return { allowed: true, remaining: limit - count };
  } catch {
    // Fail-open: a Redis outage should not take down checkout/webhook
    // processing. Documented tradeoff, matching the pattern used previously.
    return { allowed: true, remaining: limit };
  }
}
