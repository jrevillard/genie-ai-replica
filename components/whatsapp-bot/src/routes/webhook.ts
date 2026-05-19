import type { FastifyInstance } from "fastify";
import { getConfig } from "../config.js";
import { verifyWebhookSignature } from "../middleware/signature.js";
import { isDuplicate } from "../utils/dedup.js";
import { isRateLimited } from "../utils/ratelimit.js";
import * as conversationService from "../services/conversation.service.js";
import * as feedbackService from "../services/feedback.service.js";
import * as onboarding from "../services/onboarding.service.js";
import * as userService from "../services/user.service.js";
import { getDb, schema } from "../db/index.js";
import { logger } from "../logger.js";
import type { WebhookPayload, MessageStatus } from "../types/whatsapp.types.js";
import type { Redis } from "ioredis";

export async function webhookRoutes(
  app: FastifyInstance,
  opts: { redis: Redis },
): Promise<void> {
  const { redis } = opts;

  // GET /webhook — Meta verification challenge
  app.get<{
    Querystring: {
      "hub.mode"?: string;
      "hub.verify_token"?: string;
      "hub.challenge"?: string;
    };
  }>("/webhook", async (request, reply) => {
    const mode = request.query["hub.mode"];
    const token = request.query["hub.verify_token"];
    const challenge = request.query["hub.challenge"];

    if (mode === "subscribe" && token === getConfig().WHATSAPP_VERIFY_TOKEN) {
      logger.info("Webhook verified");
      reply.code(200).type("text/plain").send(challenge);
    } else {
      logger.warn("Webhook verification failed");
      reply.code(403).send({ error: "Verification failed" });
    }
  });

  // POST /webhook — Incoming messages and status updates
  app.post("/webhook", {
    preHandler: verifyWebhookSignature,
    handler: async (request, reply) => {
      // Always return 200 immediately to prevent Meta retries
      reply.code(200).send({ status: "ok" });

      const payload = request.body as WebhookPayload;
      if (payload.object !== "whatsapp_business_account") return;

      for (const entry of payload.entry) {
        for (const change of entry.changes) {
          const value = change.value;

          // Process status updates
          if (value.statuses) {
            for (const status of value.statuses) {
              processStatus(status).catch((err) =>
                logger.error({ err }, "Failed to process status"),
              );
            }
          }

          // Process messages
          if (value.messages) {
            for (const message of value.messages) {
              // Deduplication
              const dup = await isDuplicate(redis, message.id);
              if (dup) {
                logger.debug({ messageId: message.id }, "Duplicate message, skipping");
                continue;
              }

              // Rate limiting
              const limited = await isRateLimited(redis, message.from);
              if (limited) {
                logger.warn({ from: message.from }, "Rate limited");
                // Don't send rate limit message too often
                continue;
              }

              // Extract text for onboarding check
              const msgText = message.text?.body
                ?? message.interactive?.button_reply?.title
                ?? message.interactive?.list_reply?.title
                ?? "";

              // Check if user is registered
              const existingUser = await userService.getRegisteredUser(message.from);

              if (!existingUser) {
                // User not registered — handle onboarding flow
                const inOnboarding = await onboarding.isOnboarding(redis, message.from);
                if (inOnboarding) {
                  onboarding.handleOnboardingMessage(redis, message.from, msgText)
                    .catch((err) => logger.error({ err, from: message.from }, "Onboarding error"));
                } else {
                  onboarding.startOnboarding(redis, message.from)
                    .catch((err) => logger.error({ err, from: message.from }, "Failed to start onboarding"));
                }
                continue;
              }

              // Check if this is a feedback button reply
              if (
                message.type === "interactive" &&
                message.interactive?.type === "button_reply"
              ) {
                const buttonId = message.interactive.button_reply?.id ?? "";
                if (buttonId.startsWith("fb_")) {
                  const handled = await feedbackService.processFeedback(
                    existingUser.id,
                    message.from,
                    buttonId,
                  );
                  if (handled) continue;
                }
              }

              // Process message asynchronously
              const contact = value.contacts?.[0];
              conversationService
                .processIncomingMessage(message, contact)
                .catch((err) =>
                  logger.error({ err, messageId: message.id }, "Unhandled error processing message"),
                );
            }
          }
        }
      }
    },
  });
}

async function processStatus(status: MessageStatus): Promise<void> {
  const db = getDb();
  await db.insert(schema.messageDeliveryLog).values({
    whatsappMessageId: status.id,
    status: status.status,
    errorCode: status.errors?.[0]?.code,
    errorMessage: status.errors?.[0]?.message,
    timestamp: new Date(parseInt(status.timestamp) * 1000),
  });
}
