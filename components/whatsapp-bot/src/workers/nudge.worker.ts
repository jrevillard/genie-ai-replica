import { Worker, Queue } from "bullmq";
import type { Redis } from "ioredis";
import { processDueNudges } from "../services/nudge.service.js";
import { logger } from "../logger.js";

const QUEUE_NAME = "nudge-processor";
const POLL_INTERVAL_MS = 60_000; // Check for due nudges every 60 seconds

let nudgeQueue: Queue | undefined;
let nudgeWorker: Worker | undefined;

export async function startNudgeWorker(redis: Redis): Promise<void> {
  const connection = { connection: redis };

  nudgeQueue = new Queue(QUEUE_NAME, connection);

  // Clean up stale jobs from previous runs
  await nudgeQueue.obliterate({ force: true }).catch(() => {});

  nudgeWorker = new Worker(
    QUEUE_NAME,
    async () => {
      await processDueNudges();
    },
    {
      ...connection,
      removeOnComplete: { count: 0 },
      removeOnFail: { count: 0 },
    },
  );

  nudgeWorker.on("error", (err) => {
    if (!err.message.includes("Missing lock")) {
      logger.error({ err }, "Nudge worker error");
    }
  });

  // Schedule the repeating job
  await nudgeQueue.upsertJobScheduler(
    "nudge-poll",
    { every: POLL_INTERVAL_MS },
    { name: "process-nudges" },
  );

  logger.info("Nudge worker started");
}

export async function stopNudgeWorker(): Promise<void> {
  if (nudgeWorker) await nudgeWorker.close();
  if (nudgeQueue) await nudgeQueue.close();
}
