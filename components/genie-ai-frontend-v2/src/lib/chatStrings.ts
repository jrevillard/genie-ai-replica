// Chat-surface strings.
// Translations are owned by the backend API: the user's language preference
// (`ChatLang`) is sent with each request and the API returns a localised
// payload. The frontend keeps a single English source so the shape is fixed
// and the UI keeps working until the API ships.

export type ChatLang = 'en' | 'fr' | 'mnk';

export interface LangOption {
  code: ChatLang;
  label: string;
  // ISO 3166-1 alpha-2 country code used for the flag image.
  // Mandinka has no flag; we use the Gambia flag as the closest visual cue.
  flag: string;
}

export const CHAT_LANGS: LangOption[] = [
  { code: 'en', label: 'English', flag: 'gb' },
  { code: 'fr', label: 'Français', flag: 'fr' },
  { code: 'mnk', label: 'Mandinka', flag: 'gm' },
];

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
  switchToChat: string;
  you: string;
  twin: string;
  ended: string;
  endedSubtitle: string;
  closeWindow: string;
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
    switchToChat: 'Switch to chat',
    you: 'You',
    twin: 'AI Twin',
    ended: 'Call ended',
    endedSubtitle: 'Hope that was helpful. Take care of yourself.',
    closeWindow: 'Close',
    startCall: 'Start call',
    tapToSpeak: 'Tap and hold to speak',
    demoUserLine: 'How can I lower my blood pressure naturally?',
  },
};
