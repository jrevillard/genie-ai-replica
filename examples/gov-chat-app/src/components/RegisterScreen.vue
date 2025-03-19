<!-- src/components/RegisterScreen.vue -->
<template>
    <div class="register-container" :data-theme="theme">
        <div class="register-card">
            <div class="logo">
                <div class="app-logo">
                    <div class="vue-logo"></div>
                </div>
                <h1 class="app-name">{{ $t('register.appTitle') }}</h1>
            </div>

            <h2 class="register-heading">{{ $t('register.createAccount') }}</h2>

            <form @submit.prevent="handleRegister" class="register-form">
                <div class="form-group">
                    <label for="username" class="form-label">{{ $t('register.username') }}</label>
                    <input v-model="username" type="text" id="username"
                        :placeholder="$t('register.usernamePlaceholder')" class="form-control" required />
                    <p v-if="usernameError" class="error-message">{{ usernameError }}</p>
                </div>

                <div class="form-group">
                    <label for="email" class="form-label">{{ $t('register.email') }}</label>
                    <input v-model="email" type="email" id="email" :placeholder="$t('register.emailPlaceholder')"
                        class="form-control" required />
                    <p v-if="emailError" class="error-message">{{ emailError }}</p>
                </div>

                <div class="form-group">
                    <label for="password" class="form-label">{{ $t('register.password') }}</label>
                    <input v-model="password" type="password" id="password"
                        :placeholder="$t('register.passwordPlaceholder')" class="form-control" required />
                    <p v-if="passwordError" class="error-message">{{ passwordError }}</p>
                </div>

                <div class="form-group">
                    <label for="confirmPassword" class="form-label">{{ $t('register.confirmPassword') }}</label>
                    <input v-model="confirmPassword" type="password" id="confirmPassword"
                        :placeholder="$t('register.confirmPasswordPlaceholder')" class="form-control" required />
                    <p v-if="confirmPasswordError" class="error-message">{{ confirmPasswordError }}</p>
                </div>

                <div class="terms-checkbox">
                    <label class="terms">
                        <input type="checkbox" v-model="acceptTerms" required>
                        <span>{{ $t('register.acceptTerms') }} <a href="#" class="terms-link">{{
                            $t('register.termsOfService') }}</a></span>
                    </label>
                    <p v-if="termsError" class="error-message">{{ termsError }}</p>
                </div>

                <button type="submit" class="register-button" :disabled="isSubmitting">
                    {{ isSubmitting ? $t('register.processing') : $t('register.registerButton') }}
                </button>
            </form>

            <div class="login-link">
                <p>{{ $t('register.alreadyHaveAccount') }} <a @click="goToLogin" class="login-link-text">{{
                    $t('register.loginNow') }}</a></p>
            </div>

            <div class="register-footer">
                <p class="terms-policy">{{ $t('register.privacyNotice') }}</p>
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
export default {
    name: 'RegisterScreen',
    props: {
        theme: {
            type: String,
            default: 'light'
        }
    },
    data() {
        return {
            username: '',
            email: '',
            password: '',
            confirmPassword: '',
            acceptTerms: false,
            selectedLocale: this.$i18n.locale,
            isSubmitting: false,
            // Form validation errors
            usernameError: '',
            emailError: '',
            passwordError: '',
            confirmPasswordError: '',
            termsError: ''
        }
    },
    created() {
        console.log('RegisterScreen component created')
        // Apply theme to document element to ensure it cascades properly
        document.documentElement.setAttribute('data-theme', this.theme);

        // Add viewport meta tag to ensure proper mobile rendering if not already present
        this.ensureViewportMeta();
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
        },
        // Clear validation errors when fields change
        username() {
            this.usernameError = '';
        },
        email() {
            this.emailError = '';
        },
        password() {
            this.passwordError = '';
            // Check confirm password match again if it was previously entered
            if (this.confirmPassword) {
                this.confirmPasswordError = this.password !== this.confirmPassword ?
                    this.$t('register.passwordsDoNotMatch') : '';
            }
        },
        confirmPassword() {
            this.confirmPasswordError = this.password !== this.confirmPassword ?
                this.$t('register.passwordsDoNotMatch') : '';
        },
        acceptTerms() {
            this.termsError = '';
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

        // Navigate to the login screen
        goToLogin() {
            this.$router.push('/login');
        },

        // Username validation - check for special characters and spaces
        validateUsername(username) {
            // Check for minimum length
            if (username.length < 3) {
                return this.$t('register.usernameMinLength');
            }
            
            // Check for invalid characters
            const validUsernameRegex = /^[a-zA-Z0-9_.-]+$/;
            if (!validUsernameRegex.test(username)) {
                return this.$t('register.usernameInvalidChars') || 'Username can only contain letters, numbers, underscores, dots and hyphens';
            }
            
            return '';
        },

        // Validate the form inputs
        validateForm() {
            let isValid = true;

            // Reset all error messages
            this.usernameError = '';
            this.emailError = '';
            this.passwordError = '';
            this.confirmPasswordError = '';
            this.termsError = '';

            // Username validation using our new method
            const usernameError = this.validateUsername(this.username);
            if (usernameError) {
                this.usernameError = usernameError;
                isValid = false;
            }

            // Email validation using a simple regex
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(this.email)) {
                this.emailError = this.$t('register.invalidEmail');
                isValid = false;
            }

            // Password validation (at least 8 characters with 1 number and 1 uppercase letter)
            const passwordRegex = /^(?=.*[A-Z])(?=.*\d).{8,}$/;
            if (!passwordRegex.test(this.password)) {
                this.passwordError = this.$t('register.passwordRequirements');
                isValid = false;
            }

            // Confirm password validation
            if (this.password !== this.confirmPassword) {
                this.confirmPasswordError = this.$t('register.passwordsDoNotMatch');
                isValid = false;
            }

            // Terms acceptance validation
            if (!this.acceptTerms) {
                this.termsError = this.$t('register.mustAcceptTerms');
                isValid = false;
            }

            return isValid;
        },

        async handleRegister() {
            // Validate form before submitting
            if (!this.validateForm()) {
                return;
            }

            // Set submitting state to show loading indicator
            this.isSubmitting = true;

            try {
                // Create user object with the required data for registration
                const userData = {
                    loginName: this.username,
                    email: this.email,
                    password: this.password,
                    // Optional field
                    fullName: this.fullName // If you have a fullName field in your form
                };

                // Call the auth service to register the user
                const response = await authService.register(userData);

                // Don't automatically log in - just redirect to verification page
                console.log('User registered successfully:', response);

                // Redirect to registration success page
                this.$router.push({
                    path: '/registration-success',
                    query: { email: this.email }
                });
            } catch (error) {
                console.error('Registration error:', error);

                // Handle specific error cases
                if (error.response) {
                    const { status, data } = error.response;

                    if (status === 409 || status === 400) {
                        // Check response data for specific error information
                        const errorMessage = data.message || '';
                        
                        // Check if the error is about username
                        if (errorMessage.toLowerCase().includes('username') || 
                            (data.field && data.field.toLowerCase() === 'username') ||
                            errorMessage.toLowerCase().includes('loginname')) {
                            this.usernameError = this.$t('register.usernameExists') || 'Username already exists';
                        } 
                        // Check if the error is about email
                        else if (errorMessage.toLowerCase().includes('email') || 
                                (data.field && data.field.toLowerCase() === 'email')) {
                            this.emailError = this.$t('register.emailExists') || 'Email already exists';
                        } 
                        // Generic conflict error
                        else {
                            alert(this.$t('register.registrationFailed') || 'Registration failed. Please try again.');
                        }
                    } else {
                        // Generic error handling for other status codes
                        alert(this.$t('register.registrationFailed') || 'Registration failed. Please try again.');
                    }
                } else {
                    // Network error or unexpected error
                    alert(this.$t('register.networkError') || 'Network error. Please check your connection and try again.');
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
.register-container {
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

.register-card {
    width: 100%;
    max-width: 400px;
    max-height: 95vh;
    /* Prevent scrolling by limiting height */
    background: #333;
    border-radius: 16px;
    /* More rounded corners */
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
    padding: 24px 24px;
    /* Reduced padding */
    color: #fff;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    /* Allow scrolling if content is too tall */
}

.logo {
    text-align: center;
    margin-bottom: 16px;
    /* Reduced margin */
}

.app-logo {
    display: inline-flex;
    justify-content: center;
    align-items: center;
    width: 60px;
    /* Smaller logo */
    height: 60px;
    border-radius: 50%;
    background-color: #4E97D1;
    margin-bottom: 10px;
    /* Reduced margin */
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
    /* Smaller font */
    color: #fff;
    margin: 0;
    font-weight: 500;
}

.register-heading {
    text-align: center;
    font-size: 18px;
    margin-top: 0;
    margin-bottom: 20px;
    font-weight: 500;
    color: #ddd;
}

.register-form {
    margin-bottom: 16px;
    /* Reduced margin */
}

.form-group {
    margin-bottom: 14px;
    /* Reduced margin */
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
    /* Smaller padding */
    font-size: 15px;
    /* Smaller font */
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

.error-message {
    color: #ff6b6b;
    font-size: 12px;
    margin-top: 4px;
    margin-bottom: 0;
}

.terms-checkbox {
    margin-bottom: 16px;
}

.terms {
    display: flex;
    align-items: flex-start;
    cursor: pointer;
    color: #ddd;
    font-size: 13px;
}

.terms input {
    margin-right: 8px;
    margin-top: 3px;
}

.terms-link {
    color: #4E97D1;
    text-decoration: none;
}

.terms-link:hover {
    text-decoration: underline;
}

.register-button {
    width: 100%;
    padding: 10px;
    /* Reduced padding */
    background-color: #4E97D1;
    color: white;
    font-size: 15px;
    /* Smaller font */
    font-weight: bold;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    transition: background-color 0.2s;
}

.register-button:hover:not(:disabled) {
    background-color: #4589c0;
}

.register-button:disabled {
    background-color: #3a7da8;
    cursor: not-allowed;
    opacity: 0.7;
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

.register-footer {
    margin-top: auto;
    /* Push to bottom */
    padding-top: 10px;
    text-align: center;
    font-size: 11px;
    /* Smaller font */
    color: #aaa;
}

.terms-policy {
    margin-bottom: 10px;
    /* Reduced margin */
}

.language-selector {
    margin-top: 8px;
    /* Reduced margin */
}

.language-selector select {
    padding: 6px 12px;
    /* Reduced padding */
    border: 1px solid #444;
    border-radius: 8px;
    background-color: #222;
    color: #ddd;
    font-size: 13px;
    /* Smaller font */
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
    .register-card {
        padding: 20px 16px;
        /* Further reduced padding on small screens */
        max-height: 92vh;
        /* Allow a bit more space for scrolling if needed */
    }

    .app-logo {
        width: 50px;
        height: 50px;
    }

    .app-name {
        font-size: 24px;
    }

    /* Ensure the container doesn't force scrolling on small screens */
    .register-container {
        padding: 10px;
    }
}

/* For very tall phones - keep the same compact layout */
@media (min-height: 800px) {
    .register-card {
        padding: 24px;
        max-height: 760px;
        /* Limit height on very tall phones */
    }
}
</style>