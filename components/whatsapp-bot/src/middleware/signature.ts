import { createHmac } from "node:crypto";
import type { FastifyRequest, FastifyReply } from "fastify";
import { getConfig } from "../config.js";
import { logger } from "../logger.js";

/**
 * Verify the HMAC-SHA256 signature of incoming WhatsApp webhooks.
 * Meta signs the raw request body with the app secret.
 */
export async function verifyWebhookSignature(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const signature = request.headers["x-hub-signature-256"];
  if (!signature || typeof signature !== "string") {
    logger.warn("Missing X-Hub-Signature-256 header");
    reply.code(401).send({ error: "Missing signature" });
    return;
  }

  const cfg = getConfig();
  const rawBody = (request as unknown as { rawBody?: Buffer }).rawBody;
  if (!rawBody) {
    logger.warn("No raw body available for signature verification");
    reply.code(401).send({ error: "No body" });
    return;
  }

  const expectedSignature =
    "sha256=" +
    createHmac("sha256", cfg.WHATSAPP_APP_SECRET)
      .update(rawBody)
      .digest("hex");

  if (signature !== expectedSignature) {
    logger.warn("Invalid webhook signature");
    reply.code(401).send({ error: "Invalid signature" });
    return;
  }
}
