<!-- src/components/PasswordResetInitiateScreen.vue -->
<template>
    <div class="password-reset-container" :data-theme="theme">
      <div class="password-reset-card">
        <div class="logo">
          <div class="app-logo">
            <div class="vue-logo"></div>
          </div>
          <h1 class="app-name">{{ $t('passwordReset.appTitle') }}</h1>
        </div>
  
        <h2 class="password-reset-heading">{{ $t('passwordReset.resetPassword') }}</h2>
  
        <form @submit.prevent="handlePasswordResetRequest" class="password-reset-form">
          <div class="form-group">
            <label for="email" class="form-label">{{ $t('passwordReset.emailLabel') }}</label>
            <input 
              v-model="email" 
              type="email" 
              id="email"
              :placeholder="$t('passwordReset.emailPlaceholder')" 
              class="form-control" 
              required 
            />
            <p v-if="emailError" class="error-message">{{ emailError }}</p>
          </div>
  
          <button 
            type="submit" 
            class="reset-button" 
            :disabled="isSubmitting"
          >
            {{ isSubmitting ? $t('passwordReset.processing') : $t('passwordReset.resetButton') }}
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
  
        <div class="password-reset-footer">
          <p class="terms-policy">{{ $t('passwordReset.supportMessage') }}</p>
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
  export default {
    name: 'PasswordResetInitiateScreen',
    props: {
      theme: {
        type: String,
        default: 'light'
      }
    },
    data() {
      return {
        email: '',
        emailError: '',
        isSubmitting: false,
        selectedLocale: this.$i18n.locale
      }
    },
    created() {
      // Apply theme to document element
      document.documentElement.setAttribute('data-theme', this.theme);
    },
    methods: {
      async handlePasswordResetRequest() {
        // Reset previous error
        this.emailError = '';
  
        // Basic email validation
        if (!this.validateEmail(this.email)) {
          this.emailError = this.$t('passwordReset.invalidEmail');
          return;
        }
  
        // Set submitting state
        this.isSubmitting = true;
  
        try {
          // Simulate password reset request 
          // In a real app, this would be an API call to your backend
          await new Promise(resolve => setTimeout(resolve, 1500));
  
          // Show success message
          alert(this.$t('passwordReset.resetRequestSuccess'));
  
          // Navigate to login or show success message
          this.$router.push('/login');
        } catch (error) {
          console.error('Password reset request failed:', error);
          
          // Show error to user
          this.emailError = this.$t('passwordReset.resetRequestFailed');
        } finally {
          this.isSubmitting = false;
        }
      },
  
      validateEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
      },
  
      changeLocale() {
        // Update locale using your global method
        this.$setLocale(this.selectedLocale);
      }
    }
  }
  </script>
  
  <style scoped>
  /* Reuse styles from LoginScreen.vue with minor modifications */
  .password-reset-container {
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
  
  .password-reset-card {
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
  
  .password-reset-heading {
    text-align: center;
    font-size: 18px;
    margin-top: 0;
    margin-bottom: 20px;
    font-weight: 500;
    color: #ddd;
  }
  
  .password-reset-form {
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
  
  .reset-button {
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
  
  .reset-button:hover:not(:disabled) {
    background-color: #4589c0;
  }
  
  .reset-button:disabled {
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
  
  .password-reset-footer {
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
    .password-reset-card {
      padding: 20px 16px;
      max-height: 92vh;
    }
  }
  </style>