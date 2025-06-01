<!-- src/components/PasswordResetInitiateScreen.vue -->
<template>
  <div class="password-reset-initiate-container" :class="{ 'embedded': isEmbedded }">
    <div class="password-reset-initiate-card">
      <div class="logo">
        <div class="app-logo">
          <div class="vue-logo"></div>
        </div>
        <h1 class="app-name">{{ $t('passwordReset.appTitle') }}</h1>
      </div>

      <h2 class="password-reset-initiate-heading" style="color: #fff !important;">{{ $t('passwordReset.resetPassword') }}</h2>

      <!-- Success message after submitting email -->
      <div v-if="resetRequested" class="success-message">
        <p>{{ $t('passwordReset.resetRequestSuccess') }}</p>
        <p>{{ $t('passwordReset.checkEmail', 'Please check your email for further instructions.') }}</p>
      </div>

      <!-- Email Form -->
      <form 
        v-else
        @submit.prevent="handleInitiateReset" 
        class="password-reset-initiate-form"
      >
        <!-- Force email label to always be visible by setting display -->
        <div class="form-group">
          <label for="email" class="form-label" style="display: block; color: #fff !important;">
            {{ $t('passwordReset.emailLabel') }}
          </label>
          <input 
            v-model="email" 
            type="email" 
            id="email"
            :placeholder="$t('passwordReset.emailPlaceholder')" 
            class="form-control" 
            required 
            @focus="emailError = ''"
          />
          <p v-if="emailError" class="error-message">{{ emailError }}</p>
        </div>

        <button 
          type="submit" 
          class="reset-initiate-button" 
          :disabled="isSubmitting || !isValidEmail"
        >
          <span v-if="isSubmitting" class="button-spinner"></span>
          {{ isSubmitting ? 
             $t('passwordReset.processing') : 
             $t('passwordReset.resetButton') }}
        </button>
      </form>

      <div class="login-link">
        <p>
          {{ $t('passwordReset.rememberPassword') }} 
          <router-link to="/login" class="login-link-text">
            {{ $t('passwordReset.backToLogin') }}
          </router-link>
        </p>
      </div>

      <div class="password-reset-initiate-footer">
        <p class="support-message">{{ $t('passwordReset.supportMessage') }}</p>
        <div class="language-selector">
          <select v-model="selectedLocale" @change="changeLocale">
            <option value="en">{{ $t('settings.languages.english') }}</option>
            <option value="fr">{{ $t('settings.languages.french') }}</option>
            <option value="sw">{{ $t('settings.languages.swahili') }}</option>
          </select>
        </div>
      </div>

      <!-- Cancel button for embedded mode -->
      <div v-if="isEmbedded" class="modal-footer">
        <button class="cancel-button" @click="cancelReset">
          {{ $t('common.cancel') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import passwordService from '@/services/passwordService';
import userService from '@/services/userService';

export default {
  name: 'PasswordResetInitiateScreen',
  props: {
    // Add a prop to determine if this component is embedded in another component
    isEmbedded: {
      type: Boolean,
      default: false
    },
    // Add a prop to pre-fill email when coming from settings
    prefilledEmail: {
      type: String,
      default: ''
    }
  },
  data() {
    return {
      // Component state
      email: this.prefilledEmail || '',
      emailError: '',
      isSubmitting: false,
      resetRequested: false,
      selectedLocale: this.$i18n ? this.$i18n.locale : 'en'
    }
  },
  computed: {
    // Simple email validation
    isValidEmail() {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emailRegex.test(this.email);
    }
  },
  created() {
    // If email is not provided via props and user is logged in, get it from userService
    this.setCurrentUserEmail();
    
    // Force debug log to verify translations loading
    if (this.$i18n) {
      console.log('Current locale:', this.$i18n.locale);
      console.log('Email label translation:', this.$t('passwordReset.emailLabel'));
    }
  },
  methods: {
    // Get currently logged in user's email if available
    async setCurrentUserEmail() {
      if (!this.email && this.isEmbedded) {
        try {
          const currentUser = await userService.getCurrentUserInfo();
          if (currentUser && currentUser.email) {
            this.email = currentUser.email;
          }
        } catch (error) {
          console.warn('Could not fetch current user email:', error);
        }
      }
    },
    
    async handleInitiateReset() {
      // Reset previous errors
      this.emailError = '';
      
      // Validate email
      if (!this.isValidEmail) {
        this.emailError = this.$t('passwordReset.invalidEmail');
        return;
      }

      // Set submitting state
      this.isSubmitting = true;

      try {
        // Call the API to initiate password reset
        const response = await passwordService.initiateReset(this.email);
        console.log('Password reset initiated successfully');

        // Handle success - even if user doesn't exist, we show success for security
        this.resetRequested = true;
        
        // If embedded, emit an event to notify the parent component after a delay
        if (this.isEmbedded) {
          setTimeout(() => {
            this.$emit('reset-initiated', this.email);
          }, 2000);
        }
      } catch (error) {
        console.error('Password reset initiation failed:', error);
        
        // For security, we don't want to reveal if the email exists or not
        // Always show success message, but log the error for debugging
        this.resetRequested = true;
        
        // If embedded, still emit event after delay
        if (this.isEmbedded) {
          setTimeout(() => {
            this.$emit('reset-initiated', this.email);
          }, 2000);
        }
      } finally {
        this.isSubmitting = false;
      }
    },

    // Cancel method for embedded mode
    cancelReset() {
      this.$emit('cancel');
    },

    changeLocale() {
      if (this.$i18n) {
        // Update locale using standard Vue I18n
        this.$i18n.locale = this.selectedLocale;
        
        // Save to localStorage
        try {
          localStorage.setItem('userLocale', this.selectedLocale);
        } catch (e) {
          console.warn('Error saving language preference:', e);
        }
      } else if (typeof this.$setLocale === 'function') {
        // Fallback to custom method if provided
        this.$setLocale(this.selectedLocale);
      }
    }
  }
}
</script>

<style scoped>
/* Styles for Password Reset Initiate Screen - Dark Mode by default */
.password-reset-initiate-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  min-height: calc(var(--vh, 1vh) * 100);
  background-color: #1c1c1c;
  padding: 16px;
  padding-top: env(safe-area-inset-top, 16px);
  padding-bottom: env(safe-area-inset-bottom, 16px);
  box-sizing: border-box;
}

/* When embedded in Settings, remove the background and adjust dimensions */
.password-reset-initiate-container.embedded {
  background-color: transparent;
  min-height: auto;
  max-height: none;
  padding: 0;
  margin: 0;
  width: 100%;
  height: 100%;
}

.password-reset-initiate-card {
  width: 100%;
  max-width: 400px;
  max-height: 95vh;
  background: #2d2d2d;
  border-radius: 16px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
  padding: 24px;
  color: #fff;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
}

/* When embedded, adjust card styling */
.embedded .password-reset-initiate-card {
  max-height: none;
  box-shadow: none;
}

.logo {
  text-align: center;
  margin-bottom: 16px;
}

.app-logo {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background-color: #4E97D1;
  margin-bottom: 10px;
}

.vue-logo {
  width: 0;
  height: 0;
  border-left: 12px solid transparent;
  border-right: 12px solid transparent;
  border-bottom: 20px solid #fff;
}

.app-name {
  font-size: 28px;
  color: #fff;
  margin: 0;
  font-weight: 500;
}

.password-reset-initiate-heading {
  text-align: center;
  font-size: 18px;
  margin-top: 0;
  margin-bottom: 20px;
  font-weight: 500;
  color: #fff !important; /* Ensure heading is white, not black */
}

.password-reset-initiate-container .password-reset-initiate-card .password-reset-initiate-heading {
  color: #fff !important;
}

.password-reset-initiate-form {
  margin-bottom: 16px;
}

.form-group {
  margin-bottom: 14px;
}

.form-label {
  display: block !important; /* Force display */
  margin-bottom: 6px;
  font-size: 14px;
  color: #eee !important; /* Force color */
  font-weight: 500;
}

.form-control {
  width: 100%;
  padding: 12px;
  font-size: 15px;
  border: none;
  border-radius: 8px;
  background-color: #f5f9fc;
  color: #333;
  transition: background-color 0.2s, box-shadow 0.2s;
}

.form-control:focus {
  outline: none;
  background-color: #fff;
  box-shadow: 0 0 0 2px rgba(78, 151, 209, 0.3);
}

.reset-initiate-button {
  width: 100%;
  padding: 12px;
  background-color: #4E97D1;
  color: white;
  font-size: 16px;
  font-weight: 600;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.2s;
  position: relative;
  margin-top: 8px;
}

.reset-initiate-button:hover:not(:disabled) {
  background-color: #4589c0;
}

.reset-initiate-button:disabled {
  background-color: #3a7da8;
  cursor: not-allowed;
  opacity: 0.7;
}

.button-spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  border-top-color: #fff;
  animation: spin 1s infinite linear;
  margin-right: 8px;
  vertical-align: middle;
}

