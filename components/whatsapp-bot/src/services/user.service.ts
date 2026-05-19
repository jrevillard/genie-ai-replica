import { eq } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";
import * as genieai from "./genieai.service.js";
import { normalizePhoneNumber } from "../utils/phone.js";
import { logger } from "../logger.js";
import type { WaUser } from "../types/common.types.js";

type DbUser = typeof schema.waUsers.$inferSelect;

function dbUserToWaUser(row: DbUser): WaUser {
  return {
    id: row.id,
    phoneNumber: row.phoneNumber,
    genieaiUserId: row.genieaiUserId,
    genieaiLoginName: row.genieaiLoginName,
    genieaiEncPassword: row.genieaiEncPassword,
    genieaiAccessToken: row.genieaiAccessToken,
    genieaiRefreshToken: row.genieaiRefreshToken,
    genieaiTokenExpiresAt: row.genieaiTokenExpiresAt,
    activeConversationId: row.activeConversationId,
    conversationStartedAt: row.conversationStartedAt,
    displayName: row.displayName,
    riskProfileJson: row.riskProfileJson as Record<string, unknown> | null,
    preferredNudgeTime: row.preferredNudgeTime,
    region: row.region,
    optedOut: row.optedOut,
    optedOutAt: row.optedOutAt,
    lastMessageAt: row.lastMessageAt,
    messageCount: row.messageCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function findByPhone(phoneNumber: string): Promise<WaUser | null> {
  const normalized = normalizePhoneNumber(phoneNumber);
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.waUsers)
    .where(eq(schema.waUsers.phoneNumber, normalized))
    .limit(1);
  const row = rows[0];
  return row ? dbUserToWaUser(row) : null;
}

/**
 * Get an existing user by phone number. Returns null if not registered yet.
 * If opted out, re-subscribes them.
 */
export async function getRegisteredUser(phoneNumber: string): Promise<WaUser | null> {
  const existing = await findByPhone(phoneNumber);
  if (!existing) return null;
  if (existing.optedOut) {
    await resubscribe(existing.id);
    return { ...existing, optedOut: false, optedOutAt: null };
  }
  return existing;
}

export async function ensureValidToken(user: WaUser): Promise<string> {
  // If token expires within 1 hour, refresh it
  const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
  if (user.genieaiTokenExpiresAt > oneHourFromNow) {
    return user.genieaiAccessToken;
  }

  logger.debug({ userId: user.id }, "Refreshing Genie AI token");

  if (user.genieaiRefreshToken) {
    try {
      const res = await genieai.refreshToken(user.genieaiRefreshToken);
      const newExpiry = new Date(Date.now() + 23 * 60 * 60 * 1000);

      const db = getDb();
      await db
        .update(schema.waUsers)
        .set({
          genieaiAccessToken: res.accessToken,
          genieaiRefreshToken: res.refreshToken,
          genieaiTokenExpiresAt: newExpiry,
          updatedAt: new Date(),
        })
        .where(eq(schema.waUsers.id, user.id));

      return res.accessToken;
    } catch (err) {
      logger.warn({ err, userId: user.id }, "Token refresh failed, token may still work");
      return user.genieaiAccessToken;
    }
  }

  // No refresh token — return existing token and hope it's still valid
  return user.genieaiAccessToken;
}

export async function updateLastMessage(userId: string): Promise<void> {
  const db = getDb();
  await db
    .update(schema.waUsers)
    .set({
      lastMessageAt: new Date(),
      messageCount: (await db
        .select({ count: schema.waUsers.messageCount })
        .from(schema.waUsers)
        .where(eq(schema.waUsers.id, userId))
        .then((r) => (r[0]?.count ?? 0) + 1)),
      updatedAt: new Date(),
    })
    .where(eq(schema.waUsers.id, userId));
}

export async function updateActiveConversation(
  userId: string,
  conversationId: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.waUsers)
    .set({
      activeConversationId: conversationId,
      conversationStartedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.waUsers.id, userId));
}

export async function handleOptOut(userId: string): Promise<void> {
  const db = getDb();
  await db
    .update(schema.waUsers)
    .set({
      optedOut: true,
      optedOutAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.waUsers.id, userId));

  // Deactivate all scheduled messages
  await db
    .update(schema.scheduledMessages)
    .set({ active: false, updatedAt: new Date() })
    .where(eq(schema.scheduledMessages.waUserId, userId));
}

async function resubscribe(userId: string): Promise<void> {
  const db = getDb();
  await db
    .update(schema.waUsers)
    .set({
      optedOut: false,
      optedOutAt: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.waUsers.id, userId));
}

export async function updateRiskProfile(
  userId: string,
  riskProfile: Record<string, unknown>,
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.waUsers)
    .set({
      riskProfileJson: riskProfile,
      updatedAt: new Date(),
    })
    .where(eq(schema.waUsers.id, userId));
}
