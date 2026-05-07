// Chat-surface strings.
// Translations are owned by the backend API: the user's language preference
// (`ChatLang`) is sent with each request and the API returns a localised
// payload. The frontend keeps a single English source so the shape is fixed
// and the UI keeps working until the API ships.

// Languages the chat backend can respond in. The picker on the chat surface
// switches what `language` field is sent with each request — it does NOT
// retranslate the surrounding UI (UI strings are owned by vue-i18n with a
// smaller en/fr/mnk set). The authoritative list is supplied by the API
// (`GET /public/chat-sessions/languages`); this alias is intentionally wide so
// new server-side languages light up without a frontend change.
export type ChatLang = string;

export const DEFAULT_CHAT_LANG: ChatLang = 'fr';

export interface LangOption {
  code: ChatLang;
  label: string;
  // ISO 3166-1 alpha-2 country code; resolved to a bundled SVG under
  // /public/images/flags/.
  flag: string;
}

export const CHAT_LANGS: LangOption[] = [
  { code: 'en', label: 'English', flag: 'us' },
  { code: 'es', label: 'Spanish', flag: 'es' },
  { code: 'pt', label: 'Portuguese', flag: 'pt' },
  { code: 'fr', label: 'French', flag: 'fr' },
  { code: 'ar', label: 'Arabic', flag: 'sa' },
  { code: 'hi', label: 'Hindi', flag: 'in' },
  { code: 'zh', label: 'Chinese', flag: 'cn' },
  { code: 'de', label: 'German', flag: 'de' },
  { code: 'ja', label: 'Japanese', flag: 'jp' },
  { code: 'ru', label: 'Russian', flag: 'ru' },
  { code: 'ko', label: 'Korean', flag: 'kr' },
  { code: 'id', label: 'Indonesian', flag: 'id' },
  { code: 'it', label: 'Italian', flag: 'it' },
  { code: 'nl', label: 'Dutch', flag: 'nl' },
  { code: 'tr', label: 'Turkish', flag: 'tr' },
  { code: 'pl', label: 'Polish', flag: 'pl' },
  { code: 'sv', label: 'Swedish', flag: 'se' },
  { code: 'tl', label: 'Tagalog', flag: 'ph' },
  { code: 'ms', label: 'Malay', flag: 'my' },
  { code: 'ro', label: 'Romanian', flag: 'ro' },
  { code: 'uk', label: 'Ukrainian', flag: 'ua' },
  { code: 'el', label: 'Greek', flag: 'gr' },
  { code: 'cs', label: 'Czech', flag: 'cz' },
  { code: 'da', label: 'Danish', flag: 'dk' },
  { code: 'fi', label: 'Finnish', flag: 'fi' },
  { code: 'bg', label: 'Bulgarian', flag: 'bg' },
  { code: 'hr', label: 'Croatian', flag: 'hr' },
  { code: 'sk', label: 'Slovak', flag: 'sk' },
  { code: 'ta', label: 'Tamil', flag: 'in' },
  { code: 'mnk', label: 'Mandinka', flag: 'gm' },
  { code: 'th', label: 'Thai', flag: 'th' },
  { code: 'sw', label: 'Swahili', flag: 'ke' },
  { code: 'st', label: 'Sesotho', flag: 'ls' },
  { code: 'bn', label: 'Bengali', flag: 'bd' },
  { code: 'man', label: 'Mandinka', flag: 'gm' },
];

// API codes (`code`) → ISO 3166-1 alpha-2 country flag. Falls back to using
// the language code itself as a flag, then the file resolver returns whatever
// SVG happens to match (or 404s — callers should still pass a known code).
const FLAG_BY_CODE: Record<string, string> = Object.fromEntries(
  CHAT_LANGS.map((opt) => [opt.code, opt.flag]),
);

export function flagForLang(code: string): string {
  return FLAG_BY_CODE[code] ?? code;
}

export function flagUrl(code: string): string {
  return `/images/flags/${code.toLowerCase()}.svg`;
}

export interface SuggestionCard {
  topic: string;
  prompt: string;
}

export interface CallStrings {
  connecting: string;
  listening: string;
  aiSpeaking: string;
  muted: string;
  mute: string;
  unmute: string;
  endCall: string;
  you: string;
  twin: string;
  ended: string;
  startCall: string;
  tapToSpeak: string;
  demoUserLine: string;
}

export interface ChatStrings {
  greeting: string;
  subgreeting: string;
  placeholder: string;
  suggestionsTitle: string;
  suggestionCards: SuggestionCard[];
  disclaimer: string;
  newChat: string;
  attachSoon: string;
  micSoon: string;
  pickTwinTitle: string;
  pickTwinDescription: string;
  pickTwinAction: string;
  today: string;
  yesterday: string;
  sendAria: string;
  attachAria: string;
  micAria: string;
  langLabel: string;
  copy: string;
  copied: string;
  regenerate: string;
  helpful: string;
  notHelpful: string;
  errorReply: string;
  call: CallStrings;
}

// Single English source. The selected `ChatLang` is sent to the backend with
// each request; the API will return localised strings once it lands.
export const chatStrings: ChatStrings = {
  greeting: 'How can I help you with your health today?',
  subgreeting:
    'Ask anything about prevention, screening, treatment or healthy living.',
  placeholder: 'Ask anything about NCDs…',
  suggestionsTitle: 'Try one of these',
  suggestionCards: [
    {
      topic: 'Hypertension',
      prompt: 'How can I lower my blood pressure naturally?',
    },
    {
      topic: 'Diabetes',
      prompt: 'What does a healthy meal plan look like for type 2 diabetes?',
    },
    {
      topic: 'Screening',
      prompt: 'When should I get screened for cancer?',
    },
    {
      topic: 'Healthy living',
      prompt: 'What simple daily habits help prevent NCDs?',
    },
  ],
  disclaimer:
    'AI may produce inaccurate health information. Always verify with a qualified healthcare professional.',
  newChat: 'New chat',
  attachSoon: 'File attachments — coming soon',
  micSoon: 'Voice input — coming soon',
  pickTwinTitle: 'Pick a twin to chat with',
  pickTwinDescription:
    'Open an AI Twin from your library to start a conversation about non-communicable diseases.',
  pickTwinAction: 'Browse AI Twins',
  today: 'Today',
  yesterday: 'Yesterday',
  sendAria: 'Send message',
  attachAria: 'Attach file',
  micAria: 'Use voice input',
  langLabel: 'Language',
  copy: 'Copy',
  copied: 'Copied',
  regenerate: 'Regenerate',
  helpful: 'Helpful',
  notHelpful: 'Not helpful',
  errorReply: "Sorry, I couldn't generate a reply. Please try again.",
  call: {
    connecting: 'Connecting…',
    listening: 'Listening…',
    aiSpeaking: 'Speaking…',
    muted: 'Mic muted',
    mute: 'Mute',
    unmute: 'Unmute',
    endCall: 'End call',
    you: 'You',
    twin: 'AI Twin',
    ended: 'Call ended',
    startCall: 'Start call',
    tapToSpeak: 'Tap and hold to speak',
    demoUserLine: 'How can I lower my blood pressure naturally?',
  },
};
