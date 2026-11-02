<template>
  <div class="pending-container">
    <main class="pending-card">
      <div class="pending-hero" aria-hidden="true">
        <svg class="seedling" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="38" height="38" fill="none"
          stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 20.5v-8"></path>
          <path class="leaf leaf-left" d="M12 14.5c-4 0-6.2-2.6-6.2-6.2 3.7 0 6.2 2.2 6.2 6.2z"></path>
          <path class="leaf leaf-right" d="M12 11.5c0-3.7 2.6-6.2 6.2-6.2 0 3.6-2.2 6.2-6.2 6.2z"></path>
          <path d="M7.5 20.5h9"></path>
        </svg>
      </div>

      <p class="pending-eyebrow">{{ tOr('pending.eyebrow', 'Almost there') }}</p>
      <h1 class="pending-title">{{ tOr('pending.title', 'Account Pending Approval') }}</h1>

      <p class="pending-message">
        {{ tOr('pending.message', 'Your account has been created successfully. An administrator will review your request shortly.') }}
      </p>

      <ol class="pending-steps" :aria-label="tOr('pending.progressLabel', 'Approval progress')">
        <li class="step done">
          <span class="step-dot">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>
          </span>
          <span class="step-label">{{ tOr('pending.stepCreated', 'Account created') }}</span>
        </li>
        <li class="step current" aria-current="step">
          <span class="step-dot"></span>
          <span class="step-label">{{ tOr('pending.stepReview', 'Admin review') }}</span>
        </li>
        <li class="step">
          <span class="step-dot"></span>
          <span class="step-label">{{ tOr('pending.stepAccess', 'Access granted') }}</span>
        </li>
      </ol>

      <dl class="pending-details">
        <div class="detail-row" v-if="userEmail">
          <dt class="detail-label">{{ tOr('pending.email', 'Email') }}</dt>
          <dd class="detail-value" :title="userEmail">{{ userEmail }}</dd>
        </div>
        <div class="detail-row">
          <dt class="detail-label">{{ tOr('pending.status', 'Status') }}</dt>
          <dd class="detail-value" role="status"><span class="status-chip">{{ tOr('pending.statusPending', 'Pending') }}</span></dd>
        </div>
      </dl>

      <section class="pending-next">
        <h2 class="pending-next-title">{{ tOr('pending.whatNextTitle', 'What happens next') }}</h2>
        <ol class="pending-next-list">
          <li>{{ tOr('pending.next1', 'An administrator checks your registration.') }}</li>
          <li>{{ tOr('pending.next2', 'You get an email when your account is approved.') }}</li>
          <li>{{ tOr('pending.next3', 'Sign in again to start asking questions.') }}</li>
        </ol>
      </section>

      <div class="pending-actions">
        <button type="button" class="action-primary" :disabled="checking || loggingOut" @click="checkStatus">
          <span v-if="checking" class="btn-spinner" aria-hidden="true"></span>
          {{ checking ? tOr('pending.checking', 'Checking…') : tOr('pending.checkStatus', 'Check approval status') }}
        </button>

        <button type="button" class="action-secondary" :disabled="loggingOut || checking" @click="goToLogin">
          <span v-if="loggingOut" class="btn-spinner btn-spinner-dark" aria-hidden="true"></span>
          {{ loggingOut ? tOr('pending.signingOut', 'Signing out…') : tOr('pending.signOut', 'Sign out') }}
        </button>
      </div>

      <p class="pending-footer">
        {{ tOr('pending.contact', 'You\'ll get an email once approved. Need access sooner? Contact your administrator.') }}
      </p>

    </main>
  </div>
</template>

<script>
import keycloakAuthService from '@/services/keycloakAuthService';