.error-message {
  color: #ff6b6b;
  font-size: 12px;
  margin-top: 4px;
  margin-bottom: 0;
}

.success-message {
  background-color: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.3);
  border-radius: 8px;
  padding: 16px;
  text-align: center;
  margin-bottom: 16px;
}

.success-message p {
  margin: 8px 0;
  color: #4ade80;
}

.login-link {
  text-align: center;
  margin-top: 16px;
  font-size: 14px;
  color: #ddd;
}

.login-link-text {
  color: #4E97D1;
  text-decoration: none;
  cursor: pointer;
  font-weight: 500;
}

.login-link-text:hover {
  text-decoration: underline;
}

.password-reset-initiate-footer {
  margin-top: auto;
  padding-top: 10px;
  text-align: center;
  font-size: 11px;
  color: #aaa;
}

.language-selector {
  margin-top: 8px;
}

.language-selector select {
  padding: 8px 12px;
  border: 1px solid #444;
  border-radius: 8px;
  background-color: #333;
  color: #ddd;
  font-size: 13px;
  appearance: none;
  background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
  background-repeat: no-repeat;
  background-position: right 8px center;
  background-size: 14px;
  padding-right: 28px;
  cursor: pointer;
}

.language-selector select:focus {
  outline: none;
  border-color: #4E97D1;
}

/* Cancel button for embedded mode */
.modal-footer {
  text-align: center;
  margin-top: 16px;
}

.cancel-button {
  padding: 8px 16px;
  background-color: transparent;
  color: #4E97D1;
  font-size: 14px;
  font-weight: 500;
  border: 1px solid #4E97D1;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.cancel-button:hover {
  background-color: rgba(78, 151, 209, 0.1);
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Responsive adjustments */
@media (max-width: 480px) {
  .password-reset-initiate-card {
    padding: 20px 16px;
    max-height: 92vh;
  }
  
  .embedded .password-reset-initiate-card {
    max-height: none;
  }
}
</style>