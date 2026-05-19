import * as genieai from "./genieai.service.js";
import * as whatsapp from "./whatsapp.service.js";
import * as sttService from "./stt.service.js";
import * as userService from "./user.service.js";
import * as formatter from "./formatter.service.js";
import * as feedbackService from "./feedback.service.js";
import { getConfig } from "../config.js";
import { logger } from "../logger.js";
import { CONVERSATION_TIMEOUT_MS, EMERGENCY_KEYWORDS, SPECIAL_COMMANDS } from "../types/common.types.js";
import type { WaUser } from "../types/common.types.js";
import type { IncomingMessage, WebhookContact } from "../types/whatsapp.types.js";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";

/**
 * Main entry point: process an incoming WhatsApp message
 */
export async function processIncomingMessage(
  message: IncomingMessage,
  _contact: WebhookContact | undefined,
): Promise<void> {
  const phoneNumber = message.from;
  const startTime = Date.now();

  try {
    // Mark as read
    await whatsapp.markAsRead(message.id).catch(() => {});

    // Check if user is registered
    const user = await userService.getRegisteredUser(phoneNumber);
    if (!user) {
      await whatsapp.sendText(phoneNumber, "Please complete registration first. Send any message to start.");
      return;
    }

    // Check if email verification is pending — try to login with stored password
    if (user.genieaiAccessToken === "pending-email-verification") {
      if (user.genieaiEncPassword) {
        try {
          // Attempt login — will succeed if user has verified their email
          const loginRes = await genieai.login(user.genieaiLoginName, user.genieaiEncPassword);
          // Success! Update the stored token
          const db = getDb();
          await db
            .update(schema.waUsers)
            .set({
              genieaiAccessToken: loginRes.accessToken,
              genieaiRefreshToken: loginRes.refreshToken,
              genieaiTokenExpiresAt: new Date(Date.now() + 23 * 60 * 60 * 1000),
              updatedAt: new Date(),
            })
            .where(eq(schema.waUsers.id, user.id));
          user.genieaiAccessToken = loginRes.accessToken;
          user.genieaiRefreshToken = loginRes.refreshToken;
          logger.info({ phoneNumber }, "Email verified — login successful, token updated");
        } catch {
          // Login still fails — email not yet verified
          await whatsapp.sendText(
            phoneNumber,
            "⚠️ Your email hasn't been verified yet.\n\n" +
            "Please check your inbox and click the verification link, then message me again.\n\n" +
            "If you didn't receive the email, check your spam folder.",
          );
          return;
        }
      } else {
        await whatsapp.sendText(
          phoneNumber,
          "⚠️ Your email hasn't been verified yet.\n\n" +
          "Please check your inbox and click the verification link, then message me again.",
        );
        return;
      }
    }

    await userService.updateLastMessage(user.id);

    // Extract text content based on message type
    const textContent = await extractTextContent(message, phoneNumber);
    if (textContent === null) return; // message type was handled (ignored or unsupported reply sent)

    // Check for emergency keywords first
    if (isEmergency(textContent)) {
      await sendEmergencyResponse(phoneNumber);
      await logMessage(user.id, message.id, "inbound", message.type, textContent, Date.now() - startTime);
      return;
    }

    // Check for special commands
    const command = matchSpecialCommand(textContent);
    if (command) {
      await handleSpecialCommand(command, user, phoneNumber);
      await logMessage(user.id, message.id, "inbound", message.type, textContent, Date.now() - startTime);
      return;
    }

    // Get valid auth token
    const token = await userService.ensureValidToken(user);

    // Get or create active conversation
    const conversationId = await getOrCreateConversation(user, token);

    // Add user message to conversation history
    await genieai.addMessage(token, conversationId, {
      content: textContent,
      sender: "user",
    });

    // Fetch conversation history for context
    const historyRes = await genieai.getMessages(token, conversationId, { limit: "20", newestFirst: "true" });
    const messages = historyRes.messages
      .reverse()
      .map((m) => ({
        role: m.sender as "user" | "assistant",
        content: m.content,
      }));

    // Submit query to Genie AI backend
    const queryRes = await genieai.createQuery(token, {
      userId: user.genieaiUserId,
      sessionId: `wa_${user.id}`,
      messages,
      context: {
        categoryLabel: "Healthcare",
        serviceLabels: ["NCD Prevention", "Health Guidance"],
        language: "EN",
      },
      contextOption: "conversation-with-context-labels",
    });

    // Add assistant response to conversation history
    await genieai.addMessage(token, conversationId, {
      content: queryRes.response,
      sender: "assistant",
      queryId: queryRes._key,
    });

    // Format and send response
    const formattedParts = formatter.formatBotResponse(
      queryRes.response,
      queryRes.metadata?.source_documents,
    );

    for (const part of formattedParts) {
      await whatsapp.sendText(phoneNumber, part);
    }

    // Periodically prompt for feedback
    if (user.messageCount > 0 && user.messageCount % 5 === 0) {
      await feedbackService.promptFeedback(phoneNumber, queryRes._key);
    }

    const processingTime = Date.now() - startTime;
    await logMessage(user.id, message.id, "inbound", message.type, textContent, processingTime, queryRes._key);

    logger.info(
      { phoneNumber, processingTime, queryId: queryRes._key },
      "Message processed successfully",
    );
  } catch (err) {
    logger.error({ err, phoneNumber, messageId: message.id }, "Failed to process message");

    // Build a user-facing error message with details
    let errorDetail = "I'm having trouble processing your message right now.";
    if (err instanceof genieai.GenieAIApiError) {
      const data = err.data as { message?: string } | undefined;
      const backendMsg = data?.message ?? "";
      errorDetail = `Backend error (${err.statusCode}): ${backendMsg || "Unknown error"}`;
      if (err.statusCode === 401) {
        errorDetail += "\n\nYour session may have expired. Please try again.";
      }
    } else if (err instanceof Error) {
      errorDetail = `Error: ${err.message}`;
    }

    try {
      await whatsapp.sendText(
        phoneNumber,
        `⚠️ ${errorDetail}\n\nPlease try again in a few minutes.`,
      );
    } catch {
      // If we can't even send the error message, just log it
      logger.error({ phoneNumber }, "Failed to send error message to user");
    }
  }
}

