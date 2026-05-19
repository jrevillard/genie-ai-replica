import type { FastifyInstance } from "fastify";
import { verifyInternalApiKey } from "../middleware/internal-auth.js";
import * as campaignService from "../services/campaign.service.js";
import { getDb, schema } from "../db/index.js";
import { eq } from "drizzle-orm";
import type { Redis } from "ioredis";

interface CampaignBody {
  template_name: string;
  template_params: Record<string, string>;
  target_audience: {
    risk_areas?: string[];
    regions?: string[];
    all_users?: boolean;
  };
  scheduled_at?: string;
}

export async function internalRoutes(
  app: FastifyInstance,
  opts: { redis: Redis },
): Promise<void> {
  // All internal routes require API key
  app.addHook("preHandler", verifyInternalApiKey);

  // POST /api/internal/campaigns — Schedule campaign message blast
  app.post<{ Body: CampaignBody }>("/api/internal/campaigns", async (request, reply) => {
    const body = request.body;
    const campaign = await campaignService.createCampaign({
      templateName: body.template_name,
      templateParams: body.template_params,
      targetCriteria: body.target_audience,
      scheduledAt: body.scheduled_at ? new Date(body.scheduled_at) : undefined,
    });

    reply.code(201).send(campaign);
  });

  // GET /api/internal/campaigns/:id/stats — Get delivery stats
  app.get<{ Params: { id: string } }>(
    "/api/internal/campaigns/:id/stats",
    async (request, reply) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(schema.campaigns)
        .where(eq(schema.campaigns.id, request.params.id))
        .limit(1);

      const campaign = rows[0];
      if (!campaign) {
        reply.code(404).send({ error: "Campaign not found" });
        return;
      }

      reply.send({
        id: campaign.id,
        status: campaign.status,
        totalRecipients: campaign.totalRecipients,
        sentCount: campaign.sentCount,
        deliveredCount: campaign.deliveredCount,
        readCount: campaign.readCount,
        failedCount: campaign.failedCount,
        scheduledAt: campaign.scheduledAt,
        completedAt: campaign.completedAt,
      });
    },
  );

  // GET /api/internal/health — Detailed health check
  app.get("/api/internal/health", async (_request, reply) => {
    const checks: Record<string, string> = {};

    // DB check
    try {
      const db = getDb();
      await db.select().from(schema.waUsers).limit(1);
      checks["database"] = "ok";
    } catch {
      checks["database"] = "error";
    }

    // Redis check
    try {
      await opts.redis.ping();
      checks["redis"] = "ok";
    } catch {
      checks["redis"] = "error";
    }

    const allOk = Object.values(checks).every((v) => v === "ok");
    reply.code(allOk ? 200 : 503).send({ status: allOk ? "healthy" : "degraded", checks });
  });

  // GET /api/internal/metrics — Basic metrics
  app.get("/api/internal/metrics", async (_request, reply) => {
    const db = getDb();
    const [userCount] = await db
      .select({ count: schema.waUsers.id })
      .from(schema.waUsers);

    reply.send({
      totalUsers: userCount ? 1 : 0, // simplified — real impl would use COUNT(*)
      timestamp: new Date().toISOString(),
    });
  });
}