export default {
  name: 'PendingApprovalScreen',
  props: {
    theme: {
      type: String,
      default: 'light'
    },
    userEmail: {
      type: String,
      default: ''
    }
  },
  data() {
    return { loggingOut: false, checking: false };
  },
  computed: {},
  created() {
    // M.20: this door is English-only like the login screen (Adem) — no
    // restore needed: approval navigates via full page load, so the app
    // re-reads the saved userLocale on boot.
    if (this.$i18n) this.$i18n.locale = 'en';
  },
  // AgriConnect LSO: no longer forces data-theme="light" onto <html>. The route
  // never passes `theme`, so that override always fought the user's saved theme
  // and produced dark text on a dark card. The screen now follows the app theme
  // (html[data-theme]) with its own high-contrast colour tokens below. The
  // `theme` prop is kept so existing callers don't break.
  methods: {
    // AgriConnect LSO: translate with an English fallback. In this app's i18n
    // setup the $t(key, 'fallback') form does NOT fall back (verified locally:
    // missing keys rendered as raw "pending.title" etc.), so new keys would
    // show as raw text on the live site until added to the translation files.
    tOr(key, fallback) {
      const translated = this.$t(key);
      return translated && translated !== key ? translated : fallback;
    },
    checkStatus() {
      if (this.checking || this.loggingOut) return;
      this.checking = true;
      // AgriConnect LSO: a full navigation re-runs auth initialisation.
      // Approved users land on the dashboard; users still pending are sent
      // back here by the existing ACCOUNT_PENDING handling (see DEC-24b note
      // below). Needs verifying against that flow before merge.
      window.location.assign('/dashboard');
    },
    async goToLogin() {
      if (this.loggingOut) return;
      this.loggingOut = true;
      // F14/DEC-24b: the Pending user still holds a VALID SSO session — calling
      // login() alone made Keycloak silently re-authenticate, land on the guarded
      // dashboard, 403 ACCOUNT_PENDING, and bounce right back here: a redirect
      // loop that read as a dead button. "Back to Login" for a session-holding
      // user means LOG OUT — via the store action (sets genie_post_logout,
      // cleans legacy keys, then id_token_hint signoutRedirect): the Keycloak
      // login page then appears for real instead of a silent re-auth.
      // AgriConnect LSO: button relabelled "Sign out" so it says what it does.
      try {
        await this.$store.dispatch('logout');
      } catch (error) {
        console.error('[PendingApproval] Logout failed, forcing login redirect:', error);
        this.loggingOut = false;
        keycloakAuthService.login();
      }
    }
  }
}
</script>

<style scoped>
/*
 * AgriConnect LSO redesign.
 * The screen carries its own colour tokens so text never depends on whichever
 * app theme variables happen to be defined. Every text/background pair below
 * meets WCAG AA (4.5:1) in both light and dark.
 * Palette: field green (brand, from the app header), maize amber (waiting
 * state), soil-tinted neutrals.
 */
.pending-container {
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
  --pa-maize-soft: #fbf0d5;
  --pa-maize-text: #7a4e00;
  --pa-on-green: #ffffff;
  --pa-shadow: 0 1px 2px rgba(20, 40, 25, 0.05), 0 18px 44px -14px rgba(20, 40, 25, 0.22);

  /* Own full-screen scroll area: the app shell clips overflow (height: 100vh;
     overflow: hidden), so a tall card was cut off with no way to scroll. */
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

/* Dark theme follows the app's own switch on <html> */
:global(html[data-theme="dark"]) .pending-container {
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
  --pa-maize-soft: #3a2f16;
  --pa-maize-text: #f3c567;
  --pa-on-green: #ffffff;
  --pa-shadow: 0 1px 2px rgba(0, 0, 0, 0.35), 0 18px 44px -14px rgba(0, 0, 0, 0.6);
}

.pending-card {
  width: 100%;
  max-width: 440px;
  /* auto margins centre the card when it fits, and fall back to the top
     (instead of clipping) when it is taller than the screen */
  margin: auto;
  padding: 2.5rem 2.25rem 2rem;
  background: var(--pa-card);
  border: 1px solid var(--pa-border);
  border-radius: 20px;
  box-shadow: var(--pa-shadow);
  text-align: center;
}

/* --- hero: a seedling, because waiting here means growing into access --- */
.pending-hero {
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

.seedling .leaf {
  transform-box: fill-box;
  animation: leaf-grow 0.9s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}

.seedling .leaf-left {
  transform-origin: 100% 100%;
}

.seedling .leaf-right {
  transform-origin: 0% 100%;
  animation-delay: 0.25s;
}

@keyframes leaf-grow {
  from { transform: scale(0.2); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

/* --- copy --- */
.pending-eyebrow {
  margin: 0 0 0.3rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--pa-maize-text);
}

.pending-title {
  margin: 0 0 0.6rem;
  font-size: 1.5rem;
  font-weight: 700;
  line-height: 1.25;
  letter-spacing: -0.01em;
  color: var(--pa-ink);
}

.pending-message {
  margin: 0 auto 1.75rem;
  max-width: 34ch;
  font-size: 0.95rem;
  line-height: 1.6;
  color: var(--pa-muted);
}

/* --- progress steps --- */
.pending-steps {
  list-style: none;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  margin: 0 0 1.75rem;
  padding: 0;
}

.step {
  position: relative;
  flex: 1;
  max-width: 130px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.45rem;
}

.step:not(:first-child)::before {
  content: '';
  position: absolute;
  top: 11px;
  right: 50%;
  width: 100%;
  height: 2px;
  background: var(--pa-border);
}

.step.done:not(:first-child)::before,
.step.current:not(:first-child)::before {
  background: var(--pa-green);
}

.step-dot {
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--pa-card);
  border: 2px solid var(--pa-border);
  color: transparent;
}

.step.done .step-dot {
  background: var(--pa-green);
  border-color: var(--pa-green);
  color: var(--pa-on-green);
}

.step.current .step-dot {
  border-color: var(--pa-maize);
  box-shadow: 0 0 0 4px var(--pa-maize-soft);
}

.step-label {
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1.3;
  color: var(--pa-muted);
}

.step.done .step-label {
  color: var(--pa-ink);
}

.step.current .step-label {
  font-weight: 600;
  color: var(--pa-maize-text);
}

/* --- details --- */
.pending-details {
  margin: 0 0 1.5rem;
  padding: 0.25rem 1rem;
  background: var(--pa-surface);
  border: 1px solid var(--pa-border);
  border-radius: 12px;
  text-align: left;
}

.detail-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.65rem 0;
}

.detail-row + .detail-row {
  border-top: 1px solid var(--pa-border);
}

.detail-label {
  font-size: 0.82rem;
  color: var(--pa-muted);
}

.detail-value {
  margin: 0;
  min-width: 0;
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--pa-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.22rem 0.75rem;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--pa-maize-text);
  background: var(--pa-maize-soft);
}

