// The local display preferences Reset User Data must keep — the same keys
// the settings screen's save() persists. The reset clears profile data and
// chat history, not the user's look-and-feel. The sidebar layout keys and
// the OKF expert-mode flag are the same class of look-and-feel state:
// written outside save(), reverted on the user if the wipe takes them.
export const DISPLAY_PREF_KEYS = Object.freeze([
  'theme',
  'userLocale',
  'fontSize',
  'emailUpdates',
  'soundNotifications',
  'sidebarOpen',
  'sidebarOpenRight',
  'sidebarWidthLeft',
  'sidebarWidthRight',
  'okf.studio.expertMode'
]);
