<!-- src/components/LoginScreen.vue -->
<template>
  <div class="login-container" :data-theme="theme">
    <div class="login-card">
      <div class="logo">
        <div class="app-logo">
          <div class="vue-logo"></div>
        </div>
        <h1 class="app-name">{{ $t('login.appTitle') }}</h1>
      </div>
      
      <div v-if="error" class="error-message">
        {{ error }}
      </div>
      
      <form @submit.prevent="handleLogin" class="login-form">
        <div class="form-group">
          <input 
            v-model="username" 
            type="text" 
            :placeholder="$t('login.username')" 
            class="form-control"
            required
          />
        </div>
        
        <div class="form-group">
          <input 
            v-model="password" 
            type="password" 
            :placeholder="$t('login.password')" 
            class="form-control"
            required
          />
        </div>
        
        <div class="remember-forgot">
          <label class="remember-me">
            <input type="checkbox" v-model="rememberMe">
            <span>{{ $t('login.rememberMe') }}</span>
          </label>
          <a href="#" @click.prevent="goToForgotPassword" class="forgot-link">
            {{ $t('login.forgotPassword') }}
          </a>
        </div>
        
        <button type="submit" class="login-button" :disabled="isLoading">
          <span v-if="isLoading">{{ $t('login.loggingIn') }}</span>
          <span v-else>{{ $t('login.loginButton') }}</span>
        </button>
      </form>
      
      <!-- Fixed Register Account Link using router-link -->
      <div class="register-account">
        <p>{{ $t('login.noAccount') }} <router-link to="/register" class="register-link">{{ $t('login.registerNow') }}</router-link></p>
      </div>
      
      <div class="divider">
        <span class="divider-line"></span>
        <span class="divider-text">{{ $t('login.or') }}</span>
        <span class="divider-line"></span>
      </div>
      
      <div class="social-login">
        <button @click="handleGoogleLogin" class="social-button google-button" :disabled="isLoading">
          <div class="button-content">
            <svg class="social-icon" viewBox="0 0 24 24" width="18" height="18">
              <g transform="matrix(1, 0, 0, 1, 0, 0)">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </g>
            </svg>
            <span>Continue with Google</span>
          </div>
        </button>
        
        <button @click="handleFacebookLogin" class="social-button facebook-button" :disabled="isLoading">
          <div class="button-content">
            <svg class="social-icon" width="18" height="18" viewBox="0 0 24 24">
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" 
                  fill="#FFFFFF" />
            </svg>
            <span>Continue with Facebook</span>
          </div>
        </button>
      </div>
      
      <div v-if="savedAccounts.length > 0" class="saved-accounts">
        <h3>{{ $t('login.savedAccounts') }}</h3>
        <div class="accounts-container">
          <div 
            v-for="account in savedAccounts" 
            :key="account.id" 
            class="account-item"
            @click="loginWithSavedAccount(account)"
          >
            <div class="account-left">
              <div class="account-initials">{{ account.name.charAt(0) }}{{ account.name.split(' ')[1]?.charAt(0) || '' }}</div>
              <span class="account-name">{{ account.name }}</span>
            </div>
            
            <div class="account-provider">
              <template v-if="account.provider === 'Google'">
                <svg class="provider-icon" viewBox="0 0 24 24" width="16" height="16">
                  <g transform="matrix(1, 0, 0, 1, 0, 0)">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </g>
                </svg>
                <span>Google</span>
              </template>
              <template v-else-if="account.provider === 'Facebook'">
                <svg class="provider-icon" width="16" height="16" viewBox="0 0 24 24">
                  <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" 
                      fill="#1877F2" />
                </svg>
                <span>Facebook</span>
              </template>
              <template v-else>
                {{ account.provider }}
              </template>
            </div>
          </div>
        </div>
      </div>
      
      <div class="login-footer">
        <p class="terms-policy">By logging in, you agree to our Terms of Service and Privacy Policy</p>
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
import userService from '@/services/userService';

