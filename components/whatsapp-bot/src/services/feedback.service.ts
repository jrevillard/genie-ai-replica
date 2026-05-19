import * as whatsapp from "./whatsapp.service.js";
import * as genieai from "./genieai.service.js";
import * as userService from "./user.service.js";
import { getDb, schema } from "../db/index.js";
import { logger } from "../logger.js";

/**
 * Send a feedback prompt to the user after a bot response
 */
export async function promptFeedback(
  phoneNumber: string,
  queryId: string,
): Promise<void> {
  await whatsapp.sendButtons(phoneNumber, "How helpful was this response?", [
    { id: `fb_up_${queryId}`, title: "👍 Helpful" },
    { id: `fb_down_${queryId}`, title: "👎 Not helpful" },
  ]);
}

/**
 * Process a feedback response (from interactive button reply)
 */
export async function processFeedback(
  userId: string,
  phoneNumber: string,
  buttonId: string,
): Promise<boolean> {
  const upMatch = buttonId.match(/^fb_up_(.+)$/);
  const downMatch = buttonId.match(/^fb_down_(.+)$/);

  if (!upMatch && !downMatch) return false;

  const queryId = upMatch?.[1] ?? downMatch?.[1];
  const isPositive = !!upMatch;

  if (!queryId) return false;

  try {
    // Log locally
    const db = getDb();
    await db.insert(schema.feedbackLog).values({
      waUserId: userId,
      genieaiQueryId: queryId,
      rating: isPositive ? "up" : "down",
    });

    // Submit to Genie AI backend
    const user = await userService.findByPhone(phoneNumber);
    if (user) {
      const token = await userService.ensureValidToken(user);
      await genieai.submitFeedback(token, queryId, {
        rating: isPositive ? 5 : 1,
        comment: `WhatsApp feedback: ${isPositive ? "helpful" : "not helpful"}`,
      });
    }

    if (isPositive) {
      await whatsapp.sendText(phoneNumber, "Thanks for the feedback! 😊");
    } else {
      await whatsapp.sendText(
        phoneNumber,
        "Sorry about that. Could you briefly tell me what was wrong? (Type your feedback or send /skip)",
      );
    }
  } catch (err) {
    logger.error({ err, queryId }, "Failed to process feedback");
  }

  return true;
}
