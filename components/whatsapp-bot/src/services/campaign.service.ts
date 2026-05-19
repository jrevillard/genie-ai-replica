import { eq } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";
import * as whatsapp from "./whatsapp.service.js";
import { logger } from "../logger.js";
import type { TemplateComponent } from "../types/whatsapp.types.js";

interface CreateCampaignInput {
  templateName: string;
  templateParams: Record<string, string>;
  targetCriteria: {
    risk_areas?: string[];
    regions?: string[];
    all_users?: boolean;
  };
  scheduledAt?: Date;
}

export async function createCampaign(input: CreateCampaignInput) {
  const db = getDb();

  const rows = await db
    .insert(schema.campaigns)
    .values({
      templateName: input.templateName,
      templateParams: input.templateParams,
      targetCriteria: input.targetCriteria,
      scheduledAt: input.scheduledAt ?? new Date(),
      status: input.scheduledAt ? "pending" : "sending",
    })
    .returning();

  const campaign = rows[0]!;

  // If no scheduled time (or time is now/past), execute immediately
  if (!input.scheduledAt || input.scheduledAt <= new Date()) {
    executeCampaign(campaign.id).catch((err) =>
      logger.error({ err, campaignId: campaign.id }, "Campaign execution failed"),
    );
  }

  return campaign;
}

export async function executeCampaign(campaignId: string): Promise<void> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, campaignId))
    .limit(1);

  const campaign = rows[0];
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  const criteria = campaign.targetCriteria as {
    risk_areas?: string[];
    regions?: string[];
    all_users?: boolean;
  } | null;

  // Query target users
  let users = await db
    .select({ id: schema.waUsers.id, phoneNumber: schema.waUsers.phoneNumber, riskProfileJson: schema.waUsers.riskProfileJson, region: schema.waUsers.region })
    .from(schema.waUsers)
    .where(eq(schema.waUsers.optedOut, false));

  // Apply filters
  if (criteria && !criteria.all_users) {
    if (criteria.regions && criteria.regions.length > 0) {
      users = users.filter((u) => u.region && criteria.regions!.includes(u.region));
    }
    if (criteria.risk_areas && criteria.risk_areas.length > 0) {
      users = users.filter((u) => {
        const profile = u.riskProfileJson as Record<string, string> | null;
        if (!profile) return false;
        return criteria.risk_areas!.some(
          (area) => profile[area] === "medium" || profile[area] === "high",
        );
      });
    }
  }

  // Update total recipients
  await db
    .update(schema.campaigns)
    .set({ totalRecipients: users.length, status: "sending" })
    .where(eq(schema.campaigns.id, campaignId));

  // Build template components from params
  const params = campaign.templateParams as Record<string, string> | null;
  const components: TemplateComponent[] = [];
  if (params) {
    const bodyParams = Object.values(params).map((value) => ({
      type: "text" as const,
      text: value,
    }));
    if (bodyParams.length > 0) {
      components.push({ type: "body", parameters: bodyParams });
    }
  }

  let sentCount = 0;
  let failedCount = 0;

  // Send with rate limiting (~80 msg/sec = 12ms per message)
  for (const user of users) {
    try {
      await whatsapp.sendTemplate(
        user.phoneNumber,
        campaign.templateName,
        "en",
        components.length > 0 ? components : undefined,
      );
      sentCount++;
    } catch (err) {
      failedCount++;
      logger.error({ err, phoneNumber: user.phoneNumber, campaignId }, "Campaign message send failed");
    }

    // Rate limit: ~80 messages per second
    await new Promise((resolve) => setTimeout(resolve, 13));
  }

  // Update final stats
  await db
    .update(schema.campaigns)
    .set({
      sentCount,
      failedCount,
      status: "completed",
      completedAt: new Date(),
    })
    .where(eq(schema.campaigns.id, campaignId));

  logger.info({ campaignId, sentCount, failedCount, total: users.length }, "Campaign completed");
}