.status-chip::before {
  content: '';
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--pa-maize);
  animation: waiting 2s ease-in-out infinite;
}

@keyframes waiting {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

/* --- what happens next --- */
.pending-next {
  margin: 0 0 1.75rem;
  text-align: left;
}

.pending-next-title {
  margin: 0 0 0.55rem;
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--pa-ink);
}

.pending-next-list {
  margin: 0;
  padding: 0;
  list-style: none;
  counter-reset: next-step;
}

.pending-next-list li {
  position: relative;
  padding: 0.2rem 0 0.2rem 2rem;
  font-size: 0.9rem;
  line-height: 1.55;
  color: var(--pa-muted);
  counter-increment: next-step;
}

.pending-next-list li::before {
  content: counter(next-step);
  position: absolute;
  left: 0;
  top: 0.22rem;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.35rem;
  height: 1.35rem;
  border-radius: 50%;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--pa-green-text);
  background: var(--pa-green-soft);
}

/* --- actions --- */
.pending-actions {
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
}

.action-secondary:hover:not(:disabled) {
  background: var(--pa-surface);
}

.action-primary:disabled,
.action-secondary:disabled {
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

.btn-spinner-dark {
  border-color: var(--pa-border);
  border-top-color: var(--pa-ink);
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* --- footer + language --- */
.pending-footer {
  margin: 1.4rem auto 0;
  max-width: 36ch;
  font-size: 0.82rem;
  line-height: 1.55;
  color: var(--pa-muted);
}

/* --- small screens --- */
@media (max-height: 780px) {
  .pending-card { padding: 1.75rem 1.75rem 1.5rem; }
  .pending-hero { width: 60px; height: 60px; margin-bottom: 0.9rem; }
  .pending-hero svg { width: 30px; height: 30px; }
  .pending-message { margin-bottom: 1.25rem; }
  .pending-steps { margin-bottom: 1.25rem; }
  .pending-details { margin-bottom: 1.1rem; }
  .pending-next { margin-bottom: 1.25rem; }
  .pending-footer { margin-top: 1rem; }
}

@media (max-width: 420px) {
  .pending-container { padding: 0.75rem; }
  .pending-card { padding: 2rem 1.25rem 1.6rem; border-radius: 16px; }
  .pending-title { font-size: 1.3rem; }
  .step-label { font-size: 0.68rem; }
}

/* --- respect reduced motion --- */
@media (prefers-reduced-motion: reduce) {
  .seedling .leaf,
  .status-chip::before,
  .btn-spinner {
    animation: none;
  }

  .action-primary,
  .action-secondary {
    transition: none;
  }
}
</style>