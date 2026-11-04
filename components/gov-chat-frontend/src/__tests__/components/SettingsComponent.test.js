'use strict';

/**
 * SettingsComponent — reset-data notification contract.
 *
 * The backend `POST /api/me/reset-data` may answer `filesDeletionFailed: true`
 * when the user's uploads directory could not be removed after the committed
 * reset. The component must surface that with a warning instead of the
 * unconditional success message, and degrade to the success message when the
 * flag is absent (backends without the flag) or explicitly false.
 */
const { mount, flushPromises } = require('@vue/test-utils');

const mockResetUserData = jest.fn();

jest.mock('../../services/userService', () => ({
  __esModule: true,
  default: {
    resetUserData: mockResetUserData
  }
}));

const mockI18nT = jest.fn((key) => key);
const mockNotificationSuccess = jest.fn();
const mockNotificationWarning = jest.fn();
const mockNotificationError = jest.fn();
const mockNotificationInfo = jest.fn();
const mockStoreCommit = jest.fn();
const mockStoreDispatch = jest.fn();

jest.mock('../../services/notificationService', () => ({
  __esModule: true,
  default: {
    success: mockNotificationSuccess,
    warning: mockNotificationWarning,
    error: mockNotificationError,
    info: mockNotificationInfo
  }
}));

jest.mock('../../config/oidcConfig', () => ({
  __esModule: true,
  default: { authority: 'https://keycloak.example.test' }
}));

jest.mock('../../utils/ThemeManager', () => ({
  __esModule: true,
  themeManager: {
    getCurrentTheme: jest.fn().mockReturnValue('light'),
    applyTheme: jest.fn(),
    setTheme: jest.fn(),
    getFontSize: jest.fn().mockReturnValue(16),
    applyFontSize: jest.fn(),
    getCurrentLanguage: jest.fn().mockReturnValue('en'),
    getAvailableLanguages: jest.fn().mockReturnValue([])
  }
}));

jest.mock('../../components/LanguageSelector.vue', () => ({
  __esModule: true,
  default: { name: 'LanguageSelector', template: '<div />' }
}));

const SettingsComponent = require('../../components/SettingsComponent.vue').default;
const enMessages = require('../../i18n/locales/en').default;
const { DISPLAY_PREF_KEYS } = require('../../utils/displayPrefKeys');

// ---------------------------------------------------------------------------
// Mount helper
// ---------------------------------------------------------------------------

async function buildWrapper() {
  const wrapper = mount(SettingsComponent, {
    global: {
      stubs: {
        // DsModal teleports its dialog to <body>; keep it in place so the
        // test can drive the confirm button through the component tree.
        teleport: true
      },
      mocks: {
        $i18n: {
          locale: 'en',
          t: mockI18nT
        },
        $router: {
          push: jest.fn()
        },
        $store: {
          commit: mockStoreCommit,
          dispatch: mockStoreDispatch,
          getters: {
            currentUser: {
              name: 'Test User',
              email: 'test@example.test',
              accountType: 'standard',
              userId: 'user-1',
              createdAt: '2026-01-01T00:00:00Z'
            }
          }
        }
      }
    }
  });
  await wrapper.vm.$nextTick();
  return wrapper;
}

// Drives the real user path: click the reset tile, confirm the modal, and
// let the reset flow complete — so the confirm-dialog wiring is exercised.
async function resetViaModal(wrapper) {
  const resetTile = wrapper.findAll('button').find((b) => b.text() === 'Reset User Data');
  await resetTile.trigger('click');
  await wrapper.vm.$nextTick();

  const confirmButton = wrapper.findAll('button').find((b) => b.text() === 'Reset');
  await confirmButton.trigger('click');
  await flushPromises();
  await wrapper.vm.$nextTick();
}

