import type { Redis } from "ioredis";

const RATE_LIMIT_PREFIX = "ratelimit:";
const MAX_MESSAGES_PER_MINUTE = 30;
const WINDOW_SECONDS = 60;

/**
 * Check if a phone number has exceeded the rate limit.
 * Returns true if rate-limited (should reject).
 */
export async function isRateLimited(redis: Redis, phoneNumber: string): Promise<boolean> {
  const key = `${RATE_LIMIT_PREFIX}${phoneNumber}`;
  const count = await redis.incr(key);

  if (count === 1) {
    // First request in this window — set expiry
    await redis.expire(key, WINDOW_SECONDS);
  }

  return count > MAX_MESSAGES_PER_MINUTE;
}
