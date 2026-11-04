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
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
  });

  test('keeps theme, locale, font size and notification toggles across the clear', async () => {
    localStorage.setItem('theme', 'dark');
    localStorage.setItem('userLocale', 'fr');
    localStorage.setItem('fontSize', '80');
    localStorage.setItem('emailUpdates', 'true');
    localStorage.setItem('soundNotifications', 'false');
    // A key the reset owns — chat cache leftovers and the like — must go.
    localStorage.setItem('junkCacheKey', 'wipe-me');

    const wrapper = await buildWrapper();
    mockResetUserData.mockResolvedValue({});

    await resetViaModal(wrapper);

    expect(localStorage.getItem('theme')).toBe('dark');
    expect(localStorage.getItem('userLocale')).toBe('fr');
    expect(localStorage.getItem('fontSize')).toBe('80');
    expect(localStorage.getItem('emailUpdates')).toBe('true');
    expect(localStorage.getItem('soundNotifications')).toBe('false');
    expect(localStorage.getItem('junkCacheKey')).toBeNull();
  });

  test('does not write display-preference keys that were absent before the reset', async () => {
    localStorage.setItem('theme', 'light');

    const wrapper = await buildWrapper();
    mockResetUserData.mockResolvedValue({});

    await resetViaModal(wrapper);

    expect(localStorage.getItem('theme')).toBe('light');
    expect(localStorage.getItem('userLocale')).toBeNull();
    expect(localStorage.getItem('fontSize')).toBeNull();
    expect(localStorage.getItem('emailUpdates')).toBeNull();
    expect(localStorage.getItem('soundNotifications')).toBeNull();
  });

  test('the keys save() persists are exactly the ones the reset preserves', async () => {
    // Drift guard: a display preference added to save() but missed by the
    // reset's preserve list — or dropped from it — would silently revert
    // on the next reset. This pins the two key sets to each other at the
    // localStorage boundary save() actually writes.
    const written = [];
    const setItem = Storage.prototype.setItem;
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation((key, value) => {
      written.push(key);
      setItem.call(localStorage, key, value);
    });

    const wrapper = await buildWrapper();
    await wrapper.vm.save();

    // The contract is the key SET save() touches (a key written twice is
    // fine; a sixth key or a missing one is the drift this pins).
    expect([...new Set(written)].sort()).toEqual([
      'emailUpdates',
      'fontSize',
      'soundNotifications',
      'theme',
      'userLocale'
    ]);
  });
});