async function extractTextContent(
  message: IncomingMessage,
  phoneNumber: string,
): Promise<string | null> {
  switch (message.type) {
    case "text":
      return message.text?.body ?? "";

    case "audio": {
      const cfg = getConfig();
      if (!cfg.STT_SERVICE_URL) {
        await whatsapp.sendText(
          phoneNumber,
          "Voice message support is not yet available. Please type your question instead.",
        );
        return null;
      }
      try {
        const audioBuffer = await whatsapp.downloadMedia(message.audio!.id);
        const result = await sttService.transcribeAudio(audioBuffer, message.audio!.mime_type);
        // Send transcription confirmation
        await whatsapp.sendText(phoneNumber, `🎤 _I heard: "${result.text}"_`);
        return result.text;
      } catch (err) {
        logger.error({ err }, "STT transcription failed");
        await whatsapp.sendText(
          phoneNumber,
          "I couldn't process your voice message. Could you please type your question instead?",
        );
        return null;
      }
    }

    case "interactive": {
      if (message.interactive?.type === "button_reply") {
        return message.interactive.button_reply?.id ?? "";
      }
      if (message.interactive?.type === "list_reply") {
        return message.interactive.list_reply?.id ?? "";
      }
      return "";
    }

    case "location": {
      if (message.location) {
        return `My location is: ${message.location.latitude}, ${message.location.longitude}`;
      }
      return null;
    }

    case "image":
    case "document":
      await whatsapp.sendText(
        phoneNumber,
        "I can only process text and voice messages for now. Please type your question.",
      );
      return null;

    case "reaction":
    case "sticker":
    case "contacts":
      // Silently ignore
      return null;

    default:
      return null;
  }
}

async function getOrCreateConversation(user: WaUser, token: string): Promise<string> {
  // Check if active conversation is still valid (within 24h)
  if (
    user.activeConversationId &&
    user.conversationStartedAt &&
    Date.now() - user.conversationStartedAt.getTime() < CONVERSATION_TIMEOUT_MS
  ) {
    return user.activeConversationId;
  }

  // Create new conversation
  const conv = await genieai.createConversation(token, {
    title: `WhatsApp Chat ${new Date().toISOString().slice(0, 10)}`,
    categoryId: undefined,
  });

  await userService.updateActiveConversation(user.id, conv._key);
  return conv._key;
}

function isEmergency(text: string): boolean {
  const lower = text.toLowerCase();
  return EMERGENCY_KEYWORDS.some((kw) => lower.includes(kw));
}

function matchSpecialCommand(text: string): string | null {
  const lower = text.toLowerCase().trim();
  const match = SPECIAL_COMMANDS.find((cmd) => lower === cmd);
  return match ?? null;
}

