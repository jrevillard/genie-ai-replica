<template>
  <div class="settings-overlay">
    <div class="settings-dialog">
      <!-- Header with Buttons -->
      <div class="dialog-header">
        <h2 class="header-title">{{ $t('settings.title', 'Settings') }}</h2>
        <div class="header-actions">
          <button class="btn-close" @click="close">
            {{ $t('settings.close', 'Close') }}
          </button>
          <button class="btn-save" @click="save">
            {{ $t('settings.saveSettings', 'Save Settings') }}
          </button>
        </div>
      </div>

      <!-- Loading Indicator -->
      <div v-if="isLoading" class="loading-overlay">
        <div class="loading-spinner"></div>
        <p>{{ $t('settings.loadingUserInfo', 'Loading user information...') }}</p>
      </div>

      <!-- Error Message -->
      <div v-else-if="errorMessage" class="error-container">
        <p class="error-message">{{ errorMessage }}</p>
        <button @click="fetchUserData" class="btn-retry">{{ $t('settings.retry', 'Retry') }}</button>
      </div>

      <div v-else>
        <!-- User Profile Section -->
        <div class="profile-section">
          <div class="account-avatar">
            <div class="avatar-placeholder" v-if="!userAvatar">
              {{userData.name ? userData.name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) : '?'}}
            </div>
            <img v-else :src="userAvatar" alt="User avatar" class="avatar-image" />
          </div>
          <div class="account-details">
            <div class="user-name">{{ userData.name || $t('settings.userName', 'User') }}</div>
            <div class="user-email">{{ userData.email || 'email@example.com' }}</div>
            <div class="account-type">{{ userData.accountType || $t('settings.standardAccount', 'Standard Account') }}
            </div>
          </div>
        </div>

        <!-- Settings Grid -->
        <div class="settings-grid">
          <!-- Display Box (Language + Theme) -->
          <div class="settings-box">
            <h3 class="section-title">{{ $t('settings.display', 'Display') }}</h3>

            <!-- Language Selector -->
            <div class="setting-item">
              <label class="section-label">{{ $t('settings.displayLanguage', 'Display Language') }}</label>
              <select class="dropdown" v-model="settings.language" @change="applyLanguage">
                <option value="en">{{ $t('settings.languages.english', 'English') }}</option>
                <option value="fr">{{ $t('settings.languages.french', 'Français') }}</option>
                <option value="sw">{{ $t('settings.languages.swahili', 'Kiswahili') }}</option>
              </select>
            </div>

            <!-- Theme Controls -->
            <div class="setting-item">
              <label class="section-label">{{ $t('settings.theme', 'Theme') }}</label>
              <div class="theme-buttons">
                <button class="theme-toggle" :class="{ active: settings.theme === 'light' }"
                  @click="applyTheme('light')">
                  {{ $t('settings.themes.light', 'Light') }}
                </button>
                <button class="theme-toggle" :class="{ active: settings.theme === 'dark' }" @click="applyTheme('dark')">
                  {{ $t('settings.themes.dark', 'Dark') }}
                </button>
                <button class="theme-toggle" :class="{ active: settings.theme === 'system' }"
                  @click="applyTheme('system')">
                  {{ $t('settings.themes.system', 'System') }}
                </button>
              </div>
            </div>

            <!-- Font Size -->
            <div class="setting-item">
              <label class="section-label">{{ $t('settings.fontSize', 'Font Size') }}</label>
              <div class="slider-container">
                <input type="range" min="30" max="100" v-model.number="settings.fontSize" class="slider" />
                <span class="slider-value">{{ settings.fontSize }}%</span>
              </div>
            </div>
          </div>

          <!-- Notifications Box -->
          <div class="settings-box">
            <h3 class="section-title">{{ $t('settings.notifications', 'Notifications') }}</h3>

            <div class="setting-item">
              <div class="toggle-row">
                <label class="section-label">{{ $t('settings.emailUpdates', 'Email Updates') }}</label>
                <div class="switch" @click="settings.emailUpdates = !settings.emailUpdates">
                  <div class="switch-track" :class="{ active: settings.emailUpdates }">
                    <div class="switch-thumb"></div>
                  </div>
                </div>
              </div>
            </div>

            <div class="setting-item">
              <div class="toggle-row">
                <label class="section-label">{{ $t('settings.soundNotifications', 'Sound Notifications') }}</label>
                <div class="switch" @click="settings.soundNotifications = !settings.soundNotifications">
                  <div class="switch-track" :class="{ active: settings.soundNotifications }">
                    <div class="switch-thumb"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Account Management Section -->
        <div class="account-management-section">
          <h3 class="section-title">{{ $t('settings.accountManagement', 'Account Management') }}</h3>

          <div class="account-management-grid">
            <!-- Row 1: Email & Password -->
            <div class="management-row">
              <div class="management-col">
                <label class="section-label">{{ $t('settings.emailAddress', 'Email Address') }}</label>
                <div class="input-with-button">
                  <input type="email" class="text-input" v-model="userData.email" :disabled="!isEditingEmail"
                    :placeholder="$t('settings.emailAddressPlaceholder', 'Your email address')" />
                  <button class="btn-secondary" @click="toggleEmailEdit" :disabled="isEmailUpdating">
                    {{ isEditingEmail ? $t('settings.save', 'Save') : $t('settings.edit', 'Edit') }}
                  </button>
                </div>
                <p v-if="emailError" class="error-text">{{ emailError }}</p>
              </div>

              <div class="management-col">
                <label class="section-label">{{ $t('settings.password', 'Password') }}</label>
                <button class="btn-secondary full-width" @click="initiatePasswordChange">
                  {{ $t('settings.changePassword', 'Change Password') }}
                </button>
              </div>
            </div>

            <!-- Row 2: Reset & Delete -->
            <div class="management-row">
              <div class="management-col">
                <button class="btn-secondary full-width" @click="confirmResetUserData">
                  {{ $t('settings.resetUserData', 'Reset User Data') }}
                </button>
                <p class="description-text">
                  {{ $t('settings.resetUserDataDesc', 'This will clear all your profile data and chat history.') }}
                </p>
              </div>

              <div class="management-col">
                <button class="btn-danger full-width" @click="confirmDeleteAccount">
                  {{ $t('settings.deleteAccount', 'Delete Account') }}
                </button>
                <p class="description-text danger-text">
                  {{ $t('settings.deleteAccountDesc', 'This will permanently delete your account and all associated data.') }}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Email Change Confirmation Modal -->
      <div class="modal" v-if="showEmailConfirmModal">
        <div class="modal-content">
          <h3 class="modal-title">{{ $t('settings.confirmEmailChange', 'Confirm Email Change') }}</h3>

          <div class="modal-body">
            <p>{{ $t('settings.changingEmailTo', 'Changing your email to') }} <strong>{{ newEmail }}</strong> {{
              $t('settings.will', 'will') }}:</p>
            <ul>
              <li>{{ $t('settings.logOutSystem', 'Log you out of the system') }}</li>
              <li>{{ $t('settings.sendVerificationLink', 'Send a verification link to your new email') }}</li>
              <li>{{ $t('settings.requireVerification', 'Require verification before you can log in again') }}</li>
            </ul>

            <div class="form-group">
              <label for="confirmPassword">{{ $t('settings.enterPasswordConfirm', 'Enter your password to confirm')
                }}:</label>
              <input v-model="emailChangePassword" type="password" id="confirmPassword"
                :placeholder="$t('settings.currentPasswordPlaceholder', 'Your current password')" class="text-input"
                required />
              <p v-if="emailChangeError" class="error-text">{{ emailChangeError }}</p>
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn-close" @click="cancelEmailChange">
              {{ $t('settings.cancel', 'Cancel') }}
            </button>
            <button class="btn-save" @click="confirmEmailChange" :disabled="!emailChangePassword || isEmailUpdating">
              {{ isEmailUpdating ? $t('settings.processing', 'Processing...') : $t('settings.confirmChange', 'Confirm Change') }}
            </button>
          </div>
        </div>
      </div>

      <!-- Password Reset Modal - FIXED -->
      <div class="modal" v-if="showPasswordReset">
        <PasswordResetInitiateScreen :prefilledEmail="userData.email" :isEmbedded="true"
          @reset-initiated="handlePasswordResetInitiated" @cancel="cancelPasswordReset" />
      </div>
    </div>
  </div>