export default {
  name: 'LoginScreen',
  props: {
    theme: {
      type: String,
      default: 'light'
    }
  },
  data() {
    return {
      username: '',
      password: '',
      rememberMe: false,
      selectedLocale: this.$i18n.locale,
      isLoading: false,
      error: '',
      savedAccounts: [
        {
          id: 1,
          name: 'John Doe',
          provider: 'Google',
          email: 'john.doe@gmail.com'
        },
        {
          id: 2,
          name: 'Jane Smith',
          provider: 'Facebook',
          email: 'jane.smith@facebook.com'
        }
      ]
    }
  },
  created() {
    // Apply theme to document element to ensure it cascades properly
    document.documentElement.setAttribute('data-theme', this.theme);
    
    // Add viewport meta tag to ensure proper mobile rendering if not already present
    this.ensureViewportMeta();
    
    // Clear any previous error messages when navigating to login page
    this.error = '';
    
    // Check for redirect with error message
    if (this.$route.query.error) {
      this.error = this.$route.query.error;
    }
  },
  mounted() {
    // Fix for full-height issues on mobile browsers
    this.setMobileHeight();
    window.addEventListener('resize', this.setMobileHeight);
  },
  beforeUnmount() {
    window.removeEventListener('resize', this.setMobileHeight);
  },
  watch: {
    // Watch for theme changes from parent
    theme(newTheme) {
      document.documentElement.setAttribute('data-theme', newTheme);
    }
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
    
    // Navigate to forgot password page
    goToForgotPassword() {
      this.$router.push('/forgot-password');
    },
    
    async handleLogin() {
      try {
        // Clear any previous errors
        this.error = '';
        this.isLoading = true;
        
        // Validate inputs
        if (!this.username || !this.password) {
          this.error = this.$t('login.fieldsRequired');
          return;
        }
        
        // Call userService to authenticate
        const result = await userService.login(this.username, this.password);
        
        // Verify we got a valid response with access token
        if (!result || !result.accessToken) {
          this.error = this.$t('login.invalidCredentials');
          return;
        }
        
        // If remember me is checked, this is handled by userService storing in localStorage
        
        // Dispatch auth action to store
        this.$store.dispatch('initAuth');
        this.$store.commit('setUser', result);
        
        // Emit login success event
        this.$emit('login-success', result);
        
        // Navigate to home or dashboard or redirect URL if it exists
        const redirectPath = this.$route.query.redirect || '/';
        this.$router.push(redirectPath);
      } catch (error) {
        console.error('Login error:', error);
        
        // Handle specific error cases
        if (error.status === 401) {
          this.error = this.$t('login.invalidCredentials');
        } else if (error.status === 429) {
          this.error = this.$t('login.tooManyAttempts');
        } else {
          this.error = this.$t('login.loginFailed');
        }
      } finally {
        this.isLoading = false;
      }
    },
    
    async handleGoogleLogin() {
      try {
        this.error = '';
        this.isLoading = true;
        
        // This would normally call your OAuth implementation
        // For now, we'll just show a message that it's not implemented
        this.error = this.$t('login.oauthNotImplemented');
        
        // In a real implementation, you would:
        // 1. Call an OAuth service
        // 2. Get a token back
        // 3. Verify the token with your backend
        // 4. Get user info and auth token
        // 5. Store the token and proceed as with normal login
      } catch (error) {
        console.error('Google login error:', error);
        this.error = this.$t('login.loginFailed');
      } finally {
        this.isLoading = false;
      }
    },
    
    async handleFacebookLogin() {
      try {
        this.error = '';
        this.isLoading = true;
        
        // This would normally call your OAuth implementation
        // For now, we'll just show a message that it's not implemented
        this.error = this.$t('login.oauthNotImplemented');
      } catch (error) {
        console.error('Facebook login error:', error);
        this.error = this.$t('login.loginFailed');
      } finally {
        this.isLoading = false;
      }
    },
    
    async loginWithSavedAccount(account) {
      try {
        this.error = '';
        this.isLoading = true;
        
        // In a real implementation, you would:
        // 1. Look up the saved credentials securely
        // 2. Use them to authenticate
        
        // For now, we'll just show a message that it's not implemented
        this.error = this.$t('login.savedLoginNotImplemented');
      } catch (error) {
        console.error('Saved account login error:', error);
        this.error = this.$t('login.loginFailed');
      } finally {
        this.isLoading = false;
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
.login-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh; /* Fallback */
  min-height: calc(var(--vh, 1vh) * 100); /* Mobile viewport fix */
  background-color: #222;
  padding: 16px;
  /* Add safe area insets for notches and home indicators */
  padding-top: env(safe-area-inset-top, 16px);
  padding-bottom: env(safe-area-inset-bottom, 16px);
  box-sizing: border-box;
}

.login-card {
  width: 100%;
  max-width: 400px;
  max-height: 95vh; /* Prevent scrolling by limiting height */
  background: #333;
  border-radius: 16px; /* More rounded corners */
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
  padding: 24px 24px; /* Reduced padding */
  color: #fff;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
}

.error-message {
  background-color: rgba(255, 77, 77, 0.2);
  border: 1px solid rgba(255, 77, 77, 0.4);
  color: #ff4d4d;
  padding: 10px;
  margin-bottom: 16px;
  border-radius: 8px;
  font-size: 14px;
  text-align: center;
}

.logo {
  text-align: center;
  margin-bottom: 16px; /* Reduced margin */
}

.app-logo {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  width: 60px; /* Smaller logo */
  height: 60px;
  border-radius: 50%;
  background-color: #4E97D1;
  margin-bottom: 10px; /* Reduced margin */
}

.vue-logo {
  width: 0;
  height: 0;
  border-left: 12px solid transparent;
  border-right: 12px solid transparent;
  border-bottom: 20px solid #fff;
}

.app-name {
  font-size: 28px; /* Smaller font */
  color: #fff;
  margin: 0;
  font-weight: 500;
}

.login-form {
  margin-bottom: 16px; /* Reduced margin */
}

.form-group {
  margin-bottom: 10px; /* Reduced margin */
}

.form-control {
  width: 100%;
  padding: 10px 12px; /* Smaller padding */
  font-size: 15px; /* Smaller font */
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

.remember-forgot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px; /* Reduced margin */
  font-size: 13px; /* Smaller font */
}

.remember-me {
  display: flex;
  align-items: center;
  cursor: pointer;
  color: #ddd;
}

.remember-me input {
  margin-right: 5px;
}

.forgot-link {
  color: #4E97D1;
  text-decoration: none;
}

.forgot-link:hover {
  text-decoration: underline;
}

.login-button {
  width: 100%;
  padding: 10px; /* Reduced padding */
  background-color: #4E97D1;
  color: white;
  font-size: 15px; /* Smaller font */
  font-weight: bold;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.login-button:hover:not(:disabled) {
  background-color: #4589c0;
}

.login-button:disabled {
  background-color: #3a7da8;
  cursor: not-allowed;
  opacity: 0.7;
}

/* Added styles for registration link */
.register-account {
  text-align: center;
  margin-top: 12px;
  font-size: 14px;
}

.register-link {
  color: #4E97D1;
  text-decoration: none;
  cursor: pointer;
  font-weight: 500;
}

.register-link:hover {
  text-decoration: underline;
}

.divider {
  display: flex;
  align-items: center;
  margin: 14px 0; /* Reduced margin */
}

.divider-line {
  flex: 1;
  height: 1px;
  background-color: #555;
}

.divider-text {
  padding: 0 15px;
  color: #aaa;
  font-size: 13px; /* Smaller font */
}

.social-login {
  display: flex;
  flex-direction: column;
  gap: 8px; /* Reduced gap */
  margin: 14px 0; /* Reduced margin */
}

.social-button {
  display: flex;
  align-items: center;
  padding: 0;
  height: 36px; /* Reduced height */
  border-radius: 8px;
  font-size: 13px; /* Smaller font */
  cursor: pointer;
  transition: opacity 0.2s;
  overflow: hidden;
  border: none;
  text-align: left;
  font-weight: 500;
}

.social-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.button-content {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 0 14px; /* Reduced padding */
}

.social-icon {
  min-width: 18px;
  height: 18px;
  margin-right: 20px; /* Reduced margin */
  flex-shrink: 0;
}

.google-button {
  background-color: #4285F4;
  color: white;
}

.google-button:hover:not(:disabled) {
  opacity: 0.9;
}

.facebook-button {
  background-color: #1877F2;
  color: white;
}

.facebook-button:hover:not(:disabled) {
  opacity: 0.9;
}

.saved-accounts {
  margin-top: 16px; /* Reduced margin */
  border-top: 1px solid #444;
  padding-top: 14px; /* Reduced padding */
}

.saved-accounts h3 {
  font-size: 15px; /* Smaller font */
  color: #ddd;
  margin: 0 0 10px 0; /* Reduced margin */
  font-weight: 500;
}

.accounts-container {
  display: flex;
  flex-direction: column;
  gap: 8px; /* Reduced gap */
}

.account-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px; /* Reduced padding */
  border: 1px solid #444;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.2s;
  background-color: #2a2a2a;
}

.account-item:hover {
  background-color: #3a3a3a;
}

.account-left {
  display: flex;
  align-items: center;
}

.account-initials {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px; /* Smaller initials */
  height: 28px;
  border-radius: 50%;
  background-color: #4E97D1;
  color: white;
  font-weight: bold;
  margin-right: 10px; /* Reduced margin */
  font-size: 13px; /* Smaller font */
}

.account-name {
  font-weight: 500;
  color: #fff;
  font-size: 14px; /* Smaller font */
}

.account-provider {
  display: flex;
  align-items: center;
  padding: 3px 6px; /* Reduced padding */
  border-radius: 6px;
  font-size: 11px; /* Smaller font */
  color: #fff;
  background-color: rgba(255, 255, 255, 0.1);
}

.provider-icon {
  margin-right: 5px; /* Reduced margin */
  width: 14px; /* Smaller icon */
  height: 14px;
}

.login-footer {
  margin-top: auto; /* Push to bottom */
  padding-top: 10px;
  text-align: center;
  font-size: 11px; /* Smaller font */
  color: #aaa;
}

.terms-policy {
  margin-bottom: 10px; /* Reduced margin */
}

.language-selector {
  margin-top: 8px; /* Reduced margin */
}

.language-selector select {
  padding: 6px 12px; /* Reduced padding */
  border: 1px solid #444;
  border-radius: 8px;
  background-color: #222;
  color: #ddd;
  font-size: 13px; /* Smaller font */
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
  .login-card {
    padding: 20px 16px; /* Further reduced padding on small screens */
    max-height: 92vh; /* Allow a bit more space for scrolling if needed */
  }
  
  .app-logo {
    width: 50px;
    height: 50px;
  }
  
  .app-name {
    font-size: 24px;
  }
  
  /* Ensure the container doesn't force scrolling on small screens */
  .login-container {
    padding: 10px;
    overflow-y: hidden;
  }
}

/* For very tall phones - keep the same compact layout */
@media (min-height: 800px) {
  .login-card {
    padding: 24px;
    max-height: 760px; /* Limit height on very tall phones */
  }
}
</style>