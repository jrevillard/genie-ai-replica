import { eq, and, lte } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";
import * as whatsapp from "./whatsapp.service.js";
import { logger } from "../logger.js";
import type { RiskProfile } from "../types/genieai.types.js";

/** Nudge content templates per risk area */
const NUDGE_TIPS: Record<string, string[]> = {
  tobacco: [
    "💡 Tip: When a craving hits, try taking 5 slow breaths. Count to 4 breathing in, count to 6 breathing out. The craving will pass in 3-5 minutes.",
    "💡 Tip: Drink a glass of water when you feel like smoking. It helps reduce the urge and keeps you hydrated.",
    "💡 Tip: Identify your smoking triggers. Is it stress? Boredom? After meals? Once you know them, you can plan alternatives.",
    "💡 Tip: Tell a friend or family member about your goal to quit. Support from others makes a big difference.",
    "💡 Tip: Chew on a kola nut, gum, or a small snack when you feel the urge to smoke. Keeping your mouth busy helps.",
  ],
  hypertension: [
    "💡 Tip: Reduce salt in your cooking. Try using more spices, lemon, or herbs for flavor instead.",
    "💡 Tip: Walking for just 30 minutes a day can help lower your blood pressure. Start small — even 10 minutes helps.",
    "💡 Tip: Stress raises blood pressure. Try a simple relaxation exercise: close your eyes and breathe slowly for 2 minutes.",
    "💡 Tip: Eating more fruits and vegetables helps keep your blood pressure healthy. Try adding one extra serving today.",
  ],
  diabetes: [
    "💡 Tip: Eating regular meals helps keep your blood sugar stable. Try not to skip meals.",
    "💡 Tip: Choose whole grains over white rice or white bread when possible. They release sugar more slowly.",
    "💡 Tip: A short walk after meals helps your body use sugar better. Even 10 minutes makes a difference.",
    "💡 Tip: Drink water instead of sugary drinks. One glass of soda can contain 10 teaspoons of sugar.",
  ],
  mentalHealth: [
    "💡 Tip: It's OK not to feel OK. If you're feeling down, talking to someone you trust can help.",
    "💡 Tip: Try to get some sunlight and fresh air today. Even a few minutes outside can lift your mood.",
    "💡 Tip: Good sleep helps your mental health. Try going to bed and waking up at the same time each day.",
    "💡 Tip: Physical activity is one of the best things for your mood. Dancing, walking, or any movement counts!",
  ],
  physicalActivity: [
    "💡 Tip: You don't need a gym! Walking, dancing, gardening, or playing with children all count as exercise.",
    "💡 Tip: Start with just 10 minutes of movement today. You can build up gradually.",
    "💡 Tip: Take the stairs instead of the elevator when you can. Small changes add up!",
  ],
  diet: [
    "💡 Tip: Try to eat at least 5 servings of fruits and vegetables each day. Fresh, local produce is best.",
    "💡 Tip: Cook at home more often. Home-cooked meals are usually healthier and cheaper than eating out.",
    "💡 Tip: Reduce your intake of fried foods. Grilling, boiling, or steaming are healthier cooking methods.",
  ],
};

/**
 * Calculate and create scheduled nudge messages based on a user's risk profile
 */