</template>

<script>
// Import the user service
import userService from '@/services/userService';
// Import the PasswordResetInitiateScreen component
import PasswordResetInitiateScreen from '@/components/PasswordResetInitiateScreen.vue';

// Import the theme manager
import { themeManager, setTheme } from '@/utils/ThemeManager';

export default {
  name: 'SettingsComponent',
  components: {
    PasswordResetInitiateScreen
  },
  data() {
    return {
      // Data loading state
      isLoading: true,
      errorMessage: null,

      // Store userId for authentication during email changes
      currentUserId: '',

      // Initialize with current app settings
      settings: {
        language: this.getCurrentLanguage(),
        theme: document.documentElement.getAttribute('data-theme') || 'light',
        fontSize: this.getSavedFontSize(),
        emailUpdates: this.getSavedPreference('emailUpdates', false),
        soundNotifications: this.getSavedPreference('soundNotifications', true)
      },

      // User account data
      userData: {
        name: '',
        email: '',
        accountType: '',
        userId: '',
        createdAt: ''
      },
      userAvatar: null,

      // Email editing state
      isEditingEmail: false,
      emailError: null,
      newEmail: '',
      isEmailUpdating: false,

      // Email change confirmation
      showEmailConfirmModal: false,
      emailChangePassword: '',
      emailChangeError: null,

      // Password Reset Flow - FIXED
      showPasswordReset: false
    }
  },

  // Add this to your created() lifecycle hook (to replace the watcher in your original code)
  created() {
    // Fetch user data when component is created
    this.fetchUserData();

    // Add a watcher for language changes that forces rendering updates
    this.$watch('settings.language', (newVal) => {
      // Apply language change without page reload
      if (this.$i18n) {
        this.$i18n.locale = newVal;
        this.$forceUpdate();

        // Force update the entire component tree if possible
        if (this.$root) {
          this.$root.$forceUpdate();
        }
      }
    });
  },

  methods: {
    // Get current language from i18n or localStorage
    getCurrentLanguage() {
      // First try to get from i18n instance
      if (this.$i18n && this.$i18n.locale) {
        return this.$i18n.locale;
      }
      
      // Fallback to localStorage
      try {
        const savedLocale = localStorage.getItem('userLocale');
        if (savedLocale) {
          return savedLocale;
        }
      } catch (e) {
        console.warn('Error accessing localStorage for language:', e);
      }
      
      // Default to English if nothing else works
      return 'en';
    },
    
    // Get saved font size or default to 50%
    getSavedFontSize() {
      try {
        const fontSize = localStorage.getItem('fontSize')
        return fontSize ? parseInt(fontSize) : 50
      } catch (e) {
        console.warn('Error accessing localStorage:', e)
        return 50
      }
    },

    // Get saved preference with fallback
    getSavedPreference(key, defaultValue) {
      try {
        const value = localStorage.getItem(key)
        return value !== null ? JSON.parse(value) : defaultValue
      } catch (e) {
        console.warn(`Error accessing localStorage for ${key}:`, e)
        return defaultValue
      }
    },
    // In SettingsComponent.vue, modify your applyLanguage method:
    // Method 1: Don't reload in applyLanguage, just update the local component
    applyLanguage() {
      if (this.$i18n) {
        // Set the i18n locale for this component only
        this.$i18n.locale = this.settings.language;

        // Save to localStorage
        try {
          localStorage.setItem('userLocale', this.settings.language);
        } catch (e) {
          console.warn('Error saving language preference:', e);
        }

        // Just update this component
        this.$forceUpdate();
      }
    },

    mounted() {
      // Add theme change listener
      window.addEventListener('themeChange', this.updateTheme);

      // CRUCIAL FIX: Force updating i18n when component mounts
      // This ensures translations are applied on initial render
      if (this.$i18n) {
        const savedLanguage = localStorage.getItem('userLocale') || 'en';

        // Force the i18n locale to match the saved locale
        this.$i18n.locale = savedLanguage;

        // Update the component state to match
        this.settings.language = savedLanguage;

        // Explicitly trigger Vue's reactivity system
        this.$nextTick(() => {
          // Force a re-render of this component specifically
          this.$forceUpdate();
        });
      }
    },

    applyTheme(theme) {
      console.log('Theme button clicked:', theme);

      // Update local state
      this.settings.theme = theme;

      // First save to localStorage
      localStorage.setItem('theme', theme);

      // Apply theme to document elements
      document.documentElement.setAttribute('data-theme', theme);
      document.body.setAttribute('data-theme', theme);

      // Update dark mode classes
      if (theme === 'dark') {
        document.documentElement.classList.add('dark-mode');
        document.documentElement.classList.remove('light-mode');
        document.body.classList.remove('light-mode');
        document.body.classList.add('dark-mode');
      } else {
        document.documentElement.classList.remove('dark-mode');
        document.documentElement.classList.add('light-mode');
        document.body.classList.remove('dark-mode');
        document.body.classList.add('light-mode');
      }

      // Ensure ThemeManager is updated if available
      try {
        if (typeof themeManager !== 'undefined' && themeManager) {
          themeManager.currentTheme = theme;
          themeManager.isDarkMode = theme === 'dark';
          themeManager.userPreference = theme;
        }
      } catch (e) {
        console.warn('Error updating ThemeManager:', e);
      }

      // Dispatch a theme change event with a slight delay to ensure DOM updates first
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('themeChange', {
          detail: { theme, isDarkMode: theme === 'dark' }
        }));
      }, 50);

      // Notify parent component
      this.$emit('themeChanged', theme);
    },

    // Fetch user data from the backend
    async fetchUserData() {
      this.isLoading = true;
      this.errorMessage = null;

      try {
        // First try to get from cached user data (fast)
        let userData = userService.getCurrentUser();

        if (!userData) {
          // If no cached data, fetch from API
          userData = await userService.getCurrentUserInfo();
        } else {
          // If we have cached data, refresh in background
          userService.refreshUserData().catch(err => {
            console.warn('Background refresh failed:', err);
          });
        }

        // Extract the numeric ID part if it includes 'users/' prefix
        let userId = userData.id || userData.userId || userData._id || '';

        // Remove 'users/' prefix if present
        if (typeof userId === 'string' && userId.includes('/')) {
          userId = userId.split('/').pop();
        }

        this.currentUserId = userId;
        console.log('[SETTINGS] Stored user ID for authentication:', this.currentUserId);

        // Update component with user data
        this.userData = {
          name: userData.fullName || userData.loginName || userData.username || this.$t('settings.user'),
          email: userData.email || '',
          accountType: userData.accountType || userData.role || this.$t('settings.standardAccount'),
          userId: this.currentUserId, // Use the cleaned ID
          createdAt: userData.createdAt || ''
        };

        // Set avatar if available
        if (userData.avatarUrl) {
          this.userAvatar = userData.avatarUrl;
        }
      } catch (error) {
        console.error('Error fetching user data:', error);
        this.errorMessage = this.$t('settings.unableToLoadUser');

        // Use any data we might already have
        const fallbackUser = userService.getCurrentUser();
        if (fallbackUser) {
          let userId = fallbackUser.id || fallbackUser.userId || fallbackUser._id || '';

          // Remove 'users/' prefix if present
          if (typeof userId === 'string' && userId.includes('/')) {
            userId = userId.split('/').pop();
          }

          this.currentUserId = userId;

          this.userData = {
            name: fallbackUser.fullName || fallbackUser.loginName || this.$t('settings.user'),
            email: fallbackUser.email || '',
            accountType: fallbackUser.accountType || this.$t('settings.account'),
            userId: this.currentUserId,
            createdAt: fallbackUser.createdAt || ''
          };
        }
      } finally {
        this.isLoading = false;
      }
    },

    // Close without saving
    close() {
      this.$emit('close')
    },

    // Then update your save method to dispatch the global event:
    // Method 2: When saving, do the global reload after closing
    save() {
      // First set a flag to indicate we're changing language
      const isChangingLanguage = this.$i18n &&
        this.$i18n.locale !== this.settings.language;

      // Save language preference
      if (this.$i18n) {
        this.$i18n.locale = this.settings.language;
        try {
          localStorage.setItem('userLocale', this.settings.language);
        } catch (e) {
          console.warn('Error saving language preference:', e);
        }
      }

      // Save all other settings as before...

      // Ensure theme is applied and saved
      document.documentElement.setAttribute('data-theme', this.settings.theme);
      document.body.setAttribute('data-theme', this.settings.theme);
      try {
        localStorage.setItem('theme', this.settings.theme);
      } catch (e) {
        console.warn('Error saving theme preference:', e);
      }

      // Save font size
      try {
        localStorage.setItem('fontSize', this.settings.fontSize.toString())
        document.documentElement.style.fontSize = `${this.settings.fontSize / 50}rem`
      } catch (e) {
        console.warn('Error saving font size:', e)
      }

      // Save notification preferences
      try {
        localStorage.setItem('emailUpdates', JSON.stringify(this.settings.emailUpdates))
        localStorage.setItem('soundNotifications', JSON.stringify(this.settings.soundNotifications))
      } catch (e) {
        console.warn('Error saving notification preferences:', e)
      }

      // Emit events
      this.$emit('themeChanged', this.settings.theme);

      // Close dialog
      this.$emit('close');

      // If language was changed, reload AFTER dialog closed
      if (isChangingLanguage) {
        setTimeout(() => {
          window.location.reload();
        }, 100); // Short delay to ensure dialog closes first
      }
    },

    // Show confirmation dialog before resetting user data
    confirmResetUserData() {
      if (confirm(this.$t('settings.confirmResetUserData'))) {
        this.resetUserData()
      }
    },

    // Reset all user data
    resetUserData() {
      try {
        // Clear all localStorage items except theme and language
        const themeValue = localStorage.getItem('theme')
        const langValue = localStorage.getItem('userLocale')

        localStorage.clear()

        // Restore theme and language
        if (themeValue) localStorage.setItem('theme', themeValue)
        if (langValue) localStorage.setItem('userLocale', langValue)

        // Inform user
        alert(this.$t('settings.userDataReset'))
      } catch (e) {
        console.error('Error clearing user data:', e)
        alert(this.$t('settings.failedToResetUserData'))
      }
    },

    // Toggle email editing state
    toggleEmailEdit() {
      if (this.isEditingEmail) {
        // Save email changes
        this.prepareEmailChange();
      } else {
        // Enable editing and store the original email
        this.isEditingEmail = true;
        this.newEmail = this.userData.email;
      }
    },

    // Confirm delete account
    confirmDeleteAccount() {
      if (confirm(this.$t('settings.confirmDeleteAccount'))) {
        alert(this.$t('settings.accountDeletionNotImplemented'));
      }
    },

    // Password Reset Methods - FIXED
    // Initiate password change flow
    initiatePasswordChange() {
      // Show the password reset component
      this.showPasswordReset = true;
    },

    // Handle successful password reset initiation
    handlePasswordResetInitiated(email) {
      console.log('Password reset initiated for:', email);

      // Close the modal after showing success message
      setTimeout(() => {
        this.showPasswordReset = false;
        alert(this.$t('settings.passwordResetInitiated', 'A password reset link has been sent to your email address.'));
      }, 1500);
    },

    // Cancel password reset flow
    cancelPasswordReset() {
      this.showPasswordReset = false;
    },

    // Email-related methods
    //Prepare the email change 
    async prepareEmailChange() {
      // Reset errors
      this.emailError = null;

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(this.userData.email)) {
        this.emailError = this.$t('settings.enterValidEmail');
        return;
      }

      // If email hasn't changed, just exit edit mode
      if (this.userData.email === this.newEmail) {
        this.isEditingEmail = false;
        return;
      }

      try {
        console.log(`Checking availability for ${this.userData.email}`);
        const isAvailable = await userService.checkEmailAvailability(this.userData.email);

        if (!isAvailable) {
          this.emailError = this.$t('settings.emailAlreadyInUse');
          return;
        }

        // Email is available, continue with change
        this.newEmail = this.userData.email;
        this.showEmailConfirmModal = true;
      } catch (error) {
        console.error('Error checking email availability:', error);
        this.emailError = this.$t('settings.unableToVerifyEmail');
      }
    },

    // Confirm and process email change
    async confirmEmailChange() {
      if (!this.emailChangePassword) {
        this.emailChangeError = this.$t('settings.pleaseEnterPassword');
        return;
      }

      // Set updating state
      this.isEmailUpdating = true;
      this.emailChangeError = null;

      try {
        console.log('[SETTINGS] Confirming email change to:', this.userData.email);
        console.log('[SETTINGS] Using userId for authentication:', this.currentUserId);

        // Call the user service to update the email
        const response = await userService.updateEmail(
          this.userData.email,  // New email
          this.emailChangePassword,  // Password for verification
          this.currentUserId  // User ID for authentication
        );

        console.log('[SETTINGS] Email update response:', response);

        // Show success message
        alert(this.$t('settings.checkNewEmailVerification'));

        // Close modals
        this.showEmailConfirmModal = false;
        this.isEditingEmail = false;

        // Immediate logout
        setTimeout(() => {
          userService.logout().then(() => {
            // Redirect to login page
            window.location.href = '/login';
          }).catch(err => {
            console.error('Logout error:', err);
            window.location.href = '/login'; // Redirect anyway
          });
        }, 1500); // Short delay to allow user to read the message
      } catch (error) {
        console.error('Error updating email:', error);
        this.emailChangeError = this.$t('settings.failedToUpdateEmail');
      } finally {
        this.isEmailUpdating = false;
      }
    },

    // Cancel email change
    cancelEmailChange() {
      this.showEmailConfirmModal = false;
      this.emailChangePassword = '';
      this.emailChangeError = null;
    }
  }
}
</script>

