<!-- src/components/PasswordResetConfirmScreen.vue -->
<template>
  <div class="password-reset-confirm-container" :data-theme="theme">
    <div class="password-reset-confirm-card">
      <div class="logo">
        <div class="app-logo">
          <div class="vue-logo"></div>
        </div>
        <h1 class="app-name">{{ $t('passwordResetConfirm.appTitle') }}</h1>
      </div>

      <h2 class="password-reset-confirm-heading">{{ $t('passwordResetConfirm.resetPassword') }}</h2>

      <!-- Success message after password reset -->
      <div v-if="resetSuccess" class="success-message">
        <p>{{ $t('passwordResetConfirm.resetSuccess') }}</p>
        <p>{{ $t('passwordResetConfirm.redirecting') }}</p>
      </div>

      <!-- Token Validation Section -->
      <div v-else-if="!isTokenValidated" class="token-validation-form">
        <!-- Show if token needs to be entered manually -->
        <div v-if="!isValidatingToken" class="form-group">
          <label for="resetToken" class="form-label">{{ $t('passwordResetConfirm.tokenLabel') }}</label>
          <input 
            v-model="manualToken" 
            type="text" 
            id="resetToken"
            :placeholder="$t('passwordResetConfirm.tokenPlaceholder')" 
            class="form-control"
            required
          />
          <p v-if="tokenError" class="error-message">{{ tokenError }}</p>
        </div>
        
        <!-- Loading state while validating token -->
        <div v-else class="loading-state">
          <div class="loading-spinner"></div>
          <p>{{ $t('passwordResetConfirm.validatingToken') }}</p>
        </div>
        
        <button 
          v-if="!isValidatingToken"
          @click="validateToken" 
          class="validate-token-button"
          :disabled="!manualToken || isValidatingToken"
        >
          {{ $t('passwordResetConfirm.validateButton') }}
        </button>
      </div>

      <!-- Password Reset Form -->
      <form 
        v-else-if="!resetSuccess"
        @submit.prevent="handlePasswordReset" 
        class="password-reset-confirm-form"
      >
        <div class="form-group">
          <label for="newPassword" class="form-label">
            {{ $t('passwordResetConfirm.newPasswordLabel') }}
          </label>
          <input 
            v-model="newPassword" 
            type="password" 
            id="newPassword"
            :placeholder="$t('passwordResetConfirm.newPasswordPlaceholder')" 
            class="form-control" 
            required 
          />
          <p v-if="newPasswordError" class="error-message">{{ newPasswordError }}</p>
        </div>

        <div class="form-group">
          <label for="confirmNewPassword" class="form-label">
            {{ $t('passwordResetConfirm.confirmNewPasswordLabel') }}
          </label>
          <input 
            v-model="confirmNewPassword" 
            type="password" 
            id="confirmNewPassword"
            :placeholder="$t('passwordResetConfirm.confirmNewPasswordPlaceholder')" 
            class="form-control" 
            required 
          />
          <p v-if="confirmNewPasswordError" class="error-message">{{ confirmNewPasswordError }}</p>
        </div>

        <button 
          type="submit" 
          class="reset-confirm-button" 
          :disabled="isSubmitting"
        >
          {{ isSubmitting ? $t('passwordResetConfirm.processing') : $t('passwordResetConfirm.resetButton') }}
        </button>
      </form>

      <div class="login-link">
        <p>
          {{ $t('passwordResetConfirm.rememberedPassword') }} 
          <router-link to="/login" class="login-link-text">
            {{ $t('passwordResetConfirm.backToLogin') }}
          </router-link>
        </p>
      </div>

      <div class="password-reset-confirm-footer">
        <p class="terms-policy">{{ $t('passwordResetConfirm.supportMessage') }}</p>
        <div class="language-selector">
          <select v-model="selectedLocale" @change="changeLocale">
            <option value="en">English</option>
            <option value="fr">Français</option>
            <option value="sw">Kiswahili</option>
          </select>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import authService from '@/services/authService';
