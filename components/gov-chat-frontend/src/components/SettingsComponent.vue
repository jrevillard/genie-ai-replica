<template>
  <div class="settings-page">
    <div :key="'settings-content-' + currentLocale" class="settings-content">
      <div class="dialog-header">
        <h2 class="header-title">
          {{ translate('settings.title', 'Settings') }}
        </h2>
        <div class="header-actions">
          <DsButton variant="primary" @click="save">
            {{ translate('settings.saveSettings', 'Save Settings') }}
          </DsButton>
        </div>
      </div>

      <DsSpinner v-if="isLoading" overlay>
        <p>
          {{ translate('settings.loadingUserInfo', 'Loading user information...') }}
        </p>
      </DsSpinner>

      <DsStateDisplay v-else-if="errorMessage" type="error" :message="errorMessage">
        <template #action>
          <DsButton variant="secondary" @click="fetchUserData">
            {{ translate('settings.retry', 'Retry') }}
          </DsButton>
        </template>
      </DsStateDisplay>

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
              {{ userData.accountType || translate('settings.standardAccount', 'Standard Account') }}
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
                <DsButton
                  variant="secondary"
                  class="theme-toggle"
                  :class="{ active: settings.theme === 'light' }"
                  @click="applyTheme('light')"
                >
                  {{ translate('settings.themes.light', 'Light') }}
                </DsButton>
                <DsButton
                  variant="secondary"
                  class="theme-toggle"
                  :class="{ active: settings.theme === 'dark' }"
                  @click="applyTheme('dark')"
                >
                  {{ translate('settings.themes.dark', 'Dark') }}
                </DsButton>
              </div>
            </div>

            <div class="setting-item">
              <label class="section-label">{{ translate('settings.fontSize', 'Font Size') }}</label>
              <div class="slider-container">
                <label for="font-size-slider" class="sr-only">{{ translate('settings.fontSize', 'Font Size') }}</label>
                <input
                  id="font-size-slider"
                  v-model.number="settings.fontSize"
                  type="range"
                  min="30"
                  max="100"
                  class="slider"
                />
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
                <DsButton variant="secondary" class="full-width" @click="openAccountConsole">
                  {{ translate('settings.manageMyAccount', 'Manage my account') }} →
                </DsButton>
                <p class="description-text">
                  {{ translate('settings.manageMyAccountDesc', 'Update your email, password, and account settings.') }}
                </p>
              </div>

              <div class="management-col">
                <DsButton variant="danger" class="full-width" @click="confirmResetUserData">
                  {{ translate('settings.resetUserData', 'Reset User Data') }}
                </DsButton>
                <p class="description-text">
                  {{
                    translate('settings.resetUserDataDesc', 'This will clear all your profile data and chat history.')
                  }}
                </p>
              </div>

              <div class="management-col">
                <DsButton variant="danger" class="full-width" @click="confirmDeleteAccount">
                  {{ translate('settings.deleteAccount', 'Delete my account') }}
                </DsButton>
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
    danger
    @confirm="handleResetDataConfirm"
    @cancel="handleResetDataCancel"
  />

  <ConfirmDialog
    :visible="showDeleteAccountConfirm"
    :title="deleteAccountDialog.title"
    :message="deleteAccountDialog.message"
    :confirm-text="deleteAccountDialog.confirmText"
    :cancel-text="deleteAccountDialog.cancelText"
    danger
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
import DsButton from '@/components/ds/Button.vue';
import DsSpinner from '@/components/ds/Spinner.vue';
import DsStateDisplay from '@/components/ds/StateDisplay.vue';

