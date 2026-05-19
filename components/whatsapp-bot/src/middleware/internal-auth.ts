import type { FastifyRequest, FastifyReply } from "fastify";
import { getConfig } from "../config.js";

/**
 * Verify the API key for internal endpoints (campaigns, health, metrics).
 */
export async function verifyInternalApiKey(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    reply.code(401).send({ error: "Missing API key" });
    return;
  }

  const token = authHeader.slice(7);
  if (token !== getConfig().INTERNAL_API_KEY) {
    reply.code(403).send({ error: "Invalid API key" });
    return;
  }
}