import passwordService from '@/services/passwordService';

export default {
  name: 'PasswordResetConfirmScreen',
  props: {
    theme: {
      type: String,
      default: 'light'
    },
    // Optional token passed from route
    token: {
      type: String,
      default: ''
    },
    // Allow selection of service to use
    usePasswordService: {
      type: Boolean,
      default: false
    }
  },
  data() {
    return {
      // Predefined test tokens for development
      TEST_TOKENS: {
        valid: 'dev_reset_token_2023',
        expired: 'expired_reset_token',
        invalid: 'invalid_reset_token'
      },
      
      // Component state
      manualToken: this.token || '',
      isTokenValidated: false,
      isValidatingToken: false,
      tokenError: '',
      
      newPassword: '',
      confirmNewPassword: '',
      newPasswordError: '',
      confirmNewPasswordError: '',
      isSubmitting: false,
      resetSuccess: false,
      selectedLocale: this.$i18n.locale
    }
  },
  created() {
    // Apply theme to document element
    document.documentElement.setAttribute('data-theme', this.theme);

    // Auto-validate if token is provided via route
    if (this.token) {
      this.validateToken();
    }
  },
  methods: {
    async validateToken() {
      // Reset previous errors
      this.tokenError = '';
      this.isValidatingToken = true;

      // Get token from input or route prop
      const token = this.manualToken || this.token;

      if (!token) {
        this.tokenError = this.$t('passwordResetConfirm.noTokenProvided');
        this.isValidatingToken = false;
        return;
      }

      try {
        // For testing environment - simulate API responses with predefined tokens
        if (process.env.NODE_ENV === 'development' && token === this.TEST_TOKENS.valid) {
          // Simulate network delay
          await new Promise(resolve => setTimeout(resolve, 800));
          this.isTokenValidated = true;
          this.isValidatingToken = false;
          return;
        } 
        
        if (process.env.NODE_ENV === 'development' && token === this.TEST_TOKENS.expired) {
          // Simulate network delay
          await new Promise(resolve => setTimeout(resolve, 800));
          this.tokenError = this.$t('passwordResetConfirm.expiredToken');
          this.isValidatingToken = false;
          return;
        }

        // Call actual service for token validation
        const service = this.usePasswordService ? passwordService : authService;
        let response;
        
        if (this.usePasswordService) {
          response = await passwordService.validateToken(token);
        } else {
          response = await authService.validateResetToken(token);
        }

        // Check response
        if (response && response.valid) {
          this.isTokenValidated = true;
        } else {
          // Handle specific error cases if the API provides them
          if (response.expired) {
            this.tokenError = this.$t('passwordResetConfirm.expiredToken');
          } else if (response.used) {
            this.tokenError = this.$t('passwordResetConfirm.usedToken');
          } else {
            this.tokenError = this.$t('passwordResetConfirm.invalidToken');
          }
        }
      } catch (error) {
        console.error('Token validation error:', error);
        this.tokenError = this.$t('passwordResetConfirm.validationError');
      } finally {
        this.isValidatingToken = false;
      }
    },

    validatePasswords() {
      // Reset previous errors
      this.newPasswordError = '';
      this.confirmNewPasswordError = '';

      // Password complexity validation
      const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

      if (!passwordRegex.test(this.newPassword)) {
        this.newPasswordError = this.$t('passwordResetConfirm.passwordRequirements');
        return false;
      }

      if (this.newPassword !== this.confirmNewPassword) {
        this.confirmNewPasswordError = this.$t('passwordResetConfirm.passwordsDoNotMatch');
        return false;
      }

      return true;
    },

    async handlePasswordReset() {
      // Validate passwords
      if (!this.validatePasswords()) {
        return;
      }

      // Set submitting state
      this.isSubmitting = true;

      try {
        const token = this.manualToken || this.token;
        const service = this.usePasswordService ? passwordService : authService;
        
        // For testing environment
        if (process.env.NODE_ENV === 'development' && token === this.TEST_TOKENS.valid) {
          // Simulate API call
          await new Promise(resolve => setTimeout(resolve, 1500));
          
          // Show success message and redirect after delay
          this.resetSuccess = true;
          
          setTimeout(() => {
            this.$router.push('/login');
          }, 3000);
          
          return;
        }
        
        // Call the actual service
        let response;
        
        if (this.usePasswordService) {
          response = await passwordService.resetPassword(token, this.newPassword);
        } else {
          response = await authService.resetPassword(token, this.newPassword);
        }

        // Handle success
        if (response && response.success) {
          this.resetSuccess = true;
          
          // Redirect to login after a delay
          setTimeout(() => {
            this.$router.push('/login');
          }, 3000);
        } else {
          // Handle unexpected response format
          throw new Error('Invalid response format');
        }
      } catch (error) {
        console.error('Password reset failed:', error);
        
        // Handle specific error cases
        if (error.response && error.response.status === 410) {
          this.tokenError = this.$t('passwordResetConfirm.expiredToken');
          this.isTokenValidated = false;
        } else if (error.response && error.response.status === 409) {
          this.tokenError = this.$t('passwordResetConfirm.usedToken');
          this.isTokenValidated = false;
        } else {
          // Generic error
          alert(this.$t('passwordResetConfirm.resetFailed'));
        }
      } finally {
        this.isSubmitting = false;
      }
    },

    changeLocale() {
      // Update locale using your global method
      this.$setLocale(this.selectedLocale);
    }
  }
}
</script>

