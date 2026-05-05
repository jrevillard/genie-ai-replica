import { createI18n } from 'vue-i18n';
import en from './locales/en';
import type { LocaleCode, LocaleOption, MessageSchema } from './types';

const STORAGE_KEY = 'app.lang';
const LEGACY_STORAGE_KEY = 'chat.lang'; // Pre-i18n key — migrated on first read.

export const SUPPORTED_LOCALES: LocaleOption[] = [
  { code: 'en', label: 'English', flag: 'gb' },
  { code: 'fr', label: 'Français', flag: 'fr' },
  { code: 'mnk', label: 'Mandinka', flag: 'gm' },
];

const VALID_CODES = new Set(SUPPORTED_LOCALES.map((l) => l.code));

function isLocale(value: unknown): value is LocaleCode {
  return typeof value === 'string' && VALID_CODES.has(value as LocaleCode);
}

function readPersistedLocale(): LocaleCode {
  if (typeof window === 'undefined') return 'en';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (isLocale(stored)) return stored;
  // Migrate any value the old chat-only picker may have written.
  const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
  if (isLocale(legacy)) {
    window.localStorage.setItem(STORAGE_KEY, legacy);
    return legacy;
  }
  return 'en';
}

const initialLocale = readPersistedLocale();

export const i18n = createI18n<MessageSchema, LocaleCode, false>({
  legacy: false,
  locale: initialLocale,
  fallbackLocale: 'en',
  // EN is bundled at boot; FR and MN are dynamically imported on first use.
  messages: { en } as Record<LocaleCode, MessageSchema>,
});

// Track which locales have been loaded so we only network-fetch once.
const loaded = new Set<LocaleCode>(['en']);

async function loadLocale(code: LocaleCode): Promise<void> {
  if (loaded.has(code)) return;
  const mod = await import(`./locales/${code}.ts`);
  i18n.global.setLocaleMessage(code, mod.default as MessageSchema);
  loaded.add(code);
}

export async function setLocale(code: LocaleCode): Promise<void> {
  if (!isLocale(code)) return;
  await loadLocale(code);
  i18n.global.locale.value = code;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, code);
    document.documentElement.setAttribute('lang', code);
  }
}

// Apply the persisted locale's side effects on boot (the i18n instance is
// already initialized with the right locale; this just syncs the <html lang>).
if (typeof window !== 'undefined') {
  document.documentElement.setAttribute('lang', initialLocale);
  // Pre-load the persisted locale's messages if it isn't EN.
  if (initialLocale !== 'en') void loadLocale(initialLocale);
}

export type { LocaleCode, LocaleOption } from './types';
