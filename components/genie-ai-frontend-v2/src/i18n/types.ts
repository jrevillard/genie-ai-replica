import type en from './locales/en';

// English defines the key tree; leaves are `string` so other locales may use
// translated copy while TS still enforces the same nesting and keys as EN.
type DeepLeafString<T> = T extends string ? string : { [K in keyof T]: DeepLeafString<T[K]> };

export type MessageSchema = DeepLeafString<typeof en>;

export type LocaleCode = 'en' | 'fr' | 'mnk';

export interface LocaleOption {
  code: LocaleCode;
  label: string;
  // ISO 3166-1 alpha-2 country code consumed by FlagIcon.
  flag: string;
}
