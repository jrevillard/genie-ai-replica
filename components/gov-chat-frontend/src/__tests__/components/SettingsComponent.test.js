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

const mockNotificationSuccess = jest.fn();
const mockNotificationWarning = jest.fn();
const mockNotificationError = jest.fn();

jest.mock('../../services/notificationService', () => ({
  __esModule: true,
  default: {
    success: mockNotificationSuccess,
    warning: mockNotificationWarning,
    error: mockNotificationError
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
const fs = require('fs');
const path = require('path');

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
          t: (key) => key
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
  });

  test('the warning key exists in the en locale and is used by the component', () => {
    // The component's translate() falls back to the hardcoded literal when
    // $t cannot resolve, so a key typo degrades silently — pin both sides:
    // the locale string the translators maintain and the key the component
    // actually references.
    const warning =
      'Your profile data has been reset, but some stored files could not be removed. Please contact an administrator.';
    expect(enMessages.settings.userDataResetFilesFailed).toBe(warning);

    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'components', 'SettingsComponent.vue'), 'utf8');
    expect(source).toContain("'settings.userDataResetFilesFailed'");
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
