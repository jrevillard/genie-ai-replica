<template>
  <div class="settings-overlay">
    <div :key="'settings-dialog-' + currentLocale" class="settings-dialog" :style="dialogThemeStyles">
      <div class="dialog-header">
        <h2 class="header-title" :data-themed="isThemeReady">
          {{ translate('settings.title', 'Settings') }}
        </h2>
        <div class="header-actions">
          <button class="btn-close" @click="close">
            {{ translate('settings.close', 'Close') }}
          </button>
          <button class="btn-save" @click="save">
            {{ translate('settings.saveSettings', 'Save Settings') }}
          </button>
        </div>
      </div>

      <div v-if="isLoading" class="loading-overlay">
        <div class="loading-spinner"></div>
        <p>
          {{ translate('settings.loadingUserInfo', 'Loading user information...') }}
        </p>
      </div>

      <div v-else-if="errorMessage" class="error-container">
        <p class="error-message">{{ errorMessage }}</p>
        <button class="btn-retry" @click="fetchUserData">
          {{ translate('settings.retry', 'Retry') }}
        </button>
      </div>

      <div v-else>
        <div class="profile-section">
          <div class="account-avatar">
            <div v-if="!userAvatar" class="avatar-placeholder">
              {{
                userData.name
                  ? userData.name
                      .split(' ')
                      .map((n) => n[0])
                      .join('')
                      .toUpperCase()
                      .substring(0, 2)
                  : '?'
              }}
            </div>
            <img v-else :src="userAvatar" alt="User avatar" class="avatar-image" />
          </div>
          <div class="account-details">
            <div class="user-name">
              {{ userData.name || translate('settings.userName', 'User') }}
            </div>
            <div class="user-email">
              {{ userData.email || 'email@example.com' }}
            </div>
            <div class="account-type">
              {{ userData.accountType || translate('settings.standardAccount') }}
            </div>
          </div>
        </div>

        <div class="settings-grid">
          <div class="settings-box">
            <h3 class="section-title">
              {{ translate('settings.display', 'Display') }}
            </h3>

            <div class="setting-item">
              <label class="section-label">{{ translate('settings.displayLanguage', 'Display Language') }}</label>
              <language-selector v-model="settings.language" />
            </div>

            <div class="setting-item">
              <label class="section-label">{{ translate('settings.theme', 'Theme') }}</label>
              <div class="theme-buttons">
                <button
                  class="theme-toggle"
                  :class="{ active: settings.theme === 'light' }"
                  @click="applyTheme('light')"
                >
                  {{ translate('settings.themes.light', 'Light') }}
                </button>
                <button class="theme-toggle" :class="{ active: settings.theme === 'dark' }" @click="applyTheme('dark')">
                  {{ translate('settings.themes.dark', 'Dark') }}
                </button>
              </div>
            </div>

            <div class="setting-item">
              <label class="section-label">{{ translate('settings.fontSize', 'Font Size') }}</label>
              <div class="slider-container">
                <input v-model.number="settings.fontSize" type="range" min="30" max="100" class="slider" />
                <span class="slider-value">{{ settings.fontSize }}%</span>
              </div>
            </div>
          </div>

          <div class="settings-box">
            <h3 class="section-title">
              {{ translate('settings.notifications', 'Notifications') }}
            </h3>

            <div class="setting-item">
              <div class="toggle-row">
                <label class="section-label">{{ translate('settings.emailUpdates', 'Email Updates') }}</label>
                <div class="switch" @click="settings.emailUpdates = !settings.emailUpdates">
                  <div class="switch-track" :class="{ active: settings.emailUpdates }">
                    <div class="switch-thumb"></div>
                  </div>
                </div>
              </div>
            </div>

            <div class="setting-item">
              <div class="toggle-row">
                <label class="section-label">
                  {{ translate('settings.soundNotifications', 'Sound Notifications') }}
                </label>
                <div class="switch" @click="settings.soundNotifications = !settings.soundNotifications">
                  <div class="switch-track" :class="{ active: settings.soundNotifications }">
                    <div class="switch-thumb"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="account-management-section">
          <h3 class="section-title">
            {{ translate('settings.accountManagement', 'Account Management') }}
          </h3>

          <div class="account-management-grid">
            <div class="management-row">
              <div class="management-col">
                <button class="btn-secondary full-width" @click="openAccountConsole">
                  {{ translate('settings.manageMyAccount', 'Manage my account') }} →
                </button>
                <p class="description-text">
                  {{ translate('settings.manageMyAccountDesc', 'Update your email, password, and account settings.') }}
                </p>
              </div>

              <div class="management-col">
                <button class="btn-secondary full-width" @click="confirmResetUserData">
                  {{ translate('settings.resetUserData', 'Reset User Data') }}
                </button>
                <p class="description-text">
                  {{
                    translate('settings.resetUserDataDesc', 'This will clear all your profile data and chat history.')
                  }}
                </p>
              </div>

              <div class="management-col">
                <button class="btn-danger full-width" @click="confirmDeleteAccount">
                  {{ translate('settings.deleteAccount', 'Delete my account') }}
                </button>
                <p class="description-text danger-text">
                  {{
                    translate(
                      'settings.deleteAccountDesc',
                      'Permanently delete your account and all data. This cannot be undone.'
                    )
                  }}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <ConfirmDialog
    :visible="showResetDataConfirm"
    :title="resetDataDialog.title"
    :message="resetDataDialog.message"
    :confirm-text="resetDataDialog.confirmText"
    :cancel-text="resetDataDialog.cancelText"
    :theme="getCurrentTheme()"
    :parent-styles="{ maxWidth: '450px' }"
    @confirm="handleResetDataConfirm"
    @cancel="handleResetDataCancel"
  />

  <ConfirmDialog
    :visible="showDeleteAccountConfirm"
    :title="deleteAccountDialog.title"
    :message="deleteAccountDialog.message"
    :confirm-text="deleteAccountDialog.confirmText"
    :cancel-text="deleteAccountDialog.cancelText"
    :theme="getCurrentTheme()"
    :parent-styles="{ maxWidth: '450px' }"
    @confirm="handleDeleteAccountConfirm"
    @cancel="handleDeleteAccountCancel"
  />
