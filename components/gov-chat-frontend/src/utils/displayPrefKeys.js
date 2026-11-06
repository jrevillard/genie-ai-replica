// The sidebar layout keys as the sidebar composable names them — the single
// source of truth for the storage contract (a rename there must land here,
// not silently wipe the user's layout on the next reset).
import { KEY_OPEN_LEFT, KEY_OPEN_RIGHT, KEY_WIDTH_LEFT, KEY_WIDTH_RIGHT } from '../composables/sidebarLayout';
import { RENEW_LEASE_KEY, RENEW_USER_KEY } from '../services/keycloakAuthService';

// The local display preferences Reset User Data must keep — the same keys
// the settings screen's save() persists. The reset clears profile data and
// chat history, not the user's look-and-feel. The sidebar layout keys and
// the OKF UI-state keys (expert mode: store/modules/okf.js AND
// components/ds/ModeSwitch.vue, its two writers; editor pane layout:
// RepoEditor.vue; seen-narrative markers: Narrative.vue) are the same class
// of look-and-feel state: written outside save(), reverted on the user if
// the wipe takes them. 'okf.pii.findings.v1' (ConceptEditor's per-concept
// scan-result cache) is deliberately NOT here: it is re-derivable content
// work product, not look-and-feel state.
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

// The complete key set the web reset carries across localStorage.clear():
// the display preferences plus the live cross-tab renewal-coordination keys
// — not preferences, but wiping them mid-renewal lets two tabs rotate the
// same refresh token and trips Keycloak reuse detection. The server-side
// mirror of this contract is RESET_PRESERVED_FIELDS in the backend's
// constants/jit-fields.js.
export const RESET_PRESERVED_KEYS = Object.freeze([...DISPLAY_PREF_KEYS, RENEW_LEASE_KEY, RENEW_USER_KEY]);