export default {
  name: 'SettingsComponent',
  components: {
    ConfirmDialog,
    LanguageSelector,
    DsButton,
    DsSpinner,
    DsStateDisplay
  },
  emits: ['themeChanged'],
  data() {
    return {
      currentLocale: this.$i18n ? this.$i18n.locale : 'en',
      isLoading: true,
      errorMessage: null,
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
    }
  },
  watch: {
    'settings.theme'() {
      this.$forceUpdate();
    },
    currentLocale: function () {
      this.updateDialogTexts();
    }
  },
  created() {
    this.currentLocale = this.$i18n ? this.$i18n.locale : 'en';

    this.fetchUserData();

    this.updateDialogTexts();

    this.$watch('settings.language', (newVal) => {
      this.updateDialogTexts();
      if (this.$i18n) {
        this.$i18n.locale = newVal;
        this.currentLocale = newVal;
        this.$forceUpdate();
        if (this.$root) {
          this.$root.$forceUpdate();
        }
      }
    });

    if (this.$i18n) {
      this.$watch('$i18n.locale', (newLocale) => {
        this.currentLocale = newLocale;
        if (this.settings && this.settings.language !== newLocale) {
          this.settings.language = newLocale;
        }
        this.$forceUpdate();
      });
    }
  },
  mounted() {
    window.addEventListener('themeChange', this.updateTheme);

    this.applyTheme(this.settings.theme);

    if (this.$i18n) {
      const savedLanguage = localStorage.getItem('userLocale') || 'en';
      this.$i18n.locale = savedLanguage;
      this.settings.language = savedLanguage;
      this.$nextTick(() => {
        this.$forceUpdate();
      });
    }
  },
  beforeUnmount() {
    window.removeEventListener('themeChange', this.updateTheme);
  },
  methods: {
    getCurrentTheme() {
      let theme = localStorage.getItem('theme') || 'light';

      if (theme === 'system') {
        theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      return theme;
    },
    getCurrentLanguage() {
      if (this.$i18n && this.$i18n.locale) {
        return this.$i18n.locale;
      }

      try {
        const savedLocale = localStorage.getItem('userLocale');
        if (savedLocale) {
          return savedLocale;
        }
      } catch (e) {
        console.error('[SETTINGS] Error accessing localStorage for language:', e);
      }

      return 'en';
    },
    getSavedFontSize() {
      try {
        const fontSize = localStorage.getItem('fontSize');
        if (fontSize) {
          return parseInt(fontSize);
        }
        return 50;
      } catch (e) {
        console.error('[SETTINGS] Error accessing localStorage for font size:', e);
        return 50;
      }
    },
    getSavedPreference(key, defaultValue) {
      try {
        const value = localStorage.getItem(key);
        if (value !== null) {
          return JSON.parse(value);
        }
        return defaultValue;
      } catch (e) {
        console.error(`[SETTINGS] Error accessing localStorage for ${key}:`, e);
        return defaultValue;
      }
    },
    translate(key, fallback = '') {
      if (!this.$i18n) {
        return fallback;
      }
      try {
        const translation = this.$i18n.t(key, { locale: this.currentLocale });
        if (translation === key) {
          return fallback || key;
        }
        return translation;
      } catch (e) {
        console.error('[SETTINGS] Translation error:', e);
        return fallback || key;
      }
    },
    updateTheme() {
      const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
      if (this.settings.theme !== currentTheme) {
        this.settings.theme = currentTheme;
      }
    },
    applyTheme(theme) {
      this.settings.theme = theme;
      localStorage.setItem('theme', theme);
      try {
        themeManager.setTheme(theme);
      } catch (e) {
        console.error('[SETTINGS] Error applying theme:', e);
      }
      this.$emit('themeChanged', theme);
      this.$forceUpdate();
    },
    updateDialogTexts() {
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
    async fetchUserData() {
      this.isLoading = true;
      this.errorMessage = null;
      try {
        const userData = this.$store.getters.currentUser;
        if (!userData) {
          throw new Error('No user data available in store');
        }
        this.userData = {
          name:
            userData.name ||
            userData.fullName ||
            userData.loginName ||
            userData.username ||
            this.translate('settings.user'),
          email: userData.email || '',
          accountType: (userData.roles && userData.roles.join(', ')) || this.translate('settings.standardAccount'),
          createdAt: userData.createdAt || ''
        };
        if (userData.avatarUrl) {
          this.userAvatar = userData.avatarUrl;
        }
      } catch (error) {
        console.error('[SETTINGS] Error fetching user data:', error);
        notificationService.error(this.translate('settings.unableToLoadUser'));
        const fallbackUser = this.$store.getters.currentUser;
        if (fallbackUser) {
          this.userData = {
            name:
              fallbackUser.name || fallbackUser.fullName || fallbackUser.loginName || this.translate('settings.user'),
            email: fallbackUser.email || '',
            accountType: (fallbackUser.roles && fallbackUser.roles.join(', ')) || this.translate('settings.account'),
            createdAt: fallbackUser.createdAt || ''
          };
        }
      } finally {
        this.isLoading = false;
      }
    },
    save() {
      notificationService.info(this.translate('settings.savingSettings', 'Saving your settings...'), 1000);
      if (this.$i18n) {
        this.$i18n.locale = this.settings.language;
        try {
          localStorage.setItem('userLocale', this.settings.language);
        } catch (e) {
          console.error('[SETTINGS] Error saving language preference:', e);
        }
      }
      themeManager.setTheme(this.settings.theme);
      try {
        localStorage.setItem('theme', this.settings.theme);
      } catch (e) {
        console.error('[SETTINGS] Error saving theme preference:', e);
      }
      try {
        localStorage.setItem('fontSize', this.settings.fontSize.toString());
        document.documentElement.style.fontSize = `${this.settings.fontSize / 50}rem`;
      } catch (e) {
        console.error('[SETTINGS] Error saving font size:', e);
      }
      try {
        localStorage.setItem('emailUpdates', JSON.stringify(this.settings.emailUpdates));
        localStorage.setItem('soundNotifications', JSON.stringify(this.settings.soundNotifications));
      } catch (e) {
        console.error('[SETTINGS] Error saving notification preferences:', e);
      }
      this.$emit('themeChanged', this.settings.theme);
      notificationService.success(this.translate('settings.settingsSaved', 'Settings saved successfully!'));
      this.$router.push('/dashboard');
    },
    openAccountConsole() {
      window.open(this.accountConsoleUrl, '_blank', 'noopener,noreferrer');
    },
    confirmResetUserData() {
      this.showResetDataConfirm = true;
    },
    handleResetDataConfirm() {
      this.showResetDataConfirm = false;
      this.resetUserData();
    },
    handleResetDataCancel() {
      this.showResetDataConfirm = false;
    },
    async resetUserData() {
      try {
        this.isLoading = true;
        await userService.resetUserData();
        notificationService.success(
          this.translate('settings.userDataReset', 'Your profile data has been successfully reset.')
        );
        await this.fetchUserData();
        const themeValue = localStorage.getItem('theme');
        const langValue = localStorage.getItem('userLocale');
        localStorage.clear();
        if (themeValue) localStorage.setItem('theme', themeValue);
        if (langValue) localStorage.setItem('userLocale', langValue);
      } catch (e) {
        console.error('[SETTINGS] Error resetting user data:', e);
        notificationService.error(
          this.translate('settings.failedToResetUserData', 'Failed to reset your profile data. Please try again later.')
        );
      } finally {
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
.settings-page {
  background: var(--bg);
}

.settings-content {
  padding: var(--space-lg);
}

/* Header with buttons */
.dialog-header {
  padding: var(--space-md) var(--space-lg);
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--border);
}

.header-title {
  margin: 0;
  font-size: var(--text-xl);
  font-weight: 600;
  color: var(--fg);
}

.header-actions {
  display: flex;
  gap: var(--space-sm);
}

/* Profile section */
.profile-section {
  padding: var(--space-md) var(--space-lg);
  background-color: var(--surface);
  display: flex;
  align-items: center;
  gap: var(--space-md);
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
  background-color: var(--accent);
  color: var(--accent-fg);
  font-size: var(--text-xl);
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
  font-size: var(--text-lg);
  font-weight: 500;
  margin-bottom: var(--space-xs);
  color: var(--fg);
}

.user-email {
  color: var(--muted);
  margin-bottom: var(--space-xs);
}

.account-type {
  color: var(--muted-soft);
  font-size: var(--text-base);
  font-weight: 500;
}

/* Main settings area */
.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--space-md);
  padding: var(--space-md) var(--space-lg);
}

.settings-box {
  background-color: var(--surface);
  border-radius: var(--radius-md);
  padding: var(--space-md);
}

.section-title {
  margin-top: 0;
  margin-bottom: var(--space-md);
  font-size: var(--text-lg);
  font-weight: 500;
  color: var(--fg);
}

.setting-item {
  margin-bottom: var(--space-md);
}

.section-label {
  display: block;
  margin-bottom: var(--space-sm);
  font-size: var(--text-md);
  font-weight: 400;
  color: var(--muted);
}

/* Toggle row */
.toggle-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

/* Account management */
.account-management-section {
  padding: 0 var(--space-lg) var(--space-md);
}

.account-management-grid {
  background-color: var(--surface);
  padding: var(--space-md);
  border-radius: var(--radius-md);
  display: grid;
  gap: var(--space-md);
}

.management-row {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--space-md);
  margin-bottom: var(--space-md);
}

.management-row:last-child {
  margin-bottom: 0;
}

.management-col {
  min-width: 0;
}

/* Error text */
.error-text {
  color: var(--danger);
  font-size: var(--text-base);
  margin-top: var(--space-xs);
  margin-bottom: 0;
}

/* Theme buttons styling */
.theme-buttons {
  display: flex;
  gap: var(--space-sm);
}

.theme-toggle {
  flex: 1;
}

.theme-toggle.active {
  background-color: var(--accent);
  color: var(--accent-fg);
  border-color: var(--accent);
}

/* Dropdown styling */
.dropdown {
  width: 100%;
  padding: var(--space-sm);
  border-radius: var(--radius-sm);
  background-color: var(--surface);
  color: var(--fg);
  border: 1px solid var(--border);
}

/* Slider styling */
.slider-container {
  display: flex;
  align-items: center;
  gap: var(--space-md);
}

.slider {
  flex: 1;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: var(--border-light);
  outline: none;
  border-radius: var(--radius-sm);
}

.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--accent);
  cursor: pointer;
}

.slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--accent);
  cursor: pointer;
  border: none;
}

.slider-value {
  min-width: 3rem;
  text-align: right;
  color: var(--muted);
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
  background-color: var(--border);
  border-radius: var(--radius-lg);
  transition: 0.4s;
}

.switch-thumb {
  position: absolute;
  height: 20px;
  width: 20px;
  left: 2px;
  bottom: 2px;
  background-color: var(--fg);
  border-radius: 50%;
  transition: 0.4s;
}

.switch-track.active .switch-thumb {
  transform: translateX(26px);
}

.switch-track.active {
  background-color: var(--accent);
}

.danger-text {
  color: var(--danger);
}

.description-text {
  margin-top: var(--space-sm);
  font-size: var(--text-base);
  color: var(--muted-soft);
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
    background-color: var(--surface);
    z-index: 10;
  }
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}
</style>