</template>

<script>
import userService from '@/services/userService';
import notificationService from '@/services/notificationService';
import { themeManager } from '@/utils/ThemeManager';
import oidcConfig from '@/config/oidcConfig';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import LanguageSelector from '@/components/LanguageSelector.vue';

export default {
  name: 'SettingsComponent',
  components: {
    ConfirmDialog,
    LanguageSelector
  },
  emits: ['themeChanged', 'close'],
  data() {
    return {
      currentLocale: this.$i18n ? this.$i18n.locale : 'en',
      isLoading: true,
      errorMessage: null,
      isThemeReady: false,
      settings: {
        language: this.getCurrentLanguage(),
        theme: this.getCurrentTheme(),
        fontSize: this.getSavedFontSize(),
        emailUpdates: this.getSavedPreference('emailUpdates', false),
        soundNotifications: this.getSavedPreference('soundNotifications', true)
      },
      userData: {
        name: '',
        email: '',
        accountType: '',
        userId: '',
        createdAt: ''
      },
      userAvatar: null,
      showResetDataConfirm: false,
      resetDataDialog: {
        title: '',
        message: '',
        confirmText: '',
        cancelText: ''
      },
      showDeleteAccountConfirm: false,
      deleteAccountDialog: {
        title: '',
        message: '',
        confirmText: '',
        cancelText: ''
      }
    };
  },
  computed: {
    isDarkMode() {
      return this.settings.theme === 'dark';
    },
    accountConsoleUrl() {
      return `${oidcConfig.authority}/account/`;
    },
    dialogThemeStyles() {
      // Reference settings.theme so Vue re-evaluates when theme changes
      void this.settings.theme;
      const dialogTheme = themeManager.getDialogTheme();
      return {
        '--dialog-background': dialogTheme.modal.background,
        '--dialog-title-color': dialogTheme.modal.titleColor,
        '--dialog-text-color': dialogTheme.modal.textColor,
        '--dialog-border-color': dialogTheme.modal.borderColor,
        '--dialog-box-shadow': dialogTheme.modal.boxShadow,
        '--dialog-overlay-background': dialogTheme.overlay.background
      };
    }
  },
  watch: {
    'settings.theme'(newTheme) {
      console.log('[SETTINGS] settings.theme changed to:', newTheme);
      this.$forceUpdate();
    },
    currentLocale: function () {
      console.log('[SETTINGS] Current locale changed, updating dialog texts...');
      this.updateDialogTexts();
    }
  },
  created() {
    console.log('[SETTINGS] Initializing currentLocale...');
    this.currentLocale = this.$i18n ? this.$i18n.locale : 'en';
    console.log('[SETTINGS] currentLocale initialized to:', this.currentLocale);

    console.log('[SETTINGS] Component created, fetching user data...');
    this.fetchUserData();

    console.log('[SETTINGS] Initializing dialog texts...');
    this.updateDialogTexts();

    console.log('[SETTINGS] Initial settings.theme:', this.settings.theme);
    console.log('[SETTINGS] Initial DOM data-theme:', document.documentElement.getAttribute('data-theme'));

    console.log('[SETTINGS] Setting up watcher for settings.language...');
    this.$watch('settings.language', (newVal) => {
      console.log('[SETTINGS] settings.language changed to:', newVal);
      this.updateDialogTexts();
      if (this.$i18n) {
        console.log('[SETTINGS] Updating i18n locale...');
        this.$i18n.locale = newVal;
        console.log('[SETTINGS] Updating currentLocale to:', newVal);
        this.currentLocale = newVal;
        console.log('[SETTINGS] Forcing component re-render for language update...');
        this.$forceUpdate();
        if (this.$root) {
          console.log('[SETTINGS] Forcing root component re-render...');
          this.$root.$forceUpdate();
        }
      }
    });

    console.log('[SETTINGS] Setting up watcher for $i18n.locale...');
    if (this.$i18n) {
      this.$watch('$i18n.locale', (newLocale) => {
        console.log('Locale changed in Settings:', newLocale);
        this.currentLocale = newLocale;
        if (this.settings && this.settings.language !== newLocale) {
          console.log('[SETTINGS] Syncing settings.language to:', newLocale);
          this.settings.language = newLocale;
        }
        console.log('[SETTINGS] Forcing component re-render for external locale change...');
        this.$forceUpdate();
      });
    }
  },
  mounted() {
    console.log('[SETTINGS] Adding theme change event listener...');
    window.addEventListener('themeChange', this.updateTheme);

    console.log('[SETTINGS] Forcing theme application on mount...');
    this.applyTheme(this.settings.theme);

    console.log('[SETTINGS] Scheduling theme readiness update...');
    this.$nextTick(() => {
      this.isThemeReady = true;
    });

    console.log('[SETTINGS] Forcing i18n update on mount...');
    if (this.$i18n) {
      const savedLanguage = localStorage.getItem('userLocale') || 'en';
      console.log('[SETTINGS] Saved language from localStorage:', savedLanguage);
      this.$i18n.locale = savedLanguage;
      this.settings.language = savedLanguage;
      this.$nextTick(() => {
        this.$forceUpdate();
      });
    }

    console.log('Current locale:', this.$i18n.locale);
  },
  beforeUnmount() {
    console.log('[SETTINGS] Removing theme change event listener...');
    window.removeEventListener('themeChange', this.updateTheme);
  },
  methods: {
    getCurrentTheme() {
      console.log('[SETTINGS] Getting current theme...');
      let theme = localStorage.getItem('theme') || 'light';
      console.log('[SETTINGS] Theme from localStorage:', theme);

      if (theme === 'system') {
        console.log("[SETTINGS] Theme set to 'system', checking OS preference...");
        theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        console.log('[SETTINGS] Resolved system theme to:', theme);
      }
      return theme;
    },
    getCurrentLanguage() {
      console.log('[SETTINGS] Getting current language...');

      if (this.$i18n && this.$i18n.locale) {
        console.log('[SETTINGS] Language from i18n:', this.$i18n.locale);
        return this.$i18n.locale;
      }

      try {
        const savedLocale = localStorage.getItem('userLocale');
        if (savedLocale) {
          console.log('[SETTINGS] Language from localStorage:', savedLocale);
          return savedLocale;
        }
      } catch (e) {
        console.warn('[SETTINGS] Error accessing localStorage for language:', e);
      }

      console.log("[SETTINGS] Defaulting to language: 'en'");
      return 'en';
    },
    getSavedFontSize() {
      console.log('[SETTINGS] Getting saved font size...');
      try {
        const fontSize = localStorage.getItem('fontSize');
        if (fontSize) {
          console.log('[SETTINGS] Font size from localStorage:', fontSize);
          return parseInt(fontSize);
        }
        console.log('[SETTINGS] No font size found, defaulting to 50%');
        return 50;
      } catch (e) {
        console.warn('[SETTINGS] Error accessing localStorage for font size:', e);
        return 50;
      }
    },
    getSavedPreference(key, defaultValue) {
      console.log(`[SETTINGS] Getting saved preference for ${key}...`);
      try {
        const value = localStorage.getItem(key);
        if (value !== null) {
          console.log(`[SETTINGS] Preference ${key} from localStorage:`, value);
          return JSON.parse(value);
        }
        console.log(`[SETTINGS] No preference for ${key}, defaulting to:`, defaultValue);
        return defaultValue;
      } catch (e) {
        console.warn(`[SETTINGS] Error accessing localStorage for ${key}:`, e);
        return defaultValue;
      }
    },
    translate(key, fallback = '') {
      console.log('[SETTINGS] Translating key:', key);
      if (!this.$i18n) {
        console.log('[SETTINGS] No i18n instance, returning fallback:', fallback);
        return fallback;
      }
      try {
        console.log('[SETTINGS] Using locale:', this.currentLocale);
        const translation = this.$i18n.t(key, { locale: this.currentLocale });
        if (translation === key) {
          console.log('[SETTINGS] Translation not found, using fallback:', fallback || key);
          return fallback || key;
        }
        console.log('[SETTINGS] Translation found:', translation);
        return translation;
      } catch (e) {
        console.error('[SETTINGS] Translation error:', e);
        console.log('[SETTINGS] Returning fallback due to error:', fallback || key);
        return fallback || key;
      }
    },
    updateTheme() {
      const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
      if (this.settings.theme !== currentTheme) {
        this.settings.theme = currentTheme;
      }
      this.isThemeReady = false;
      this.$nextTick(() => {
        this.isThemeReady = true;
        this.$forceUpdate();
      });
    },
    applyTheme(theme) {
      this.settings.theme = theme;
      localStorage.setItem('theme', theme);
      try {
        themeManager.setTheme(theme);
      } catch (e) {
        console.warn('[SETTINGS] Error applying theme:', e);
      }
      this.$emit('themeChanged', theme);
      this.$forceUpdate();
    },
    updateDialogTexts() {
      console.log('[SETTINGS] Updating dialog texts for current locale...');
      this.resetDataDialog = {
        title: this.translate('settings.resetUserDataTitle', 'Reset User Data'),
        message: this.translate(
          'settings.confirmResetUserData',
          'Are you sure you want to reset all your profile data? This will clear all your profile information and chat history, but keep your account credentials.'
        ),
        confirmText: this.translate('settings.reset', 'Reset'),
        cancelText: this.translate('settings.cancel', 'Cancel')
      };
      this.deleteAccountDialog = {
        title: this.translate('settings.deleteAccountTitle', 'Delete Account'),
        message: this.translate(
          'settings.confirmDeleteAccount',
          'Are you sure you want to delete your account? This action is permanent and cannot be undone. All your data will be erased.'
        ),
        confirmText: this.translate('settings.delete', 'Delete'),
        cancelText: this.translate('settings.cancel', 'Cancel')
      };
    },
    accountTypeLabel(userData) {
      if (!userData) {
        return this.translate('settings.standardAccount');
      }
      const roleStr = userData.role || '';
      if (typeof roleStr === 'string' && roleStr.toLowerCase() === 'admin') {
        return this.translate('settings.administratorAccount');
      }
      const roles = userData.roles;
      if (Array.isArray(roles) && roles.some((r) => String(r).toLowerCase() === 'admin')) {
        return this.translate('settings.administratorAccount');
      }
      if (Array.isArray(roles) && roles.length) {
        return roles.join(', ');
      }
      return this.translate('settings.standardAccount');
    },
    async fetchUserData() {
      console.log('[SETTINGS] Fetching user data...');
      this.isLoading = true;
      this.errorMessage = null;
      try {
        console.log('[SETTINGS] Checking Vuex auth store for user data...');
        const userData = this.$store.getters.currentUser;
        if (!userData) {
          console.log('[SETTINGS] No store data, showing error...');
          throw new Error('No user data available in store');
        } else {
          console.log('[SETTINGS] Using Vuex store data:', userData);
        }
        console.log('[SETTINGS] Updating userData state...');
        this.userData = {
          name:
            userData.name ||
            userData.fullName ||
            userData.loginName ||
            userData.username ||
            this.translate('settings.user'),
          email: userData.email || '',
          accountType: this.accountTypeLabel(userData),
          createdAt: userData.createdAt || ''
        };
        console.log('[SETTINGS] userData updated:', this.userData);
        if (userData.avatarUrl) {
          console.log('[SETTINGS] Setting user avatar:', userData.avatarUrl);
          this.userAvatar = userData.avatarUrl;
        }
      } catch (error) {
        console.error('[SETTINGS] Error fetching user data:', error);
        notificationService.error(this.translate('settings.unableToLoadUser'));
        console.log('[SETTINGS] Attempting to use Vuex store as fallback...');
        const fallbackUser = this.$store.getters.currentUser;
        if (fallbackUser) {
          console.log('[SETTINGS] Fallback user data found:', fallbackUser);
          this.userData = {
            name:
              fallbackUser.name || fallbackUser.fullName || fallbackUser.loginName || this.translate('settings.user'),
            email: fallbackUser.email || '',
            accountType: this.accountTypeLabel(fallbackUser),
            createdAt: fallbackUser.createdAt || ''
          };
          console.log('[SETTINGS] Fallback userData set:', this.userData);
        }
      } finally {
        console.log('[SETTINGS] Setting isLoading to false');
        this.isLoading = false;
      }
    },
    close() {
      console.log('[SETTINGS] Closing dialog without saving...');
      this.$emit('close');
    },
    save() {
      console.log('[SETTINGS] Saving settings...');
      notificationService.info(this.translate('settings.savingSettings', 'Saving your settings...'), 1000);
      if (this.$i18n) {
        console.log('[SETTINGS] Saving language preference:', this.settings.language);
        this.$i18n.locale = this.settings.language;
        try {
          localStorage.setItem('userLocale', this.settings.language);
          console.log('[SETTINGS] Language preference saved to localStorage');
        } catch (e) {
          console.warn('[SETTINGS] Error saving language preference:', e);
        }
      }
      console.log('[SETTINGS] Applying theme to DOM:', this.settings.theme);
      themeManager.setTheme(this.settings.theme);
      try {
        localStorage.setItem('theme', this.settings.theme);
        console.log('[SETTINGS] Theme preference saved to localStorage');
      } catch (e) {
        console.warn('[SETTINGS] Error saving theme preference:', e);
      }
      console.log('[SETTINGS] Saving font size:', this.settings.fontSize);
      try {
        localStorage.setItem('fontSize', this.settings.fontSize.toString());
        document.documentElement.style.fontSize = `${this.settings.fontSize / 50}rem`;
        console.log('[SETTINGS] Font size applied and saved');
      } catch (e) {
        console.warn('[SETTINGS] Error saving font size:', e);
      }
      console.log('[SETTINGS] Saving notification preferences...');
      try {
        localStorage.setItem('emailUpdates', JSON.stringify(this.settings.emailUpdates));
        localStorage.setItem('soundNotifications', JSON.stringify(this.settings.soundNotifications));
        console.log('[SETTINGS] Notification preferences saved:', {
          emailUpdates: this.settings.emailUpdates,
          soundNotifications: this.settings.soundNotifications
        });
      } catch (e) {
        console.warn('[SETTINGS] Error saving notification preferences:', e);
      }
      console.log('[SETTINGS] Emitting themeChanged event:', this.settings.theme);
      this.$emit('themeChanged', this.settings.theme);
      notificationService.success(this.translate('settings.settingsSaved', 'Settings saved successfully!'));
      console.log('[SETTINGS] Closing dialog after saving...');
      this.$emit('close');
    },
    openAccountConsole() {
      window.open(this.accountConsoleUrl, '_blank', 'noopener,noreferrer');
    },
    confirmResetUserData() {
      console.log('[SETTINGS] Showing reset user data confirmation...');
      this.showResetDataConfirm = true;
    },
    handleResetDataConfirm() {
      console.log('[SETTINGS] User confirmed reset user data...');
      this.showResetDataConfirm = false;
      this.resetUserData();
    },
    handleResetDataCancel() {
      console.log('[SETTINGS] User cancelled reset user data...');
      this.showResetDataConfirm = false;
    },
    async resetUserData() {
      console.log('[SETTINGS] Resetting user data...');
      try {
        this.isLoading = true;
        console.log('[SETTINGS] Calling userService.resetUserData...');
        const response = await userService.resetUserData();
        console.log('[SETTINGS] Reset user data response:', response);
        notificationService.success(
          this.translate('settings.userDataReset', 'Your profile data has been successfully reset.')
        );
        console.log('[SETTINGS] Refreshing user data after reset...');
        await this.fetchUserData();
        console.log('[SETTINGS] Clearing localStorage except theme and language...');
        const themeValue = localStorage.getItem('theme');
        const langValue = localStorage.getItem('userLocale');
        localStorage.clear();
        if (themeValue) localStorage.setItem('theme', themeValue);
        if (langValue) localStorage.setItem('userLocale', langValue);
        console.log('[SETTINGS] Restored theme and language to localStorage');
      } catch (e) {
        console.error('[SETTINGS] Error resetting user data:', e);
        notificationService.error(
          this.translate('settings.failedToResetUserData', 'Failed to reset your profile data. Please try again later.')
        );
      } finally {
        console.log('[SETTINGS] Setting isLoading to false after reset...');
        this.isLoading = false;
      }
    },
    confirmDeleteAccount() {
      this.showDeleteAccountConfirm = true;
    },
    handleDeleteAccountConfirm() {
      this.showDeleteAccountConfirm = false;
      this.deleteAccount();
    },
    handleDeleteAccountCancel() {
      this.showDeleteAccountConfirm = false;
    },
    async deleteAccount() {
      try {
        this.isLoading = true;
        await userService.deleteAccount();
        await this.$store.dispatch('logout');
      } catch (e) {
        console.error('[SETTINGS] Error deleting account:', e);
        notificationService.error(
          this.translate('settings.failedToDeleteAccount', 'Failed to delete your account. Please try again later.')
        );
      } finally {
        this.isLoading = false;
      }
    }
  }
};
</script>

