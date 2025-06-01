<!-- src/components/RegistrationSuccessScreen.vue -->
<template>
  <div class="registration-success-container" :data-theme="theme">
    <div class="registration-success-card">
      <div class="logo">
        <div class="app-logo">
          <div class="vue-logo"></div>
        </div>
        <h1 class="app-name">{{ $t('register.appTitle') }}</h1>
      </div>

      <div class="success-icon">
        <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
          <polyline points="22 4 12 14.01 9 11.01"></polyline>
        </svg>
      </div>

      <h2 class="heading">{{ $t('register.registrationSuccess') }}</h2>
      
      <p class="message">{{ $t('register.verificationEmailSent', { email: email }) }}</p>
      <p class="sub-message">{{ $t('register.checkEmailInstructions') }}</p>

      <div class="actions">
        <button class="primary-button" @click="$router.push('/login')">
          {{ $t('register.backToLogin') }}
        </button>
      </div>

      <div class="footer">
        <p>{{ $t('register.noEmailReceived') }}</p>
        <button class="text-button" @click="resendVerification" :disabled="isResending">
          {{ isResending ? $t('register.resendingVerification') : $t('register.resendVerification') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import authService from '@/services/authService';

export default {
  name: 'RegistrationSuccessScreen',
  props: {
    theme: {
      type: String,
      default: 'light'
    }
  },
  data() {
    return {
      email: '',
      isResending: false
    }
  },
  created() {
    // Get email from route query
    this.email = this.$route.query.email || '';
    
    // Apply theme to document element
    document.documentElement.setAttribute('data-theme', this.theme);
    
    // Ensure viewport meta is set
    this.ensureViewportMeta();
    
    // Fix for mobile height issues
    this.setMobileHeight();
    window.addEventListener('resize', this.setMobileHeight);
  },
  beforeUnmount() {
    window.removeEventListener('resize', this.setMobileHeight);
  },
  methods: {
    // Fix for mobile viewport height issues (esp. on iOS)
    setMobileHeight() {
      // First we get the viewport height and multiply it by 1% to get a value for a vh unit
      const vh = window.innerHeight * 0.01;
      // Then we set the value in the --vh custom property to the root of the document
      document.documentElement.style.setProperty('--vh', `${vh}px`);
    },

    // Ensure the viewport meta tag exists
    ensureViewportMeta() {
      if (!document.querySelector('meta[name="viewport"]')) {
        const meta = document.createElement('meta');
        meta.name = 'viewport';
        meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
        document.getElementsByTagName('head')[0].appendChild(meta);
      }
    },
    
    async resendVerification() {
      if (this.isResending || !this.email) return;
      
      this.isResending = true;
      
      try {
        // Call auth service to resend verification email
        await authService.resendVerificationEmail(this.email);
        alert(this.$t('register.verificationResent'));
      } catch (error) {
        console.error('Error resending verification:', error);
        alert(this.$t('register.verificationResendFailed'));
      } finally {
        this.isResending = false;
      }
    }
  }
}
</script>

<style scoped>
.registration-success-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  /* Fallback */
  min-height: calc(var(--vh, 1vh) * 100);
  /* Mobile viewport fix */
  background-color: #222;
  padding: 16px;
  /* Add safe area insets for notches and home indicators */
  padding-top: env(safe-area-inset-top, 16px);
  padding-bottom: env(safe-area-inset-bottom, 16px);
  box-sizing: border-box;
}

.registration-success-card {
  width: 100%;
  max-width: 400px;
  background: #333;
  border-radius: 16px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
  padding: 24px;
  color: #fff;
  text-align: center;
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

.success-icon {
  color: #10b981;
  margin: 24px 0 16px;
}

.heading {
  font-size: 22px;
  margin-bottom: 16px;
  font-weight: 500;
}

.message {
  margin-bottom: 12px;
  font-size: 16px;
}

.sub-message {
  color: #aaa;
  margin-bottom: 24px;
  font-size: 14px;
}

.actions {
  margin-bottom: 24px;
}

.primary-button {
  background-color: #4E97D1;
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 16px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}

.primary-button:hover {
  background-color: #4589c0;
}

.footer {
  border-top: 1px solid #444;
  padding-top: 16px;
  font-size: 14px;
  color: #aaa;
}

.text-button {
  background: none;
  border: none;
  color: #4E97D1;
  font-size: 14px;
  cursor: pointer;
  padding: 4px 8px;
  margin-top: 4px;
}

.text-button:hover:not(:disabled) {
  text-decoration: underline;
}

.text-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Responsive adjustments */
@media (max-width: 480px) {
  .registration-success-card {
    padding: 20px 16px;
  }
}
</style>