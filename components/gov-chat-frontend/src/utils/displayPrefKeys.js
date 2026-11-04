// The local display preferences Reset User Data must keep — the same keys
// the settings screen's save() persists. The reset clears profile data and
// chat history, not the user's look-and-feel.
export const DISPLAY_PREF_KEYS = Object.freeze([
  'theme',
  'userLocale',
  'fontSize',
  'emailUpdates',
  'soundNotifications'
]);
