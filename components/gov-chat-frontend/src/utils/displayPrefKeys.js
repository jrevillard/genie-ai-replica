// The sidebar layout keys as the sidebar composable names them — the single
// source of truth for the storage contract (a rename there must land here,
// not silently wipe the user's layout on the next reset).
import { KEY_OPEN_LEFT, KEY_OPEN_RIGHT, KEY_WIDTH_LEFT, KEY_WIDTH_RIGHT } from '../composables/sidebarLayout';

// The local display preferences Reset User Data must keep — the same keys
// the settings screen's save() persists. The reset clears profile data and
// chat history, not the user's look-and-feel. The sidebar layout keys and
// the OKF UI-state keys (expert mode: store/modules/okf.js AND
// components/ds/ModeSwitch.vue, its two writers; editor pane layout:
// RepoEditor.vue; seen-narrative markers: Narrative.vue) are the same class
// of look-and-feel state: written outside save(), reverted on the user if
// the wipe takes them.
export const DISPLAY_PREF_KEYS = Object.freeze([
  'theme',
  'userLocale',
  'fontSize',
  'emailUpdates',
  'soundNotifications',
  KEY_OPEN_LEFT,
  KEY_OPEN_RIGHT,
  KEY_WIDTH_LEFT,
  KEY_WIDTH_RIGHT,
  'okf.studio.expertMode',
  'okf.editor.panes',
  'okf.studio.seenNarratives'
]);
