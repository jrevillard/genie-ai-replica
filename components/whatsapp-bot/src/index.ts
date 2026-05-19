import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { Redis } from "ioredis";
import { loadConfig } from "./config.js";
import { initDb, closeDb } from "./db/index.js";
import { webhookRoutes } from "./routes/webhook.js";
import { internalRoutes } from "./routes/internal.js";
import { startNudgeWorker, stopNudgeWorker } from "./workers/nudge.worker.js";
import { startCampaignWorker, stopCampaignWorker } from "./workers/campaign.worker.js";
import { logger } from "./logger.js";

async function main() {
  // Load and validate config
  const config = loadConfig();

  // Initialize database
  initDb(config.DATABASE_URL);
  logger.info("Database connected");

  // Initialize Redis
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  redis.on("error", (err) => logger.error({ err }, "Redis error"));
  logger.info("Redis connected");

  // Create Fastify instance
  const app = Fastify({
    logger: false, // We use our own pino logger
    bodyLimit: 10 * 1024 * 1024, // 10MB for media
  });

  // Raw body access for webhook signature verification
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (_req, body, done) => {
      try {
        const parsed = JSON.parse(body.toString()) as unknown;
        // Store raw body for signature verification
        (_req as unknown as { rawBody: Buffer }).rawBody = body as Buffer;
        done(null, parsed);
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  // CORS
  await app.register(cors, { origin: true });

  // Health check (public)
  app.get("/health", async () => ({ status: "ok", timestamp: new Date().toISOString() }));

  // Register routes
  await app.register(
    async (instance) => webhookRoutes(instance, { redis }),
  );
  await app.register(
    async (instance) => internalRoutes(instance, { redis }),
  );

  // Start workers
  startNudgeWorker(redis);
  startCampaignWorker(redis);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down...");
    await app.close();
    await stopNudgeWorker();
    await stopCampaignWorker();
    redis.disconnect();
    await closeDb();
    logger.info("Shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  // Start server
  await app.listen({ port: config.PORT, host: config.HOST });
  logger.info({ port: config.PORT, host: config.HOST }, "WhatsApp bot server started");
}

main().catch((err) => {
  logger.fatal({ err }, "Failed to start server");
  process.exit(1);
});