<style scoped>
/* Settings dialog styling */
.settings-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
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
  background-color: var(--bg-dialog, #ffffff);
  color: var(--text-primary, #333333);
  box-shadow: var(--shadow-lg, 0 10px 15px rgba(0, 0, 0, 0.1));
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
  border-bottom: 1px solid var(--border-color, #dcdfe4);
}

.header-title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--text-primary, #333333);
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
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 4px solid rgba(0, 0, 0, 0.1);
  border-radius: 50%;
  border-top-color: var(--bg-button-primary, #4E97D1);
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
  background-color: var(--bg-button-secondary, #e9ecef);
  color: var(--text-button-secondary, #4d4d4d);
  border: 1px solid var(--border-color, #dcdfe4);
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
  background-color: var(--bg-button-primary, #4E97D1);
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
  color: var(--text-primary, #333333);
}

.setting-item {
  margin-bottom: 1rem;
}

.section-label {
  display: block;
  margin-bottom: 0.5rem;
  font-size: 1rem;
  font-weight: 400;
  color: var(--text-secondary, #4d4d4d);
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
  background-color: var(--bg-button-secondary, #e9ecef);
  color: var(--text-button-secondary, #4d4d4d);
  border: 1px solid var(--border-color, #dcdfe4);
}

.theme-toggle.active {
  background-color: var(--bg-button-primary, #4E97D1);
  color: var(--text-button-primary, #ffffff);
  border-color: var(--bg-button-primary, #4E97D1);
}

/* Dropdown styling */
.dropdown {
  width: 100%;
  padding: 0.5rem;
  border-radius: 4px;
  background-color: var(--bg-input, #ffffff);
  color: var(--text-primary, #333333);
  border: 1px solid var(--border-input, #dcdfe4);
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
  background: var(--slider-thumb, #4E97D1);
  cursor: pointer;
}

.slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--slider-thumb, #4E97D1);
  cursor: pointer;
  border: none;
}

.slider-value {
  min-width: 3rem;
  text-align: right;
  color: var(--text-primary, #333333);
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
  transition: .4s;
}

.switch-thumb {
  position: absolute;
  height: 20px;
  width: 20px;
  left: 2px;
  bottom: 2px;
  background-color: var(--switch-thumb, #ffffff);
  border-radius: 50%;
  transition: .4s;
}

.switch-track.active .switch-thumb {
  transform: translateX(26px);
}

.switch-track.active {
  background-color: var(--switch-track-on, #4E97D1);
}

/* Text input styling */
.text-input {
  width: 100%;
  padding: 0.5rem;
  border-radius: 4px;
  background-color: var(--bg-input, #ffffff);
  color: var(--text-primary, #333333);
  border: 1px solid var(--border-input, #dcdfe4);
}

.input-with-button {
  display: flex;
  gap: 0.5rem;
}

.input-with-button .text-input {
  flex: 1;
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
  background-color: var(--bg-button-secondary, #e9ecef);
  color: var(--text-button-secondary, #4d4d4d);
  border: 1px solid var(--border-color, #dcdfe4);
}

.btn-secondary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.full-width {
  width: 100%;
}

.btn-danger {
  width: 100%;
  padding: 0.6rem 1.25rem;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 500;
  border: none;
  background-color: var(--bg-danger, #dc3545);
  color: white;
  transition: all 0.2s;
}

.btn-danger:hover {
  background-color: var(--bg-danger-hover, #c82333);
}

.btn-save {
  background-color: var(--bg-button-primary, #4E97D1);
  color: var(--text-button-primary, #ffffff);
}

.btn-close {
  background-color: var(--bg-button-secondary, #e9ecef);
  color: var(--text-button-secondary, #4d4d4d);
}

.description-text {
  margin-top: 0.5rem;
  font-size: 0.875rem;
  color: var(--text-tertiary, #767676);
}

.danger-text {
  color: var(--text-danger, #dc3545);
}

/* Modal styling */
.modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 2000;
}

.modal-content {
  width: 450px;
  max-width: 90vw;
  max-height: 90vh;
  overflow-y: auto;
  background-color: var(--bg-dialog, #ffffff);
  border-radius: 8px;
  box-shadow: var(--shadow-lg, 0 10px 15px rgba(0, 0, 0, 0.1));
}

.modal-title {
  padding: 1rem 1.5rem;
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  border-bottom: 1px solid var(--border-color, #dcdfe4);
}

.modal-body {
  padding: 1.5rem;
}

.modal-body ul {
  margin-top: 0.5rem;
  margin-bottom: 1.5rem;
  padding-left: 1.5rem;
}

.modal-body ul li {
  margin-bottom: 0.5rem;
}

.modal-footer {
  padding: 1rem 1.5rem;
  display: flex;
  justify-content: flex-end;
  gap: 1rem;
  border-top: 1px solid var(--border-color, #dcdfe4);
}

/* Password Reset Dialog Styles */
.password-reset-modal {
  width: 400px;
  padding: 1.5rem;
  color: #fff;
  background-color: #333;
}

.logo {
  text-align: center;
  margin-bottom: 1rem;
}

.app-logo {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  width: 50px;
  height: 50px;
  border-radius: 50%;
  background-color: #4E97D1;
  margin-bottom: 0.5rem;
}

.vue-logo {
  width: 0;
  height: 0;
  border-left: 10px solid transparent;
  border-right: 10px solid transparent;
  border-bottom: 16px solid #fff;
}

.app-name {
  font-size: 1.5rem;
  color: #fff;
  margin: 0;
  font-weight: 500;
}

.password-reset-heading {
  text-align: center;
  font-size: 1.2rem;
  margin-top: 0;
  margin-bottom: 1.5rem;
  font-weight: 500;
  color: #ddd;
}

.password-reset-form {
  margin-bottom: 1rem;
}

.form-group {
  margin-bottom: 1rem;
}

.form-label {
  display: block;
  margin-bottom: 0.5rem;
  font-size: 0.875rem;
  color: #ddd;
  font-weight: 500;
}

.form-control {
  width: 100%;
  padding: 0.625rem 0.75rem;
  font-size: 0.9375rem;
  border: none;
  border-radius: 6px;
  background-color: #222;
  color: #fff;
  transition: background-color 0.2s;
}

.form-control:focus {
  outline: none;
  background-color: #2a2a2a;
}

.error-message {
  color: #ff6b6b;
  font-size: 0.75rem;
  margin-top: 0.25rem;
  margin-bottom: 0;
}

.reset-button {
  width: 100%;
  padding: 0.625rem;
  background-color: #4E97D1;
  color: white;
  font-size: 0.9375rem;
  font-weight: bold;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.2s;
  margin-top: 0.5rem;
}

.reset-button:hover:not(:disabled) {
  background-color: #4589c0;
}

.reset-button:disabled {
  background-color: #3a7da8;
  cursor: not-allowed;
  opacity: 0.7;
}

/* Password strength indicator */
.password-strength-indicator {
  margin-top: 0.5rem;
  font-size: 0.75rem;
}

.strength-label {
  margin-bottom: 0.25rem;
  color: #ddd;
}

.strength-0 {
  color: #ff4d4d;
}

.strength-1 {
  color: #ffa64d;
}

.strength-2 {
  color: #ffcc00;
}

.strength-3 {
  color: #80cc33;
}

.strength-4 {
  color: #47d147;
}

.strength-bar-container {
  height: 4px;
  background-color: #444;
  border-radius: 2px;
  overflow: hidden;
  margin-bottom: 0.5rem;
}

.strength-bar {
  height: 100%;
  border-radius: 2px;
  transition: width 0.3s ease;
}

.strength-bar.strength-0 {
  background-color: #ff4d4d;
}

.strength-bar.strength-1 {
  background-color: #ffa64d;
}

.strength-bar.strength-2 {
  background-color: #ffcc00;
}

.strength-bar.strength-3 {
  background-color: #80cc33;
}

.strength-bar.strength-4 {
  background-color: #47d147;
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
    background-color: var(--bg-dialog, #ffffff);
    z-index: 10;
  }

  .input-with-button {
    flex-wrap: wrap;
  }

  .input-with-button .text-input {
    width: calc(100% - 70px);
  }

  .input-with-button .btn-secondary {
    width: 60px;
  }
}

/* Add these styles to the <style scoped> section of SettingsComponent.vue */

/* Password strength indicator */
.password-strength-indicator {
  margin-top: 0.5rem;
  font-size: 0.75rem;
}

.strength-label {
  margin-bottom: 0.25rem;
  color: #ddd;
}

.strength-0 {
  color: #ff4d4d;
}

.strength-1 {
  color: #ffa64d;
}

.strength-2 {
  color: #ffcc00;
}

.strength-3 {
  color: #80cc33;
}

.strength-4 {
  color: #47d147;
}

.strength-bar-container {
  height: 4px;
  background-color: #444;
  border-radius: 2px;
  overflow: hidden;
  margin-bottom: 0.5rem;
}

.strength-bar {
  height: 100%;
  border-radius: 2px;
  transition: width 0.3s ease;
}

.strength-bar.strength-0 {
  background-color: #ff4d4d;
}

.strength-bar.strength-1 {
  background-color: #ffa64d;
}

.strength-bar.strength-2 {
  background-color: #ffcc00;
}

.strength-bar.strength-3 {
  background-color: #80cc33;
}

.strength-bar.strength-4 {
  background-color: #47d147;
}

.strength-suggestions {
  list-style-type: none;
  padding-left: 0;
  margin: 0.5rem 0 0;
  color: #aaa;
}

.strength-suggestions li {
  margin-bottom: 0.25rem;
  line-height: 1.2;
  font-size: 0.75rem;
}

.strength-suggestions li::before {
  content: "• ";
  color: #4E97D1;
}

.password-reset-modal-container {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 2001;
  display: flex;
  justify-content: center;
  align-items: center;
  background-color: rgba(0, 0, 0, 0.5);
}
</style>