<style scoped>
/* Settings dialog styling */
.settings-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--dialog-overlay-background, rgba(0, 0, 0, 0.5));
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.settings-dialog {
  width: 800px;
  height: auto;
  max-width: 95vw;
  max-height: 95vh;
  border-radius: 8px;
  background-color: var(--dialog-background, #ffffff) !important;
  box-shadow: var(--dialog-box-shadow, 0 4px 12px rgba(0, 0, 0, 0.15));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

/* Header with buttons */
.dialog-header {
  padding: 1rem 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--dialog-border-color, #dcdfe4);
}

.header-title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
}

.header-title[data-themed='true'] {
  color: var(--dialog-title-color, #333333) !important;
}

/* Fallback override for dark mode */
[data-theme='dark'] .settings-dialog .dialog-header .header-title[data-themed='true'] {
  color: #f0f0f0 !important;
}

.header-actions {
  display: flex;
  gap: 0.5rem;
}

/* Loading indicator */
.loading-overlay {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  height: 300px;
  color: var(--dialog-text-color, #666666);
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 4px solid rgba(0, 0, 0, 0.1);
  border-radius: 50%;
  border-top-color: var(--bg-button-primary, #4e97d1);
  animation: spin 1s linear infinite;
  margin-bottom: 1rem;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Error container */
.error-container {
  padding: 2rem;
  text-align: center;
}

.error-message {
  color: var(--text-danger, #dc3545);
  margin-bottom: 1rem;
}

.btn-retry {
  padding: 0.5rem 1.5rem;
  background-color: var(--bg-button-secondary, #d1d5db);
  color: var(--text-button-secondary, #333333);
  border: 1px solid var(--dialog-border-color, #dcdfe4);
  border-radius: 4px;
  cursor: pointer;
}

/* Profile section */
.profile-section {
  padding: 1rem 1.5rem;
  background-color: var(--bg-section, rgba(0, 0, 0, 0.02));
  display: flex;
  align-items: center;
  gap: 1rem;
}

.account-avatar {
  flex-shrink: 0;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  overflow: hidden;
}

.avatar-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--bg-button-primary, #4e97d1);
  color: white;
  font-size: 1.5rem;
  font-weight: 500;
}

.avatar-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.account-details {
  flex: 1;
}

.user-name {
  font-size: 1.25rem;
  font-weight: 500;
  margin-bottom: 0.25rem;
  color: var(--dialog-title-color, #333333);
}

.user-email {
  color: var(--text-secondary, #4d4d4d);
  margin-bottom: 0.25rem;
}

.account-type {
  color: var(--text-tertiary, #767676);
  font-size: 0.875rem;
  font-weight: 500;
}

/* Main settings area */
.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
  padding: 1rem 1.5rem;
}

.settings-box {
  background-color: var(--bg-section, rgba(0, 0, 0, 0.02));
  border-radius: 6px;
  padding: 1rem;
}

.section-title {
  margin-top: 0;
  margin-bottom: 1rem;
  font-size: 1.25rem;
  font-weight: 500;
  color: var(--dialog-title-color, #333333) !important;
}

/* Fallback override for dark mode */
[data-theme='dark'] .settings-dialog .section-title {
  color: #f0f0f0 !important;
}

.setting-item {
  margin-bottom: 1rem;
}

.section-label {
  display: block;
  margin-bottom: 0.5rem;
  font-size: 1rem;
  font-weight: 400;
  color: var(--dialog-text-color, #666666);
}

/* Override text colors for dark mode */
[data-theme='dark'] .settings-dialog .section-label {
  color: rgba(255, 255, 255, 0.8) !important;
}

/* Toggle row */
.toggle-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

/* Account management */
.account-management-section {
  padding: 0 1.5rem 1rem;
}

.account-management-grid {
  background-color: var(--bg-section, rgba(0, 0, 0, 0.02));
  padding: 1rem;
  border-radius: 6px;
  display: grid;
  gap: 1rem;
}

.management-row {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
  margin-bottom: 1rem;
}

.management-row:last-child {
  margin-bottom: 0;
}

.management-col {
  min-width: 0;
}

/* Error text */
.error-text {
  color: var(--text-danger, #dc3545);
  font-size: 0.875rem;
  margin-top: 0.25rem;
  margin-bottom: 0;
}

/* Theme buttons styling */
.theme-buttons {
  display: flex;
  gap: 0.5rem;
}

.theme-toggle {
  flex: 1;
  padding: 0.5rem;
  border-radius: 4px;
  cursor: pointer;
  text-align: center;
  font-weight: 500;
  transition: all 0.2s;
  background-color: var(--bg-button-secondary, #d1d5db);
  color: var(--text-button-secondary, #333333);
  border: 1px solid var(--dialog-border-color, #dcdfe4);
}

.theme-toggle.active {
  background-color: var(--bg-button-primary, #4e97d1) !important;
  color: var(--text-button-primary, #ffffff) !important;
  border-color: var(--bg-button-primary, #4e97d1) !important;
}

/* Dropdown styling */
.dropdown {
  width: 100%;
  padding: 0.5rem;
  border-radius: 4px;
  background-color: var(--bg-input, #ffffff);
  color: var(--text-primary, #333333);
  border: 1px solid var(--dialog-border-color, #dcdfe4);
}

/* Slider styling */
.slider-container {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.slider {
  flex: 1;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: var(--slider-track, #e9ecef);
  outline: none;
  border-radius: 2px;
}

.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--slider-thumb, #4e97d1);
  cursor: pointer;
}

.slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--slider-thumb, #4e97d1);
  cursor: pointer;
  border: none;
}

.slider-value {
  min-width: 3rem;
  text-align: right;
  color: var(--dialog-text-color, #666666);
}

/* Switch toggle */
.switch {
  position: relative;
  display: inline-block;
  width: 50px;
  height: 24px;
  cursor: pointer;
}

.switch-track {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--switch-track-off, #d0d0d0);
  border-radius: 12px;
  transition: 0.4s;
}

.switch-thumb {
  position: absolute;
  height: 20px;
  width: 20px;
  left: 2px;
  bottom: 2px;
  background-color: var(--switch-thumb, #ffffff);
  border-radius: 50%;
  transition: 0.4s;
}

.switch-track.active .switch-thumb {
  transform: translateX(26px);
}

.switch-track.active {
  background-color: var(--switch-track-on, #4e97d1);
}

/* Text input styling */
.text-input {
  width: 100%;
  padding: 0.5rem;
  border-radius: 4px;
  background-color: var(--bg-input, #ffffff);
  color: var(--text-primary, #333333);
  border: 1px solid var(--dialog-border-color, #dcdfe4);
}

/* Buttons */
.btn-close,
.btn-save,
.btn-secondary {
  padding: 0.5rem 1rem;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 500;
  border: none;
  transition: all 0.2s;
}

.btn-secondary {
  background-color: var(--bg-button-secondary, #d1d5db);
  color: var(--text-button-secondary, #333333);
  border: 1px solid var(--dialog-border-color, #dcdfe4);
}

.btn-secondary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.full-width {
  width: 100%;
}

.btn-save {
  background-color: var(--bg-button-primary, #4e97d1);
  color: var(--text-button-primary, #ffffff);
}

/* Removed hardcoded dark mode override for btn-save */
/* Let btn-save use theme variables defined in theme-variables.css */

.btn-close {
  background-color: var(--bg-button-secondary, #d1d5db);
  color: var(--text-button-secondary, #333333);
}

.btn-danger {
  background-color: #dc2626;
  color: #ffffff;
  border: none;
  cursor: pointer;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  font-weight: 500;
  line-height: 1.5;
  box-sizing: border-box;
}

.btn-danger:hover {
  background-color: #b91c1c;
}

.danger-text {
  color: #dc2626;
}

/* Override button colors for dark mode */
[data-theme='dark'] .settings-dialog .btn-close {
  background-color: #444444 !important;
  color: #f0f0f0 !important;
}

.description-text {
  margin-top: 0.5rem;
  font-size: 0.875rem;
  color: var(--text-tertiary, #767676);
}

/* Responsive adjustments */
@media (max-width: 768px) {
  .settings-dialog {
    width: 95vw;
    height: 90vh;
    max-height: 90vh;
    overflow-y: auto;
  }

  .settings-grid {
    grid-template-columns: 1fr;
  }

  .management-row {
    grid-template-columns: 1fr;
  }

  .account-management-grid {
    display: flex;
    flex-direction: column;
  }

  .dialog-header {
    position: sticky;
    top: 0;
    background-color: var(--dialog-background, #ffffff);
    z-index: 10;
  }
}
</style>
