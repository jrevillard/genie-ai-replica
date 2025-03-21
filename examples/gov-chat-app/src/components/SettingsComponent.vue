<template>
  <div class="settings-overlay">
    <div class="settings-dialog">
      <!-- Header with Buttons -->
      <div class="dialog-header">
        <h2 class="header-title">Settings</h2>
        <div class="header-actions">
          <button class="btn-close" @click="close">
            Close
          </button>
          <button class="btn-save" @click="save">
            Save Settings
          </button>
        </div>
      </div>

      <!-- Loading Indicator -->
      <div v-if="isLoading" class="loading-overlay">
        <div class="loading-spinner"></div>
        <p>Loading user information...</p>
      </div>

      <!-- Error Message -->
      <div v-else-if="errorMessage" class="error-container">
        <p class="error-message">{{ errorMessage }}</p>
        <button @click="fetchUserData" class="btn-retry">Retry</button>
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
            <div class="user-name">{{ userData.name || 'User Name' }}</div>
            <div class="user-email">{{ userData.email || 'email@example.com' }}</div>
            <div class="account-type">{{ userData.accountType || 'Free Account' }}</div>
          </div>
        </div>

        <!-- Settings Grid -->
        <div class="settings-grid">
          <!-- Display Box (Language + Theme) -->
          <div class="settings-box">
            <h3 class="section-title">Display</h3>

            <!-- Language Selector -->
            <div class="setting-item">
              <label class="section-label">Display Language</label>
              <select class="dropdown" v-model="settings.language">
                <option value="en">English</option>
                <option value="fr">French</option>
                <option value="sw">Swahili</option>
              </select>
            </div>

            <!-- Theme Controls -->
            <div class="setting-item">
              <label class="section-label">Theme</label>
              <div class="theme-buttons">
                <button class="theme-toggle" :class="{ active: settings.theme === 'light' }"
                  @click="applyTheme('light')">
                  Light
                </button>
                <button class="theme-toggle" :class="{ active: settings.theme === 'dark' }" @click="applyTheme('dark')">
                  Dark
                </button>
                <button class="theme-toggle" :class="{ active: settings.theme === 'system' }"
                  @click="applyTheme('system')">
                  System
                </button>
              </div>
            </div>

            <!-- Font Size -->
            <div class="setting-item">
              <label class="section-label">Font Size</label>
              <div class="slider-container">
                <input type="range" min="30" max="100" v-model.number="settings.fontSize" class="slider" />
                <span class="slider-value">{{ settings.fontSize }}%</span>
              </div>
            </div>
          </div>

          <!-- Notifications Box -->
          <div class="settings-box">
            <h3 class="section-title">Notifications</h3>

            <div class="setting-item">
              <div class="toggle-row">
                <label class="section-label">Email updates</label>
                <div class="switch" @click="settings.emailUpdates = !settings.emailUpdates">
                  <div class="switch-track" :class="{ active: settings.emailUpdates }">
                    <div class="switch-thumb"></div>
                  </div>
                </div>
              </div>
            </div>

            <div class="setting-item">
              <div class="toggle-row">
                <label class="section-label">Sound notifications</label>
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
          <h3 class="section-title">Account Management</h3>

          <div class="account-management-grid">
            <!-- Row 1: Email & Password -->
            <div class="management-row">
              <div class="management-col">
                <label class="section-label">Email Address</label>
                <div class="input-with-button">
                  <input type="email" class="text-input" v-model="userData.email" :disabled="!isEditingEmail"
                    placeholder="Your email address" />
                  <button class="btn-secondary" @click="toggleEmailEdit" :disabled="isEmailUpdating">
                    {{ isEditingEmail ? 'Save' : 'Edit' }}
                  </button>
                </div>
                <p v-if="emailError" class="error-text">{{ emailError }}</p>
              </div>

              <div class="management-col">
                <label class="section-label">Password</label>
                <button class="btn-secondary full-width" @click="initiatePasswordChange">
                  Change Password
                </button>
              </div>
            </div>

            <!-- Row 2: Reset & Delete -->
            <div class="management-row">
              <div class="management-col">
                <button class="btn-secondary full-width" @click="confirmResetUserData">
                  Reset User Data
                </button>
                <p class="description-text">This will clear all your profile data and chat history.</p>
              </div>

              <div class="management-col">
                <button class="btn-danger full-width" @click="confirmDeleteAccount">
                  Delete Account
                </button>
                <p class="description-text danger-text">This will permanently delete your account and all associated
                  data.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Email Change Confirmation Modal -->
      <div class="modal" v-if="showEmailConfirmModal">
        <div class="modal-content">
          <h3 class="modal-title">Confirm Email Change</h3>

          <div class="modal-body">
            <p>Changing your email address to <strong>{{ newEmail }}</strong> will:</p>
            <ul>
              <li>Log you out of the system</li>
              <li>Send a verification link to your new email</li>
              <li>Require you to verify your new email before regaining access</li>
            </ul>

            <div class="form-group">
              <label for="confirmPassword">Enter your password to confirm:</label>
              <input v-model="emailChangePassword" type="password" id="confirmPassword"
                placeholder="Your current password" class="text-input" required />
              <p v-if="emailChangeError" class="error-text">{{ emailChangeError }}</p>
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn-close" @click="cancelEmailChange">
              Cancel
            </button>
            <button class="btn-save" @click="confirmEmailChange" :disabled="!emailChangePassword || isEmailUpdating">
              {{ isEmailUpdating ? 'Processing...' : 'Confirm Change' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Password Reset Initiate Dialog -->
      <div class="modal" v-if="showPasswordResetInitiate">
        <div class="modal-content password-reset-modal">
          <div class="logo">
            <div class="app-logo">
              <div class="vue-logo"></div>
            </div>
            <h1 class="app-name">App Name</h1>
          </div>

          <h2 class="password-reset-heading">Reset Password</h2>

          <div class="password-reset-form">
            <div class="form-group">
              <label for="currentPassword" class="form-label">Current Password</label>
              <input v-model="passwordReset.currentPassword" type="password" id="currentPassword"
                placeholder="Enter your current password" class="form-control" required />
              <p v-if="passwordReset.errors.current" class="error-message">{{ passwordReset.errors.current }}</p>
            </div>

            <button @click="handlePasswordResetInitiate" class="reset-button"
              :disabled="!passwordReset.currentPassword || passwordReset.isSubmitting">
              {{ passwordReset.isSubmitting ? 'Processing...' : 'Continue' }}
            </button>
          </div>

          <div class="modal-footer">
            <button class="btn-close" @click="cancelPasswordReset">
              Cancel
            </button>
          </div>
        </div>
      </div>

      <!-- Password Reset Confirm Dialog -->
      <div class="modal" v-if="showPasswordResetConfirm">
        <div class="modal-content password-reset-modal">
          <div class="logo">
            <div class="app-logo">
              <div class="vue-logo"></div>
            </div>
            <h1 class="app-name">App Name</h1>
          </div>

          <h2 class="password-reset-heading">Set New Password</h2>

          <div class="password-reset-form">
            <div class="form-group">
              <label for="newPassword" class="form-label">New Password</label>
              <input v-model="passwordReset.newPassword" type="password" id="newPassword"
                placeholder="Enter new password" class="form-control" required />
              <p v-if="passwordReset.errors.new" class="error-message">{{ passwordReset.errors.new }}</p>

              <!-- Password strength indicator -->
              <div v-if="passwordReset.newPassword && passwordStrength" class="password-strength-indicator">
                <div class="strength-label">
                  Password Strength:
                  <span :class="'strength-' + passwordStrength.score">
                    {{ getStrengthLabel(passwordStrength.score) }}
                  </span>
                </div>
                <div class="strength-bar-container">
                  <div class="strength-bar" :class="'strength-' + passwordStrength.score"
                    :style="{ width: (passwordStrength.score * 25) + '%' }"></div>
                </div>
              </div>
            </div>

            <div class="form-group">
              <label for="confirmPassword" class="form-label">Confirm New Password</label>
              <input v-model="passwordReset.confirmPassword" type="password" id="confirmPassword"
                placeholder="Confirm new password" class="form-control" required />
              <p v-if="passwordReset.errors.confirm" class="error-message">{{ passwordReset.errors.confirm }}</p>
            </div>

            <button @click="handlePasswordResetConfirm" class="reset-button"
              :disabled="!isPasswordValid() || passwordReset.isSubmitting">
              {{ passwordReset.isSubmitting ? 'Processing...' : 'Reset Password' }}
            </button>
          </div>

          <div class="modal-footer">
            <button class="btn-close" @click="cancelPasswordReset">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
// Import the user service
import userService from '@/services/userService';

export default {
  name: 'SettingsComponent',
  data() {
    return {
      // Data loading state
      isLoading: true,
      errorMessage: null,

      // Initialize with current app settings
      settings: {
        language: this.$i18n ? this.$i18n.locale : 'en',
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

      // Password Reset Flow
      showPasswordResetInitiate: false,
      showPasswordResetConfirm: false,
      passwordReset: {
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
        token: '',
        isSubmitting: false,
        errors: {
          current: '',
          new: '',
          confirm: ''
        }
      }
    }
  },
  computed: {
    // Calculate password strength
    passwordStrength() {
      if (!this.passwordReset.newPassword) {
        return null;
      }

      const password = this.passwordReset.newPassword;
      let score = 0;

      // Length check
      if (password.length >= 8) score += 1;

      // Contains uppercase
      if (/[A-Z]/.test(password)) score += 1;

      // Contains lowercase
      if (/[a-z]/.test(password)) score += 1;

      // Contains numbers
      if (/[0-9]/.test(password)) score += 1;

      // Contains special characters
      if (/[^A-Za-z0-9]/.test(password)) score += 1;

      // Adjust score to be between 0-4
      score = Math.min(score, 4);

      return {
        score,
        feedback: {
          suggestions: this.getPasswordSuggestions(password, score)
        }
      };
    }
  },
  created() {
    // Fetch user data when component is created
    this.fetchUserData();
  },
  methods: {
    // Fetch user data from the backend
    // In the settings component
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

        // Update component with user data
        this.userData = {
          name: userData.fullName || userData.loginName || userData.username || 'User',
          email: userData.email || '',
          accountType: userData.accountType || userData.role || 'Standard Account',
          userId: userData.id || userData.userId || userData._id,
          createdAt: userData.createdAt || ''
        };

        // Set avatar if available
        if (userData.avatarUrl) {
          this.userAvatar = userData.avatarUrl;
        }
      } catch (error) {
        console.error('Error fetching user data:', error);
        this.errorMessage = 'Unable to load user information. Please try again.';

        // Use any data we might already have
        const fallbackUser = userService.getCurrentUser();
        if (fallbackUser) {
          this.userData = {
            name: fallbackUser.fullName || fallbackUser.loginName || 'User',
            email: fallbackUser.email || '',
            accountType: fallbackUser.accountType || 'Account',
            userId: fallbackUser.id || '',
            createdAt: fallbackUser.createdAt || ''
          };
        }
      } finally {
        this.isLoading = false;
      }
    },

    // Apply theme immediately upon button click
    applyTheme(theme) {
      console.log('Theme button clicked:', theme);

      // Update local state
      this.settings.theme = theme;

      // Apply theme immediately to see the change
      document.documentElement.setAttribute('data-theme', theme);
      document.body.setAttribute('data-theme', theme);

      // Also save to localStorage immediately for instant persistence
      try {
        localStorage.setItem('theme', theme);
      } catch (e) {
        console.warn('Error saving theme:', e);
      }

      // Inform parent component about theme change
      this.$emit('themeChanged', theme);
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

    // Close without saving
    close() {
      this.$emit('close')
    },

    // Save settings and close
    save() {
      // Save language preference
      if (this.$i18n) {
        this.$i18n.locale = this.settings.language
        try {
          localStorage.setItem('userLocale', this.settings.language)
        } catch (e) {
          console.warn('Error saving language preference:', e)
        }
      }

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
        // Apply font size to root element
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

      // Emit theme change event to parent for global handling
      this.$emit('themeChanged', this.settings.theme);

      // Close dialog
      this.$emit('close')
    },

    // Show confirmation dialog before resetting user data
    confirmResetUserData() {
      if (confirm('Are you sure you want to reset all user data? This cannot be undone.')) {
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
        alert('User data has been reset.')
      } catch (e) {
        console.error('Error clearing user data:', e)
        alert('Failed to reset user data.')
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

    // Prepare email change with confirmation
    prepareEmailChange() {
      // Reset errors
      this.emailError = null;

      // Regular expression for validating email
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      // Validate email format
      if (!emailRegex.test(this.userData.email)) {
        this.emailError = 'Please enter a valid email address';
        return;
      }

      // If email hasn't changed, just exit edit mode
      if (this.userData.email === this.newEmail) {
        this.isEditingEmail = false;
        return;
      }

      // Store the new email for confirmation
      this.newEmail = this.userData.email;

      // Show confirmation modal
      this.showEmailConfirmModal = true;
    },

    // Cancel email change
    cancelEmailChange() {
      // Reset back to original email
      this.userData.email = this.newEmail;
      this.showEmailConfirmModal = false;
      this.isEditingEmail = false;
      this.emailChangePassword = '';
      this.emailChangeError = null;
    },

    // Confirm and process email change
    async confirmEmailChange() {
      if (!this.emailChangePassword) {
        this.emailChangeError = 'Please enter your password';
        return;
      }

      // Set updating state
      this.isEmailUpdating = true;
      this.emailChangeError = null;

      try {
        // Make sure we're sending the actual new email value and the password
        const response = await userService.updateEmail(
          this.userData.email,  // This should be the new email
          this.emailChangePassword
        );

        // Show success message
        alert('Please check your new email address for a verification link. You will now be logged out.');

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
        this.emailChangeError = 'Failed to update email. Please check your password and try again.';
      } finally {
        this.isEmailUpdating = false;
      }
    },

    // Delete account
    async deleteAccount() {
      try {
        // Show secondary confirmation with password
        const password = prompt('Please enter your password to confirm account deletion:');

        if (!password) {
          // User cancelled the prompt
          return;
        }

        // In a real implementation, call userService to deactivate the account
        await userService.deactivateAccount('User requested account deletion', password);

        // Show success message and redirect to logout
        alert('Your account has been deleted. You will be logged out.');

        // For demo purposes, just close the settings dialog
        this.$emit('close');
        // In a real implementation, redirect to logout
        // window.location.href = '/logout';
      } catch (error) {
        console.error('Error deleting account:', error);
        alert('Failed to delete account. Please verify your password and try again.');
      }
    },

    // Password Reset Methods

    // Initiate password change flow
    initiatePasswordChange() {
      // Reset form state
      this.passwordReset = {
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
        token: '',
        isSubmitting: false,
        errors: {
          current: '',
          new: '',
          confirm: ''
        }
      };

      // Show password reset initiate dialog
      this.showPasswordResetInitiate = true;
    },

    // Cancel password reset flow
    cancelPasswordReset() {
      this.showPasswordResetInitiate = false;
      this.showPasswordResetConfirm = false;

      // Reset form
      this.passwordReset = {
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
        token: '',
        isSubmitting: false,
        errors: {
          current: '',
          new: '',
          confirm: ''
        }
      };
    },

    // Handle first step of password reset
    async handlePasswordResetInitiate() {
      if (!this.passwordReset.currentPassword) {
        this.passwordReset.errors.current = 'Please enter your current password';
        return;
      }

      this.passwordReset.isSubmitting = true;
      this.passwordReset.errors.current = '';

      try {
        // In a real implementation, verify the current password with the backend
        // For this example, we'll simulate a successful verification

        // Proceed to the confirm step
        this.showPasswordResetInitiate = false;
        this.showPasswordResetConfirm = true;
      } catch (error) {
        console.error('Password verification failed:', error);
        this.passwordReset.errors.current = 'Incorrect password. Please try again.';
      } finally {
        this.passwordReset.isSubmitting = false;
      }
    },

    // Validate password
    isPasswordValid() {
      const { newPassword, confirmPassword } = this.passwordReset;

      // Reset errors
      this.passwordReset.errors.new = '';
      this.passwordReset.errors.confirm = '';

      // Make sure passwords are entered
      if (!newPassword || !confirmPassword) {
        return false;
      }

      // Check password strength (at least 3 out of 5 criteria)
      if (this.passwordStrength && this.passwordStrength.score < 3) {
        this.passwordReset.errors.new = 'Password is too weak. Please choose a stronger password.';
        return false;
      }

      // Check if passwords match
      if (newPassword !== confirmPassword) {
        this.passwordReset.errors.confirm = 'Passwords do not match';
        return false;
      }

      return true;
    },

    // Handle password reset confirmation
    async handlePasswordResetConfirm() {
      if (!this.isPasswordValid()) {
        return;
      }

      this.passwordReset.isSubmitting = true;

      try {
        // In a real implementation, call userService to change the password
        await userService.changePassword(
          this.passwordReset.currentPassword,
          this.passwordReset.newPassword
        );

        // Show success message
        alert('Your password has been successfully reset');

        // Close the password reset dialog
        this.showPasswordResetConfirm = false;
      } catch (error) {
        console.error('Password reset failed:', error);
        alert('Failed to reset password. Please try again.');
      } finally {
        this.passwordReset.isSubmitting = false;
      }
    },

    // Password strength helper methods
    getStrengthLabel(score) {
      const labels = [
        'Very Weak',
        'Weak',
        'Fair',
        'Good',
        'Strong'
      ];
      return labels[Math.min(score, 4)];
    },

    getPasswordSuggestions(password, score) {
      const suggestions = [];

      if (score < 4) {
        if (password.length < 8) {
          suggestions.push('Use at least 8 characters');
        }

        if (!/[A-Z]/.test(password)) {
          suggestions.push('Add uppercase letters');
        }

        if (!/[a-z]/.test(password)) {
          suggestions.push('Add lowercase letters');
        }

        if (!/[0-9]/.test(password)) {
          suggestions.push('Add numbers');
        }

        if (!/[^A-Za-z0-9]/.test(password)) {
          suggestions.push('Add special characters');
        }
      }

      return suggestions;
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
    height: auto;
    max-height: 90vh;
  }

  .settings-grid {
    grid-template-columns: 1fr;
  }

  .management-row {
    grid-template-columns: 1fr;
  }
}
</style>