<style scoped>
/* Styles from LoginScreen.vue */
.password-reset-confirm-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  min-height: calc(var(--vh, 1vh) * 100);
  background-color: #222;
  padding: 16px;
  padding-top: env(safe-area-inset-top, 16px);
  padding-bottom: env(safe-area-inset-bottom, 16px);
  box-sizing: border-box;
}

.password-reset-confirm-card {
  width: 100%;
  max-width: 400px;
  max-height: 95vh;
  background: #333;
  border-radius: 16px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
  padding: 24px;
  color: #fff;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
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

.password-reset-confirm-heading {
  text-align: center;
  font-size: 18px;
  margin-top: 0;
  margin-bottom: 20px;
  font-weight: 500;
  color: #ddd;
}

.token-validation-form,
.password-reset-confirm-form {
  margin-bottom: 16px;
}

.form-group {
  margin-bottom: 14px;
}

.form-label {
  display: block;
  margin-bottom: 6px;
  font-size: 14px;
  color: #ddd;
  font-weight: 500;
}

.form-control {
  width: 100%;
  padding: 10px 12px;
  font-size: 15px;
  border: none;
  border-radius: 8px;
  background-color: #222;
  color: #fff;
  transition: background-color 0.2s;
}

.form-control:focus {
  outline: none;
  background-color: #2a2a2a;
}

.validate-token-button,
.reset-confirm-button {
  width: 100%;
  padding: 10px;
  background-color: #4E97D1;
  color: white;
  font-size: 15px;
  font-weight: bold;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.validate-token-button:hover:not(:disabled),
.reset-confirm-button:hover:not(:disabled) {
  background-color: #4589c0;
}

.validate-token-button:disabled,
.reset-confirm-button:disabled {
  background-color: #3a7da8;
  cursor: not-allowed;
  opacity: 0.7;
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

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px 0;
}

.loading-spinner {
  width: 30px;
  height: 30px;
  border: 3px solid rgba(255, 255, 255, 0.2);
  border-radius: 50%;
  border-top-color: #4E97D1;
  animation: spin 1s ease-in-out infinite;
  margin-bottom: 12px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.login-link {
  text-align: center;
  margin-top: 16px;
  font-size: 14px;
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

.password-reset-confirm-footer {
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
  padding: 6px 12px;
  border: 1px solid #444;
  border-radius: 8px;
  background-color: #222;
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

/* Responsive adjustments */
@media (max-width: 480px) {
  .password-reset-confirm-card {
    padding: 20px 16px;
    max-height: 92vh;
  }
}
</style>