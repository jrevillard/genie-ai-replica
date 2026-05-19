import { getDb, schema } from "../db/index.js";
import * as whatsapp from "./whatsapp.service.js";
import * as genieai from "./genieai.service.js";
import { normalizePhoneNumber } from "../utils/phone.js";
import { logger } from "../logger.js";
import type { Redis } from "ioredis";

/**
 * Onboarding state machine for WhatsApp users.
 *
 * States: await_name → await_email → await_password → registering → done
 *
 * State is stored in Redis with a 1-hour TTL (abandoned onboarding expires).
 */

interface OnboardingState {
  step: "await_name" | "await_email" | "await_password" | "done";
  fullName?: string;
  email?: string;
  phoneNumber: string;
}

const ONBOARDING_PREFIX = "onboarding:";
const ONBOARDING_TTL = 3600; // 1 hour

async function getState(redis: Redis, phoneNumber: string): Promise<OnboardingState | null> {
  const raw = await redis.get(`${ONBOARDING_PREFIX}${phoneNumber}`);
  return raw ? (JSON.parse(raw) as OnboardingState) : null;
}

async function setState(redis: Redis, phoneNumber: string, state: OnboardingState): Promise<void> {
  await redis.set(`${ONBOARDING_PREFIX}${phoneNumber}`, JSON.stringify(state), "EX", ONBOARDING_TTL);
}

async function clearState(redis: Redis, phoneNumber: string): Promise<void> {
  await redis.del(`${ONBOARDING_PREFIX}${phoneNumber}`);
}

/**
 * Check if a phone number is in the onboarding flow.
 */
export async function isOnboarding(redis: Redis, phoneNumber: string): Promise<boolean> {
  const state = await getState(redis, phoneNumber);
  return state !== null && state.step !== "done";
}

/**
 * Start the onboarding flow for a new phone number.
 */
export async function startOnboarding(redis: Redis, phoneNumber: string): Promise<void> {
  const state: OnboardingState = { step: "await_name", phoneNumber };
  await setState(redis, phoneNumber, state);

  await whatsapp.sendText(
    phoneNumber,
    "Welcome to the *Genie AI Health Assistant*! 🏥\n\n" +
    "I can help you with health questions about NCDs like diabetes, high blood pressure, and more.\n\n" +
    "Let's set up your account first. It only takes a moment.",
  );

  await whatsapp.sendText(
    phoneNumber,
    "What is your *full name*? (e.g., Bakary Jallow)",
  );
}

/**
 * Process a message from a user who is in the onboarding flow.
 * Returns true if the message was handled, false if onboarding is complete.
 */
