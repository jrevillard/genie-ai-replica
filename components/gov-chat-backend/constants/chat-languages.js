/**
 * Chat languages exposed to clients.
 *
 * Source of truth: genie-ai-overlay/chatqna/language_codes.json
 * (kept in sync manually — chatqna translates user input to/from these codes
 * via langdetect + Gemma; UI uses this list to render an optional language
 * picker that overrides auto-detection).
 *
 * Each entry is `{ code, name }` where `code` is the lowercase language tag
 * sent in chat-request `context.language` (the pipeline upper-cases it
 * internally). `name` is the display label.
 */
const CHAT_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'id', name: 'Indonesian' },
  { code: 'ru', name: 'Russian' },
  { code: 'zh', name: 'Chinese' },
  { code: 'th', name: 'Thai' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'sw', name: 'Swahili' },
  { code: 'ar', name: 'Arabic' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'de', name: 'German' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'hi', name: 'Hindi' },
  { code: 'st', name: 'Sesotho' },
  { code: 'bn', name: 'Bengali' },
  { code: 'man', name: 'Mandinka' },
];

module.exports = { CHAT_LANGUAGES };
