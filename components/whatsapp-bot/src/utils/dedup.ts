import type { Redis } from "ioredis";

const DEDUP_TTL_SECONDS = 24 * 60 * 60; // 24 hours
const DEDUP_PREFIX = "dedup:";

/**
 * Check if a message ID has already been processed.
 * Returns true if this is a duplicate (already seen).
 */
export async function isDuplicate(redis: Redis, messageId: string): Promise<boolean> {
  const key = `${DEDUP_PREFIX}${messageId}`;
  // SET NX returns null if key already exists
  const result = await redis.set(key, "1", "EX", DEDUP_TTL_SECONDS, "NX");
  return result === null; // null means key already existed → duplicate
}
