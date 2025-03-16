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
            <a href="#" class="forgot-link">{{ $t('login.forgotPassword') }}</a>
          </div>
          
          <button type="submit" class="login-button">
            {{ $t('login.loginButton') }}
          </button>
        </form>
        
        <div class="divider">
          <span class="divider-line"></span>
          <span class="divider-text">{{ $t('login.or') }}</span>
          <span class="divider-line"></span>
        </div>
        
        <div class="social-login">
          <button @click="handleGoogleLogin" class="social-button google-button">
            <div class="button-content">
              <svg class="social-icon" viewBox="0 0 24 24" width="20" height="20">
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
          
          <button @click="handleFacebookLogin" class="social-button facebook-button">
            <div class="button-content">
              <svg class="social-icon" width="20" height="20" viewBox="0 0 24 24">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" 
                    fill="#FFFFFF" />
              </svg>
              <span>Continue with Facebook</span>
            </div>
          </button>
        </div>
        
        <div v-if="savedAccounts.length > 0" class="saved-accounts">
          <h3>{{ $t('login.savedAccounts') }}</h3>
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
        
        <div class="login-footer">
          <p class="terms-policy">{{ $t('login.termsAndPolicy') }}</p>
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
    },
    watch: {
      // Watch for theme changes from parent
      theme(newTheme) {
        document.documentElement.setAttribute('data-theme', newTheme);
      }
    },
    methods: {
      handleLogin() {
        // Simulate login success with any credentials
        const userData = {
          name: this.username,
          email: `${this.username}@example.com`,
          id: Date.now(),
          isAuthenticated: true
        }
        
        this.loginSuccess(userData);
      },
      
      handleGoogleLogin() {
        // Normally this would open Google OAuth
        // For demo, we'll simulate successful login
        const userData = {
          name: 'Google User',
          email: 'user@gmail.com',
          provider: 'Google',
          id: Date.now(),
          isAuthenticated: true
        }
        
        this.loginSuccess(userData);
      },
      
      handleFacebookLogin() {
        // Normally this would open Facebook OAuth
        // For demo, we'll simulate successful login
        const userData = {
          name: 'Facebook User',
          email: 'user@facebook.com',
          provider: 'Facebook',
          id: Date.now(),
          isAuthenticated: true
        }
        
        this.loginSuccess(userData);
      },
      
      loginWithSavedAccount(account) {
        // Add authentication flag to account data
        const userData = {
          ...account,
          isAuthenticated: true
        }
        
        // Auto-login with saved account data
        this.loginSuccess(userData);
      },
      
      loginSuccess(userData) {
        // Store user data in localStorage if remember me is checked
        if (this.rememberMe) {
          try {
            localStorage.setItem('userData', JSON.stringify(userData));
          } catch (e) {
            console.warn('Unable to save user data:', e);
          }
        }
        
        // Dispatch auth action to store
        this.$store.dispatch('initAuth');
        this.$store.commit('setUser', userData);
        
        // Emit login success event
        this.$emit('login-success', userData);
        
        // Navigate to home or dashboard
        this.$router.push('/');
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
    min-height: 100vh;
    background-color: #222;
    padding: 20px;
  }
  
  .login-card {
    width: 100%;
    max-width: 400px;
    background: #333;
    border-radius: 8px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
    padding: 40px 30px;
    color: #fff;
  }
  
  .logo {
    text-align: center;
    margin-bottom: 30px;
  }
  
  .app-logo {
    display: inline-flex;
    justify-content: center;
    align-items: center;
    width: 70px;
    height: 70px;
    border-radius: 50%;
    background-color: #4E97D1;
    margin-bottom: 15px;
  }
  
  .vue-logo {
    width: 0;
    height: 0;
    border-left: 15px solid transparent;
    border-right: 15px solid transparent;
    border-bottom: 25px solid #fff;
  }
  
  .app-name {
    font-size: 32px;
    color: #fff;
    margin: 0;
    font-weight: 500;
  }
  
  .login-form {
    margin-bottom: 20px;
  }
  
  .form-group {
    margin-bottom: 15px;
  }
  
  .form-control {
    width: 100%;
    padding: 12px 15px;
    font-size: 16px;
    border: none;
    border-radius: 4px;
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
    margin-bottom: 20px;
    font-size: 14px;
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
    padding: 12px;
    background-color: #4E97D1;
    color: white;
    font-size: 16px;
    font-weight: bold;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: background-color 0.2s;
  }
  
  .login-button:hover {
    background-color: #4589c0;
  }
  
  .divider {
    display: flex;
    align-items: center;
    margin: 20px 0;
  }
  
  .divider-line {
    flex: 1;
    height: 1px;
    background-color: #555;
  }
  
  .divider-text {
    padding: 0 15px;
    color: #aaa;
    font-size: 14px;
  }
  
  .social-login {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 20px 0;
  }
  
  .social-button {
    display: flex;
    align-items: center;
    padding: 0;
    height: 40px;
    border-radius: 4px;
    font-size: 14px;
    cursor: pointer;
    transition: opacity 0.2s;
    overflow: hidden;
    border: none;
    text-align: left;
    font-weight: 500;
  }
  
  .button-content {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 0 16px;
  }
  
  .social-icon {
    min-width: 20px;
    height: 20px;
    margin-right: 24px;
    flex-shrink: 0;
  }
  
  .google-button {
    background-color: #4285F4;
    color: white;
  }
  
  .google-button:hover {
    opacity: 0.9;
  }
  
  .facebook-button {
    background-color: #1877F2;
    color: white;
  }
  
  .facebook-button:hover {
    opacity: 0.9;
  }
  
  .saved-accounts {
    margin-top: 30px;
    border-top: 1px solid #444;
    padding-top: 20px;
  }
  
  .saved-accounts h3 {
    font-size: 16px;
    color: #ddd;
    margin-top: 0;
    margin-bottom: 15px;
    font-weight: 500;
  }
  
  .account-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    border: 1px solid #444;
    border-radius: 4px;
    margin-bottom: 10px;
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
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background-color: #4E97D1;
    color: white;
    font-weight: bold;
    margin-right: 12px;
    font-size: 14px;
  }
  
  .account-name {
    font-weight: 500;
    color: #fff;
  }
  
  .account-provider {
    display: flex;
    align-items: center;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 12px;
    color: #fff;
    background-color: rgba(255, 255, 255, 0.1);
  }
  
  .provider-icon {
    margin-right: 6px;
  }
  
  .login-footer {
    margin-top: 25px;
    text-align: center;
    font-size: 12px;
    color: #aaa;
  }
  
  .terms-policy {
    margin-bottom: 15px;
  }
  
  .language-selector {
    margin-top: 15px;
  }
  
  .language-selector select {
    padding: 8px 15px;
    border: 1px solid #444;
    border-radius: 4px;
    background-color: #222;
    color: #ddd;
    font-size: 14px;
    appearance: none;
    background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
    background-repeat: no-repeat;
    background-position: right 10px center;
    background-size: 16px;
    padding-right: 30px;
    cursor: pointer;
  }
  
  .language-selector select:focus {
    outline: none;
    border-color: #4E97D1;
  }
  
  /* Responsive adjustments */
  @media (max-width: 480px) {
    .login-card {
      padding: 30px 20px;
    }
    
    .app-name {
      font-size: 28px;
    }
    
    .button-content {
      padding: 0 12px;
    }
    
    .social-icon {
      margin-right: 16px;
    }
  }
  </style>