describe('SettingsComponent — resetUserData notification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('shows the success message when the flag is absent', async () => {
    const wrapper = await buildWrapper();
    mockResetUserData.mockResolvedValue({});

    await resetViaModal(wrapper);

    expect(mockResetUserData).toHaveBeenCalledTimes(1);
    expect(mockNotificationSuccess).toHaveBeenCalledWith('Your profile data has been successfully reset.');
    expect(mockNotificationWarning).not.toHaveBeenCalled();
  });

  test('shows the success message when the flag is false', async () => {
    const wrapper = await buildWrapper();
    mockResetUserData.mockResolvedValue({ filesDeletionFailed: false });

    await resetViaModal(wrapper);

    expect(mockNotificationSuccess).toHaveBeenCalledWith('Your profile data has been successfully reset.');
    expect(mockNotificationWarning).not.toHaveBeenCalled();
  });

  test('shows a warning instead of success when filesDeletionFailed is true', async () => {
    const wrapper = await buildWrapper();
    mockResetUserData.mockResolvedValue({ filesDeletionFailed: true });

    await resetViaModal(wrapper);

    expect(mockNotificationWarning).toHaveBeenCalledWith(
      'Your profile data has been reset, but some stored files could not be removed. Please contact an administrator.'
    );
    expect(mockNotificationSuccess).not.toHaveBeenCalled();
    // The component resolved the warning through the settings key — not a
    // hard-coded literal — and the locale string the translators maintain
    // matches the fallback shown above.
    expect(mockI18nT).toHaveBeenCalledWith('settings.userDataResetFilesFailed', expect.anything());
    expect(enMessages.settings.userDataResetFilesFailed).toBe(
      'Your profile data has been reset, but some stored files could not be removed. Please contact an administrator.'
    );
  });

  test('the warning key exists in the en locale and is used by the component', () => {
    // The component's translate() falls back to the hardcoded literal when
    // $t cannot resolve, so a key typo degrades silently — the $i18n.t spy
    // assertion in the warning test pins the key the component actually
    // references; this one pins the locale string the translators maintain.
    const warning =
      'Your profile data has been reset, but some stored files could not be removed. Please contact an administrator.';
    expect(enMessages.settings.userDataResetFilesFailed).toBe(warning);
  });

  test('keeps the error path untouched when the request fails', async () => {
    const wrapper = await buildWrapper();
    mockResetUserData.mockRejectedValue(new Error('boom'));

    await resetViaModal(wrapper);

    expect(mockNotificationError).toHaveBeenCalled();
    expect(mockNotificationSuccess).not.toHaveBeenCalled();
    expect(mockNotificationWarning).not.toHaveBeenCalled();
  });
});