async function handleSpecialCommand(
  command: string,
  user: WaUser,
  phoneNumber: string,
): Promise<void> {
  switch (command) {
    case "/help":
    case "help":
      await whatsapp.sendText(
        phoneNumber,
        `*Genie AI Health Assistant*\n\nI can help you with:\n• Health questions about NCDs (diabetes, blood pressure, etc.)\n• Tips for healthier habits\n• Risk assessment\n• Medication reminders\n\n*Commands:*\n/risk — Check your health risk\n/menu — See all options\n/facilities — Find health centres near you\n/about — About this service\n/stop — Unsubscribe from messages\n\nJust type any health question to get started!`,
      );
      break;

    case "/stop":
    case "stop":
    case "unsubscribe":
    case "opt out":
      await userService.handleOptOut(user.id);
      await whatsapp.sendText(
        phoneNumber,
        "You have been unsubscribed from all messages. Send any message to re-subscribe.",
      );
      break;

    case "/risk":
      await whatsapp.sendText(
        phoneNumber,
        "Let's do a quick health check! I'll ask you a few simple questions.\n\nHow old are you?",
      );
      break;

    case "/feedback":
      await whatsapp.sendText(
        phoneNumber,
        "We'd love to hear your thoughts! Please type your feedback and I'll pass it along to our team.",
      );
      break;

    case "/language":
      await whatsapp.sendText(
        phoneNumber,
        "Currently, I'm available in *English* only. More languages are coming soon!",
      );
      break;

    case "/about":
      await whatsapp.sendText(
        phoneNumber,
        `*Genie AI Health Assistant*\nVersion 1.0\n\nA free health information service by Young AI Leaders Linz Hub, part of the IEEE-ITU GenAI for Good Challenge.\n\n⚠️ This service provides health *information* only. It is NOT a substitute for professional medical advice, diagnosis, or treatment.\n\nIn an emergency, call *116* or go to your nearest health facility.\n\nYour data is kept confidential. Type /stop to unsubscribe at any time.`,
      );
      break;

    case "/app":
      await whatsapp.sendText(
        phoneNumber,
        "The Genie AI mobile app is coming soon! It will offer additional features like vital data tracking, medication reminders, and offline support. Stay tuned!",
      );
      break;

    case "/facilities":
      await whatsapp.sendButtons(phoneNumber, "To find health facilities near you, I'll need your location.\n\nYou can:\n1. Share your location using the 📎 attachment button\n2. Tell me your region (e.g., \"Western\", \"Banjul\")", [
        { id: "facilities_western", title: "Western Region" },
        { id: "facilities_banjul", title: "Banjul" },
        { id: "facilities_other", title: "Other Region" },
      ]);
      break;

    case "/menu":
      await whatsapp.sendList(
        phoneNumber,
        "What would you like to do?",
        "Choose an option",
        [
          {
            title: "Health",
            rows: [
              { id: "menu_question", title: "Ask a health question", description: "Get NCD advice" },
              { id: "menu_risk", title: "Health risk check", description: "3-minute assessment" },
              { id: "menu_facilities", title: "Find health centres", description: "Near you" },
            ],
          },
          {
            title: "Settings",
            rows: [
              { id: "menu_about", title: "About this service" },
              { id: "menu_feedback", title: "Give feedback" },
              { id: "menu_stop", title: "Unsubscribe" },
            ],
          },
        ],
      );
      break;
  }
}

async function sendEmergencyResponse(phoneNumber: string): Promise<void> {
  await whatsapp.sendText(
    phoneNumber,
    "🚨 *EMERGENCY*\n\nIf you or someone near you is in a medical emergency:\n\n📞 *Call 116* (ambulance)\n🏥 *Go to the nearest health facility immediately*\n\nI am an AI assistant and cannot provide emergency medical care. Please seek professional help right away.",
  );
}

async function logMessage(
  waUserId: string,
  whatsappMessageId: string,
  direction: string,
  messageType: string,
  contentPreview: string | null,
  processingTimeMs: number,
  queryId?: string,
): Promise<void> {
  try {
    const db = getDb();
    await db.insert(schema.messageLog).values({
      waUserId,
      whatsappMessageId,
      direction,
      messageType,
      contentPreview: contentPreview?.slice(0, 500) ?? null,
      genieaiQueryId: queryId,
      processingTimeMs,
    });
  } catch (err) {
    logger.error({ err }, "Failed to log message");
  }
}

/**
 * Send the welcome message to a first-time user
 */
export async function sendWelcomeMessage(phoneNumber: string): Promise<void> {
  await whatsapp.sendButtons(
    phoneNumber,
    "Welcome to the *Genie AI Health Assistant*! 🏥\n\nI can help you with:\n• Understanding health risks (high blood pressure, diabetes, cancer, and more)\n• Tips for healthier habits (diet, exercise, quitting smoking)\n• Medication and appointment reminders\n• Answering your health questions in simple language\n\nThis service is *free and confidential*.\n\nWould you like to start with a quick health check? It takes about 3 minutes.",
    [
      { id: "welcome_risk_yes", title: "Yes, let's go" },
      { id: "welcome_risk_no", title: "I have a question" },
    ],
  );
}