export async function scheduleNudgesForUser(
  waUserId: string,
  riskProfile: RiskProfile,
  preferredTime: string = "09:00",
): Promise<void> {
  const db = getDb();

  // Deactivate existing nudges for this user
  await db
    .update(schema.scheduledMessages)
    .set({ active: false, updatedAt: new Date() })
    .where(eq(schema.scheduledMessages.waUserId, waUserId));

  const schedules: Array<{ area: string; cron: string }> = [];

  // Determine nudge frequency based on risk levels
  if (riskProfile.tobacco === "medium" || riskProfile.tobacco === "high") {
    schedules.push({ area: "tobacco", cron: `0 ${preferredTime.split(":")[0]} * * *` }); // daily
  }
  if (riskProfile.hypertension === "medium" || riskProfile.hypertension === "high") {
    schedules.push({ area: "hypertension", cron: `0 ${preferredTime.split(":")[0]} * * 1,4` }); // Mon, Thu
  }
  if (riskProfile.diabetes === "medium" || riskProfile.diabetes === "high") {
    schedules.push({ area: "diabetes", cron: `0 ${preferredTime.split(":")[0]} * * 2,5` }); // Tue, Fri
  }
  if (riskProfile.mentalHealth === "medium" || riskProfile.mentalHealth === "high") {
    schedules.push({ area: "mentalHealth", cron: `0 ${preferredTime.split(":")[0]} * * 3` }); // Wed
  }
  if (riskProfile.physicalActivity === "medium" || riskProfile.physicalActivity === "high") {
    schedules.push({ area: "physicalActivity", cron: `0 ${preferredTime.split(":")[0]} * * 1,3,5` }); // Mon, Wed, Fri
  }
  if (riskProfile.diet === "medium" || riskProfile.diet === "high") {
    schedules.push({ area: "diet", cron: `0 ${preferredTime.split(":")[0]} * * 2,6` }); // Tue, Sat
  }

  // Create scheduled messages
  for (const sched of schedules) {
    const tips = NUDGE_TIPS[sched.area] ?? [];
    const randomTip = tips[Math.floor(Math.random() * tips.length)] ?? "Stay healthy today! 💪";

    await db.insert(schema.scheduledMessages).values({
      waUserId,
      templateName: "daily_health_tip",
      templateParams: { "1": randomTip },
      scheduleType: "recurring",
      cronExpression: sched.cron,
      nextRunAt: calculateNextRun(sched.cron),
      active: true,
    });
  }

  logger.info({ waUserId, nudgeCount: schedules.length }, "Nudges scheduled");
}

/**
 * Process all due nudge messages
 */
export async function processDueNudges(): Promise<void> {
  const db = getDb();
  const now = new Date();

  const dueMessages = await db
    .select({
      scheduled: schema.scheduledMessages,
      user: schema.waUsers,
    })
    .from(schema.scheduledMessages)
    .innerJoin(schema.waUsers, eq(schema.scheduledMessages.waUserId, schema.waUsers.id))
    .where(
      and(
        eq(schema.scheduledMessages.active, true),
        lte(schema.scheduledMessages.nextRunAt, now),
        eq(schema.waUsers.optedOut, false),
      ),
    );

  for (const { scheduled, user } of dueMessages) {
    try {
      const params = scheduled.templateParams as Record<string, string> | null;
      const tipText = params?.["1"] ?? "Stay healthy today! 💪";

      await whatsapp.sendTemplate(user.phoneNumber, scheduled.templateName, "en", [
        {
          type: "body",
          parameters: [{ type: "text", text: tipText }],
        },
      ]);

      // Update last run and calculate next run
      const nextRun = scheduled.cronExpression
        ? calculateNextRun(scheduled.cronExpression)
        : null;

      // Rotate the tip for next time
      const area = Object.entries(NUDGE_TIPS).find(([_, tips]) => tips.includes(tipText))?.[0];
      const tips = area ? NUDGE_TIPS[area] ?? [] : [];
      const currentIndex = tips.indexOf(tipText);
      const nextTip = tips[(currentIndex + 1) % tips.length] ?? tipText;

      await db
        .update(schema.scheduledMessages)
        .set({
          lastRunAt: now,
          nextRunAt: nextRun,
          templateParams: { "1": nextTip },
          active: nextRun !== null,
          updatedAt: new Date(),
        })
        .where(eq(schema.scheduledMessages.id, scheduled.id));

      logger.debug({ userId: user.id, template: scheduled.templateName }, "Nudge sent");
    } catch (err) {
      logger.error({ err, scheduledId: scheduled.id }, "Failed to send nudge");
    }
  }
}

/**
 * Simple next-run calculation from a cron expression.
 * Supports: minute hour * * day_of_week
 */
function calculateNextRun(cron: string): Date {
  const parts = cron.split(" ");
  const minute = parseInt(parts[0] ?? "0");
  const hour = parseInt(parts[1] ?? "9");
  const daysOfWeek = parts[4]?.split(",").map(Number) ?? [];

  const now = new Date();
  const candidate = new Date(now);
  candidate.setMinutes(minute, 0, 0);
  candidate.setHours(hour);

  if (daysOfWeek.length === 0) {
    // Daily: next occurrence is tomorrow if today's time has passed
    if (candidate <= now) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate;
  }

  // Find the next matching day of week
  for (let i = 0; i < 8; i++) {
    const testDate = new Date(candidate);
    testDate.setDate(candidate.getDate() + i);
    if (daysOfWeek.includes(testDate.getDay()) && testDate > now) {
      return testDate;
    }
  }

  // Fallback: tomorrow
  candidate.setDate(candidate.getDate() + 1);
  return candidate;
}