describe('SettingsComponent — resetUserData preserves display preferences', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // clearAllMocks keeps implementations — drop the sibling describe's
    // mockRejectedValue/mockResolvedValue leftovers so each test here is
    // self-contained.
    mockResetUserData.mockReset();
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    jest.restoreAllMocks();
  });

  test('keeps every display preference across the clear', async () => {
    const seeded = {
      theme: 'dark',
      userLocale: 'fr',
      fontSize: '80',
      emailUpdates: 'true',
      soundNotifications: 'false'
    };
    for (const key of DISPLAY_PREF_KEYS) {
      localStorage.setItem(key, seeded[key] || `value-of-${key}`);
    }
    // A key the reset owns — chat cache leftovers and the like — must go.
    localStorage.setItem('junkCacheKey', 'wipe-me');

    const wrapper = await buildWrapper();
    mockResetUserData.mockResolvedValue({});

    await resetViaModal(wrapper);

    for (const key of DISPLAY_PREF_KEYS) {
      expect(localStorage.getItem(key)).toBe(seeded[key] || `value-of-${key}`);
    }
    expect(localStorage.getItem('junkCacheKey')).toBeNull();
    // Full-inventory closure: exactly the preserve list survives, nothing
    // else. Combined with the save() drift guard below, both directions of
    // drift between save()'s keys and DISPLAY_PREF_KEYS turn red.
    expect(Object.keys(localStorage).sort()).toEqual([...DISPLAY_PREF_KEYS].sort());
  });

  test('does not write display-preference keys that were absent before the reset', async () => {
    localStorage.setItem(DISPLAY_PREF_KEYS[0], 'light');

    const wrapper = await buildWrapper();
    mockResetUserData.mockResolvedValue({});

    await resetViaModal(wrapper);

    expect(localStorage.getItem(DISPLAY_PREF_KEYS[0])).toBe('light');
    for (const key of DISPLAY_PREF_KEYS.slice(1)) {
      expect(localStorage.getItem(key)).toBeNull();
    }
    expect(Object.keys(localStorage)).toEqual([DISPLAY_PREF_KEYS[0]]);
  });

  test('the keys save() persists are all covered by the reset preserve list', async () => {
    // Drift guard: a display preference written by save() but missed by the
    // reset's preserve list would silently revert on the next reset. save()
    // covers a subset of the preserve list — the sidebar layout keys and the
    // OKF expert-mode flag are written by their own components, not by the
    // Save button — so the contract is containment, not equality.
    const written = [];
    const setItem = Storage.prototype.setItem;
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation((key, value) => {
      written.push(key);
      setItem.call(localStorage, key, value);
    });

    const wrapper = await buildWrapper();
    const saveButton = wrapper.findAll('button').find((b) => b.text() === 'Save Settings');
    await saveButton.trigger('click');
    await flushPromises();

    // A key written twice is fine; a key save() writes that the reset does
    // not preserve is the drift this pins. The filter form names the
    // drifting key in the failure instead of a bare boolean mismatch.
    const writtenKeys = [...new Set(written)].sort();
    const preserveSet = new Set(DISPLAY_PREF_KEYS);
    expect(writtenKeys.filter((key) => !preserveSet.has(key))).toEqual([]);
    // save() still writes the five settings-screen keys it always did.
    expect(writtenKeys).toEqual(['emailUpdates', 'fontSize', 'soundNotifications', 'theme', 'userLocale']);
  });

  test('preserves the layout keys no settings-screen writer touches', async () => {
    // The sidebar layout and OKF expert-mode keys are written by their own
    // components, not by save() — the closure test above seeds them from the
    // preserve list itself, which cannot go red if the list loses one. Pin
    // them here by hand so dropping a key from DISPLAY_PREF_KEYS fails.
    localStorage.setItem('sidebarOpen', 'true');
    localStorage.setItem('sidebarOpenRight', 'false');
    localStorage.setItem('sidebarWidthLeft', '420');
    localStorage.setItem('sidebarWidthRight', '310');
    localStorage.setItem('okf.studio.expertMode', 'expert');

    const wrapper = await buildWrapper();
    mockResetUserData.mockResolvedValue({});

    await resetViaModal(wrapper);

    expect(localStorage.getItem('sidebarOpen')).toBe('true');
    expect(localStorage.getItem('sidebarOpenRight')).toBe('false');
    expect(localStorage.getItem('sidebarWidthLeft')).toBe('420');
    expect(localStorage.getItem('sidebarWidthRight')).toBe('310');
    expect(localStorage.getItem('okf.studio.expertMode')).toBe('expert');
  });

  test('the reset drops the in-session chat and conversation store state', async () => {
    // The chat-history and conversation subscriptions re-persist on the next
    // mutation: an in-memory history surviving the reset would write the
    // wiped data straight back to storage (#1455). The reset must abort any
    // in-flight generation, leave the stores in their fresh shape, and drop
    // the sessionStorage conversation payload synchronously — the
    // subscription persists through a debounce, so a tab killed inside the
    // window would otherwise rehydrate the wiped conversation.
    sessionStorage.setItem('genie.conversation.v1', '{"openId":"open"}');
    const wrapper = await buildWrapper();
    mockResetUserData.mockResolvedValue({});

    await resetViaModal(wrapper);

    expect(mockStoreDispatch).toHaveBeenCalledWith('conversation/abortStream');
    expect(mockStoreCommit).toHaveBeenCalledWith('chatHistory/RESET');
    expect(mockStoreCommit).toHaveBeenCalledWith('conversation/RESET');
    expect(sessionStorage.getItem('genie.conversation.v1')).toBeNull();
  });
});
