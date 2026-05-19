/** Local user record linking WhatsApp phone number to Genie AI account */
export interface WaUser {
  id: string;
  phoneNumber: string;
  genieaiUserId: string;
  genieaiLoginName: string;
  genieaiEncPassword: string;
  genieaiAccessToken: string;
  genieaiRefreshToken: string;
  genieaiTokenExpiresAt: Date;
  activeConversationId: string | null;
  conversationStartedAt: Date | null;
  displayName: string | null;
  riskProfileJson: Record<string, unknown> | null;
  preferredNudgeTime: string | null;
  region: string | null;
  optedOut: boolean;
  optedOutAt: Date | null;
  lastMessageAt: Date | null;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/** STT service response */
export interface SttResponse {
  text: string;
  language: string;
  confidence: number;
}

/** TTS service request */
export interface TtsRequest {
  text: string;
  language: string;
  voice?: string;
}

/** Special commands the bot recognizes */
export const SPECIAL_COMMANDS = [
  "/help",
  "help",
  "/stop",
  "stop",
  "unsubscribe",
  "opt out",
  "/risk",
  "/feedback",
  "/language",
  "/about",
  "/app",
  "/facilities",
  "/menu",
] as const;

export type SpecialCommand = (typeof SPECIAL_COMMANDS)[number];

/** Emergency keywords that bypass normal processing */
export const EMERGENCY_KEYWORDS = [
  "emergency",
  "chest pain",
  "can't breathe",
  "cannot breathe",
  "heart attack",
  "stroke",
  "unconscious",
  "bleeding heavily",
  "seizure",
] as const;

/** Craving / crisis keywords */
export const CRAVING_KEYWORDS = [
  "craving",
  "want to smoke",
  "tempted",
  "stressed",
  "anxious",
  "can't sleep",
  "cannot sleep",
] as const;

/** Feedback prompt interval (every Nth assistant response) */
export const FEEDBACK_PROMPT_INTERVAL = 5;

/** Conversation inactivity timeout (24 hours in ms) */
export const CONVERSATION_TIMEOUT_MS = 24 * 60 * 60 * 1000;

/** Max WhatsApp message length */
export const MAX_WHATSAPP_MESSAGE_LENGTH = 4096;
