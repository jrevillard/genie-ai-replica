<template>
  <div class="login-container">
    <main class="login-card">
      <!-- Brand mark in the Keletso hero circle (same treatment as the
           pending screen's seedling). -->
      <div class="login-hero" aria-hidden="true">
        <img
          v-if="logoVisible"
          :src="$config.app.icon.value"
          :alt="$config.app.title"
          class="hero-logo"
          @error="logoVisible = false"
        />
        <svg v-else viewBox="0 0 24 24" width="38" height="38" fill="none" stroke="currentColor"
          stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 20.5v-8"></path>
          <path d="M12 14.5c-4 0-6.2-2.6-6.2-6.2 3.7 0 6.2 2.2 6.2 6.2z"></path>
          <path d="M12 11.5c0-3.7 2.6-6.2 6.2-6.2 0 3.6-2.2 6.2-6.2 6.2z"></path>
          <path d="M7.5 20.5h9"></path>
        </svg>
      </div>

      <p class="login-eyebrow">{{ tOr('login.eyebrow', 'Lumela · Welcome') }}</p>
      <h1 class="login-title">{{ tOr('login.title', 'Sign in to Agrivisory') }}</h1>

      <p class="login-message">
        {{ tOr('login.message', 'Ask about crops, soil, pests and weather. Sign in to get started.') }}
      </p>

      <div v-if="error" class="login-error" role="alert">{{ error }}</div>

      <div class="login-actions">
        <!-- S-1 law: credentials live ONLY on Keycloak's hosted page — this
             button performs the same signinRedirect the router guard uses. -->
        <button type="button" class="action-primary" :disabled="isRedirecting" @click="login">
          <span v-if="isRedirecting" class="btn-spinner" aria-hidden="true"></span>
          {{ isRedirecting ? tOr('login.redirecting', 'Redirecting…') : tOr('login.signIn', 'Sign in') }}
        </button>

        <a
          v-if="registerUrl"
          :href="registerUrl"
          class="action-secondary action-link"
        >{{ tOr('login.createAccount', 'Create an account') }}</a>
      </div>

      <p class="login-footer">
        {{ tOr('login.footer', 'Answers are general guidance. For serious crop or animal health problems, also contact your local extension officer.') }}
      </p>

    </main>
  </div>
</template>

<script>
import keycloakAuthService from '@/services/keycloakAuthService';
import oidcConfig from '@/config/oidcConfig';

// Same offered-locale set as the pending screen — the two doors speak alike.

export default {
  name: 'LoginScreen',
  props: {
    theme: {
      type: String,
      default: 'light'
    },
    returnUrl: {
      type: String,
      default: ''
    }
  },
  data() {
    return {
      logoVisible: true,
      isRedirecting: false,
      error: '',
      // Keycloak-hosted registration (realm-gated; DEC-3). Built via
      // createSigninRequest so the return trip carries state + PKCE — a bare
      // /registrations URL dead-ends /callback in oidc-client-ts' state check.
      registerUrl: ''
    };
  },
  computed: {
  },
  mounted() {
    // M.20: landing is English-only (Adem) — force en for this screen.
    // The saved app preference (userLocale) is restored on unmount so
    // in-app language choice is untouched.
    if (this.$i18n) this.$i18n.locale = 'en';
    this.buildRegisterUrl();
  },
  beforeUnmount() {
    const saved = localStorage.getItem('userLocale');
    if (this.$i18n && saved && this.$i18n.locale !== saved) {
      this.$i18n.locale = saved;
    }
  },
  methods: {
    tOr(key, fallback) {
      const translated = this.$t(key);
      return translated && translated !== key ? translated : fallback;
    },
    async buildRegisterUrl() {
      try {
        const manager = keycloakAuthService.getUserManager();
        const request = await manager.createSigninRequest({
          redirect_uri: oidcConfig.redirect_uri,
          scope: oidcConfig.scope
        });
        // oidc-client-ts has no createRegistrationRequest — reuse the full
        // state+PKCE sign-in request and swap the endpoint segment.
        this.registerUrl = request.url.replace(
          '/protocol/openid-connect/auth?',
          '/protocol/openid-connect/registrations?'
        );
      } catch (e) {
        // Link stays hidden rather than shipping a dead-end URL.
        this.registerUrl = '';
      }
    },
    async login() {
      if (this.isRedirecting) return;
      this.isRedirecting = true;
      this.error = '';
      try {
        await keycloakAuthService.login(
          this.returnUrl ? { returnUrl: this.returnUrl } : undefined
        );
        // signinRedirect resolves once the browser starts navigating away —
        // success; the page unloads. A rejection = client-side failure only.
      } catch (e) {
        this.isRedirecting = false;
        this.error = this.tOr('login.redirectFailed', 'Sign-in is unavailable. Please try again.');
      }
    }
  }
};
</script>

<style scoped>
/*
 * AgriConnect LSO / Keletso style — same tokens and card treatment as the
 * pending-approval screen (field green, maize amber, soil-tinted neutrals),
 * so the sign-in door and the waiting door read as one product. Every
 * text/background pair meets WCAG AA in light and dark.
 */
.login-container {
  --pa-bg-top: #f2f6f0;
  --pa-bg-bottom: #e3ece0;
  --pa-card: #ffffff;
  --pa-surface: #f3f7f2;
  --pa-border: #d8e3d5;
  --pa-ink: #1c2a21;
  --pa-muted: #4f5f54;
  --pa-green: #3f7f52;
  --pa-green-hover: #2f6b3f;
  --pa-green-soft: #e2efe5;
  --pa-green-text: #2f6b3f;
  --pa-maize: #d99a1e;
  --pa-maize-text: #7a4e00;
  --pa-on-green: #ffffff;
  --pa-shadow: 0 1px 2px rgba(20, 40, 25, 0.05), 0 18px 44px -14px rgba(20, 40, 25, 0.22);

  position: fixed;
  inset: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  display: flex;
  padding: 1.5rem;
  background: linear-gradient(175deg, var(--pa-bg-top), var(--pa-bg-bottom));
  color: var(--pa-ink);
  font-family: inherit;
}

:global(html[data-theme="dark"]) .login-container {
  --pa-bg-top: #101612;
  --pa-bg-bottom: #18221c;
  --pa-card: #1a231e;
  --pa-surface: #222d26;
  --pa-border: #304036;
  --pa-ink: #eef3ef;
  --pa-muted: #b3c1b7;
  --pa-green: #3f7f52;
  --pa-green-hover: #2f6b3f;
  --pa-green-soft: #22392b;
  --pa-green-text: #8fd0a2;
  --pa-maize: #e8ae34;
  --pa-maize-text: #f3c567;
  --pa-on-green: #ffffff;
  --pa-shadow: 0 1px 2px rgba(0, 0, 0, 0.35), 0 18px 44px -14px rgba(0, 0, 0, 0.6);
}

.login-card {
  width: 100%;
  max-width: 440px;
  margin: auto;
  padding: 2.5rem 2.25rem 2rem;
  background: var(--pa-card);
  border: 1px solid var(--pa-border);
  border-radius: 20px;
  box-shadow: var(--pa-shadow);
  text-align: center;
}

.login-hero {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 76px;
  height: 76px;
  margin: 0 auto 1.25rem;
  border-radius: 50%;
  background: var(--pa-green-soft);
  color: var(--pa-green-text);
  box-shadow: 0 0 0 8px color-mix(in srgb, var(--pa-green-soft) 45%, transparent);
}

.hero-logo {
  height: 48px;
  width: auto;
}

.login-eyebrow {
  margin: 0 0 0.3rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--pa-maize-text);
}

