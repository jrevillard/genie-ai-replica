<!-- src/components/EmailVerificationScreen.vue -->
<template>
  <div class="verify-container" :data-theme="theme">
    <div class="verify-card">
      <div class="logo">
        <div class="app-logo">
          <div class="vue-logo"></div>
        </div>
        <h1 class="app-name">{{ $t('register.appTitle') }}</h1>
      </div>

      <div v-if="isLoading" class="loading-state">
        <div class="spinner"></div>
        <p>{{ $t('verification.verifying') }}</p>
      </div>

      <template v-else-if="isVerified">
        <div class="success-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>
        </div>
        <h2 class="heading">{{ $t('verification.success') }}</h2>
        <p class="message">{{ $t('verification.accountVerified') }}</p>
        <div class="actions">
          <button class="primary-button" @click="$router.push('/login')">
            {{ $t('verification.proceedToLogin') }}
          </button>
        </div>
      </template>

      <template v-else>
        <div class="error-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="15" y1="9" x2="9" y2="15"></line>
            <line x1="9" y1="9" x2="15" y2="15"></line>
          </svg>
        </div>
        <h2 class="heading">{{ $t('verification.failed') }}</h2>
        <p class="message">{{ errorMessage || $t('verification.invalidLink') }}</p>
        <div class="actions">
          <button class="primary-button" @click="$router.push('/login')">
            {{ $t('verification.backToLogin') }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<script>
import authService from '@/services/authService';

export default {
  name: 'EmailVerificationScreen',
  props: {
    token: {
      type: String,
      required: true
    },
    theme: {
      type: String,
      default: 'light'
    }
  },
  data() {
    return {
      isLoading: true,
      isVerified: false,
      errorMessage: ''
    }
  },
  created() {
    // Apply theme to document element
    document.documentElement.setAttribute('data-theme', this.theme);
    
    // Ensure viewport meta is set
    this.ensureViewportMeta();
    
    // Fix for mobile height issues
    this.setMobileHeight();
    window.addEventListener('resize', this.setMobileHeight);
    
    // Verify the email token
    this.verifyEmail();
  },
  beforeUnmount() {
    window.removeEventListener('resize', this.setMobileHeight);
  },
  methods: {
    // Fix for mobile viewport height issues (esp. on iOS)
    setMobileHeight() {
      const vh = window.innerHeight * 0.01;
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
    
    async verifyEmail() {
      if (!this.token) {
        this.isLoading = false;
        this.errorMessage = this.$t('verification.missingToken');
        return;
      }
      
      try {
        // Call the auth service to verify the email
        await authService.verifyEmail(this.token);
        this.isVerified = true;
      } catch (error) {
        console.error('Email verification error:', error);
        if (error.response && error.response.data && error.response.data.message) {
          this.errorMessage = error.response.data.message;
        } else {
          this.errorMessage = this.$t('verification.generalError');
        }
      } finally {
        this.isLoading = false;
      }
    }
  }
}
</script>

<style scoped>
.verify-container {
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

.verify-card {
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
  margin-bottom: 20px;
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

.loading-state {
  margin: 30px 0;
  text-align: center;
}

.spinner {
  display: inline-block;
  width: 40px;
  height: 40px;
  border: 3px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  border-top-color: #4E97D1;
  animation: spin 1s ease-in-out infinite;
  margin-bottom: 16px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.success-icon {
  color: #10b981;
  margin: 24px 0 16px;
}

.error-icon {
  color: #ef4444;
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

.actions {
  margin: 24px 0;
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

/* Responsive adjustments */
@media (max-width: 480px) {
  .verify-card {
    padding: 20px 16px;
  }
}
</style>