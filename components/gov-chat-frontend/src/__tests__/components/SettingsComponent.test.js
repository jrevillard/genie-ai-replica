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
const { mount } = require('@vue/test-utils');

const mockGetProfile = jest.fn();
const mockResetUserData = jest.fn();

jest.mock('../../services/userService', () => ({
  __esModule: true,
  default: {
    getProfile: mockGetProfile,
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

// ---------------------------------------------------------------------------
// Mount helper
// ---------------------------------------------------------------------------

async function buildWrapper() {
  const wrapper = mount(SettingsComponent, {
    global: {
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

describe('SettingsComponent — resetUserData notification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetProfile.mockResolvedValue({
      name: 'Test User',
      email: 'test@example.test'
    });
  });

  test('shows the success message when the flag is absent', async () => {
    const wrapper = await buildWrapper();
    mockResetUserData.mockResolvedValue({});

    await wrapper.vm.resetUserData();

    expect(mockResetUserData).toHaveBeenCalledTimes(1);
    expect(mockNotificationSuccess).toHaveBeenCalledWith('Your profile data has been successfully reset.');
    expect(mockNotificationWarning).not.toHaveBeenCalled();
  });

  test('shows the success message when the flag is false', async () => {
    const wrapper = await buildWrapper();
    mockResetUserData.mockResolvedValue({ filesDeletionFailed: false });

    await wrapper.vm.resetUserData();

    expect(mockNotificationSuccess).toHaveBeenCalledWith('Your profile data has been successfully reset.');
    expect(mockNotificationWarning).not.toHaveBeenCalled();
  });

  test('shows a warning instead of success when filesDeletionFailed is true', async () => {
    const wrapper = await buildWrapper();
    mockResetUserData.mockResolvedValue({ filesDeletionFailed: true });

    await wrapper.vm.resetUserData();

    expect(mockNotificationWarning).toHaveBeenCalledWith(
      'Your profile data has been reset, but some stored files could not be removed. Please contact an administrator.'
    );
    expect(mockNotificationSuccess).not.toHaveBeenCalled();
  });

  test('keeps the error path untouched when the request fails', async () => {
    const wrapper = await buildWrapper();
    mockResetUserData.mockRejectedValue(new Error('boom'));

    await wrapper.vm.resetUserData();

    expect(mockNotificationError).toHaveBeenCalled();
    expect(mockNotificationSuccess).not.toHaveBeenCalled();
    expect(mockNotificationWarning).not.toHaveBeenCalled();
  });
});
