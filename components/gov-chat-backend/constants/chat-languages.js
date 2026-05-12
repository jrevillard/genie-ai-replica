/**
 * Chat languages exposed to clients.
 *
 * Source of truth: genie-ai-overlay/chatqna/language_codes.json
 * (kept in sync manually — chatqna translates user input to/from these codes
 * via langdetect + Gemma; UI uses this list to render an optional language
 * picker that overrides auto-detection).
 *
 * Each entry is `{ code, name, isVoiceSupported }`:
 *   - `code`: lowercase language tag sent in chat-request `context.language`
 *     (the pipeline upper-cases it internally) and as the optional `language`
 *     parameter on the voice/call init API.
 *   - `name`: display label.
 *   - `isVoiceSupported`: whether the Piper TTS catalog on this deployment has
 *     at least one voice for that language. The frontend uses this to gate the
 *     "Call" button on languages with no voice. Source: the `xx_YY-...` prefixes
 *     of voice files in the piper-voices directory (see
 *     genie-ai-overlay/tts-piper). Update when voices are added/removed.
 */
const CHAT_LANGUAGES = [
  { code: 'en',  name: 'English',     isVoiceSupported: true  },
  { code: 'id',  name: 'Indonesian',  isVoiceSupported: true  },
  { code: 'ru',  name: 'Russian',     isVoiceSupported: true  },
  { code: 'zh',  name: 'Chinese',     isVoiceSupported: true  },
  { code: 'th',  name: 'Thai',        isVoiceSupported: false },
  { code: 'es',  name: 'Spanish',     isVoiceSupported: true  },
  { code: 'fr',  name: 'French',      isVoiceSupported: true  },
  { code: 'sw',  name: 'Swahili',     isVoiceSupported: true  },
  { code: 'ar',  name: 'Arabic',      isVoiceSupported: true  },
  { code: 'pt',  name: 'Portuguese',  isVoiceSupported: true  },
  { code: 'de',  name: 'German',      isVoiceSupported: true  },
  { code: 'ja',  name: 'Japanese',    isVoiceSupported: false },
  { code: 'ko',  name: 'Korean',      isVoiceSupported: false },
  { code: 'hi',  name: 'Hindi',       isVoiceSupported: true  },
  { code: 'st',  name: 'Sesotho',     isVoiceSupported: false },
  { code: 'bn',  name: 'Bengali',     isVoiceSupported: false },
  { code: 'man', name: 'Mandinka',    isVoiceSupported: false },
];

module.exports = { CHAT_LANGUAGES };