.login-title {
  margin: 0 0 0.6rem;
  font-size: 1.5rem;
  font-weight: 700;
  line-height: 1.25;
  letter-spacing: -0.01em;
  color: var(--pa-ink);
}

.login-message {
  margin: 0 auto 1.75rem;
  max-width: 34ch;
  font-size: 0.95rem;
  line-height: 1.6;
  color: var(--pa-muted);
}

.login-error {
  margin: 0 auto 1rem;
  padding: 0.7rem 1rem;
  border-radius: 12px;
  font-size: 0.85rem;
  background: var(--pa-maize-text);
  color: #ffffff;
}

.login-actions {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.action-primary,
.action-secondary {
  width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.55rem;
  padding: 0.85rem 1.5rem;
  border-radius: 12px;
  font: inherit;
  font-size: 0.97rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}

.action-primary {
  background: var(--pa-green);
  color: var(--pa-on-green);
  border: 1px solid var(--pa-green);
}

.action-primary:hover:not(:disabled) {
  background: var(--pa-green-hover);
  border-color: var(--pa-green-hover);
}

.action-secondary {
  background: transparent;
  color: var(--pa-ink);
  border: 1px solid var(--pa-border);
  text-decoration: none;
}

.action-secondary:hover {
  background: var(--pa-surface);
}

.action-primary:disabled {
  opacity: 0.7;
  cursor: wait;
}

.action-primary:focus-visible,
.action-secondary:focus-visible,

.btn-spinner {
  width: 15px;
  height: 15px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: #ffffff;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.login-footer {
  margin: 1.4rem auto 0;
  max-width: 36ch;
  font-size: 0.82rem;
  line-height: 1.55;
  color: var(--pa-muted);
}




@media (max-width: 480px) {
  .login-card {
    padding: 2rem 1.4rem 1.6rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .btn-spinner {
    animation-duration: 1.6s;
  }
}
</style>