export async function handleOnboardingMessage(
  redis: Redis,
  phoneNumber: string,
  messageText: string,
): Promise<boolean> {
  const state = await getState(redis, phoneNumber);
  if (!state || state.step === "done") return false;

  switch (state.step) {
    case "await_name": {
      const name = messageText.trim();
      if (name.length < 2) {
        await whatsapp.sendText(phoneNumber, "Please enter your full name (at least 2 characters).");
        return true;
      }
      state.fullName = name;
      state.step = "await_email";
      await setState(redis, phoneNumber, state);

      await whatsapp.sendText(
        phoneNumber,
        `Thanks, *${name}*! 👋\n\nNow, what is your *email address*?\n\n` +
        "We'll send a verification link to this email. " +
        "You can also use this email to log in to the Genie AI mobile app or web portal later.",
      );
      return true;
    }

    case "await_email": {
      const email = messageText.trim().toLowerCase();
      if (!isValidEmail(email)) {
        await whatsapp.sendText(
          phoneNumber,
          "That doesn't look like a valid email address. Please try again.\n\nExample: yourname@gmail.com",
        );
        return true;
      }
      state.email = email;
      state.step = "await_password";
      await setState(redis, phoneNumber, state);

      await whatsapp.sendText(
        phoneNumber,
        "Great! Now choose a *password* for your account.\n\n" +
        "Requirements:\n" +
        "• At least 8 characters\n" +
        "• Your password will be securely encrypted\n\n" +
        "Type your password now. (This message will only be seen by you.)",
      );
      return true;
    }

    case "await_password": {
      const password = messageText.trim();
      if (password.length < 8) {
        await whatsapp.sendText(
          phoneNumber,
          "Your password must be at least 8 characters long. Please try again.",
        );
        return true;
      }

      await whatsapp.sendText(phoneNumber, "Setting up your account... ⏳");

      try {
        const result = await completeRegistration(
          state.phoneNumber,
          state.fullName!,
          state.email!,
          password,
        );

        await clearState(redis, phoneNumber);

        const hasRealToken = result.accessToken && result.accessToken !== "pending-email-verification";

        const accountInfo =
          `Your login name is: *${result.loginName}*\n` +
          "You can use this along with your password to log in to the Genie AI web portal or mobile app.";

        if (hasRealToken) {
          await whatsapp.sendText(
            phoneNumber,
            "✅ *Account created!*\n\n" +
            `Welcome, *${state.fullName}*!\n\n` +
            `${accountInfo}\n\n` +
            `📧 A verification email has been sent to *${state.email}*. ` +
            "Please verify when you get a chance.\n\n" +
            "You can start asking me health questions right away!\n\n" +
            "Try asking something like:\n" +
            '• "What are the symptoms of high blood pressure?"\n' +
            '• "How can I reduce my risk of diabetes?"\n' +
            "• Type /menu to see all options",
          );
        } else {
          await whatsapp.sendText(
            phoneNumber,
            "✅ *Account created!*\n\n" +
            `Welcome, *${state.fullName}*!\n\n` +
            `${accountInfo}\n\n` +
            `📧 A verification email has been sent to *${state.email}*.\n\n` +
            "⚠️ *Please check your inbox and click the verification link* before we can start chatting. " +
            "Once verified, send me any message and I'll be ready to help!\n\n" +
            "If you don't see the email, check your spam folder.",
          );
        }

        return true;
      } catch (err) {
        logger.error({ err, phoneNumber }, "Registration failed during onboarding");

        const errorMessage = err instanceof genieai.GenieAIApiError
          ? extractUserFriendlyError(err)
          : "Something went wrong. Please try again.";

        await whatsapp.sendText(phoneNumber, `❌ ${errorMessage}`);

        // Reset to allow retry
        state.step = "await_name";
        state.fullName = undefined;
        state.email = undefined;
        await setState(redis, phoneNumber, state);

        await whatsapp.sendText(
          phoneNumber,
          "Let's try again. What is your *full name*?",
        );
        return true;
      }
    }

    default:
      return false;
  }
}

async function completeRegistration(
  phoneNumber: string,
  fullName: string,
  email: string,
  password: string,
): Promise<{ userId: string; loginName: string; accessToken: string }> {
  const normalized = normalizePhoneNumber(phoneNumber);
  const loginName = `wa_${normalized.replace("+", "")}`;

  const result = await genieai.registerWithPassword(loginName, email, password, fullName, normalized);

  // Save locally
  const tokenExpiry = new Date(Date.now() + 23 * 60 * 60 * 1000);
  const db = getDb();
  await db.insert(schema.waUsers).values({
    phoneNumber: normalized,
    genieaiUserId: result.userId,
    genieaiLoginName: result.loginName,
    genieaiEncPassword: result.encPassword,
    genieaiAccessToken: result.accessToken,
    genieaiRefreshToken: result.refreshToken,
    genieaiTokenExpiresAt: tokenExpiry,
    displayName: fullName,
  });

  logger.info({ phoneNumber: normalized, userId: result.userId, loginName }, "WhatsApp user onboarding complete");
  return { userId: result.userId, loginName, accessToken: result.accessToken };
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function extractUserFriendlyError(err: genieai.GenieAIApiError): string {
  const data = err.data as { message?: string } | undefined;
  const msg = data?.message ?? "";
  // Pass through the detailed messages we set in registerWithPassword
  if (msg.length > 0 && !msg.includes("already exists")) {
    return msg;
  }
  if (msg.includes("Email already exists") || msg.includes("email")) {
    return "This email is already registered. Please try a different email address.";
  }
  if (msg.includes("Username already exists") || msg.includes("phone number")) {
    return msg;
  }
  return "Registration failed. Please try again or type /help for assistance.";
}
