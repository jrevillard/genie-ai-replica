import { Worker, Queue } from "bullmq";
import type { Redis } from "ioredis";
import { executeCampaign } from "../services/campaign.service.js";
import { logger } from "../logger.js";
import { getDb, schema } from "../db/index.js";
import { eq, and, lte } from "drizzle-orm";

const QUEUE_NAME = "campaign-processor";
const POLL_INTERVAL_MS = 30_000; // Check for pending campaigns every 30 seconds

let campaignQueue: Queue | undefined;
let campaignWorker: Worker | undefined;

export async function startCampaignWorker(redis: Redis): Promise<void> {
  const connection = { connection: redis };

  campaignQueue = new Queue(QUEUE_NAME, connection);

  // Clean up stale jobs from previous runs
  await campaignQueue.obliterate({ force: true }).catch(() => {});

  campaignWorker = new Worker(
    QUEUE_NAME,
    async () => {
      const db = getDb();
      const pendingCampaigns = await db
        .select()
        .from(schema.campaigns)
        .where(
          and(
            eq(schema.campaigns.status, "pending"),
            lte(schema.campaigns.scheduledAt, new Date()),
          ),
        );

      for (const campaign of pendingCampaigns) {
        logger.info({ campaignId: campaign.id }, "Executing scheduled campaign");
        await executeCampaign(campaign.id);
      }
    },
    {
      ...connection,
      removeOnComplete: { count: 0 },
      removeOnFail: { count: 0 },
    },
  );

  campaignWorker.on("error", (err) => {
    if (!err.message.includes("Missing lock")) {
      logger.error({ err }, "Campaign worker error");
    }
  });

  await campaignQueue.upsertJobScheduler(
    "campaign-poll",
    { every: POLL_INTERVAL_MS },
    { name: "process-campaigns" },
  );

  logger.info("Campaign worker started");
}

export async function stopCampaignWorker(): Promise<void> {
  if (campaignWorker) await campaignWorker.close();
  if (campaignQueue) await campaignQueue.close();
}
