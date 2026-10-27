<!-- NavBarComponent.vue with logout button and admin role check -->
<template>
  <div class="nav-container">
    <header class="nav-bar" data-test-id="nav-bar">
      <!-- Left section with logo and title. The hamburger collapse
           control has been retired: both sidebars collapse from
           their own edge handle (SidebarHandle.vue), so the navbar
           no longer carries the toggle. The brand keeps the slot it
           used to occupy via the new top padding on .logo-container
           below — visually unchanged for users who never collapse
           either sidebar. -->
      <div class="nav-left">
        <!-- Logo container for GENIE.AI configured icon -->
        <router-link to="/dashboard" class="logo-container logo-container--no-hamburger">
          <!-- Display SVG icon from config (file or inline) -->
          <img v-if="config.app.icon.type === 'file'" :src="config.app.icon.value" class="govt-logo" alt="App Icon" />
          <!-- eslint-disable-next-line vue/no-v-html -->
          <span v-else class="govt-logo" v-html="config.app.icon.value"></span>
        </router-link>
        <!-- Title from GENIE.AI config - Hide on mobile -->
        <router-link to="/dashboard" class="brand-name hide-on-mobile" :class="brandWordmarkClass">{{
          config.app.title
        }}</router-link>

        <!-- Mascot pastille (AgroGenio brand) — hidden if config absent -->
        <img
          v-if="config.app.mascot && config.app.mascot.url"
          :src="config.app.mascot.url"
          :alt="config.app.mascot.alt || 'Mascot'"
          class="nav-mascot"
          data-test-id="nav-mascot"
        />

        <!-- Mobile controls - Only shown on mobile devices -->
        <div class="mobile-controls">
          <!-- Language Selector for Mobile -->
          <div class="language-select-container mobile-language-select">
            <language-selector />
          </div>

          <!-- Analytics button for Mobile -->
          <DsButton
            variant="ghost"
            class="icon-btn mobile-btn"
            aria-label="Analytics"
            :disabled="!isAdmin"
            :class="{ 'disabled-btn': !isAdmin }"
            @click="$router.push('/analytics')"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
              <path d="M22 12A10 10 0 0 0 12 2v10z" />
            </svg>
            <span class="tooltip">{{ $t('nav.analytics') }}</span>
          </DsButton>

          <!-- Admin button for Mobile -->
          <DsButton
            variant="ghost"
            class="icon-btn admin-btn mobile-btn"
            aria-label="Administration"
            :disabled="!isAdmin"
            :class="{ 'disabled-btn': !isAdmin }"
            @click="$router.push('/admin')"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="9" y1="21" x2="9" y2="9" />
            </svg>
            <span class="tooltip">{{ $t('nav.administration') }}</span>
          </DsButton>

          <DsButton
            variant="ghost"
            class="icon-btn mobile-btn"
            aria-label="Settings"
            @click="$router.push('/settings')"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path
                d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v-.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l-.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
              />
            </svg>
            <span class="tooltip">{{ $t('nav.settings') }}</span>
          </DsButton>

          <DsButton
            variant="ghost"
            class="icon-btn user-btn mobile-btn"
            aria-label="User profile"
            @click="$router.push('/profile')"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <span class="tooltip">{{ $t('nav.userProfile') }}</span>
          </DsButton>

          <!-- ADDED: Logout button for mobile -->
          <DsButton variant="ghost" class="icon-btn logout-btn mobile-btn" aria-label="Log out" @click="handleLogout">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span class="tooltip">{{ $t('nav.logout') }}</span>
          </DsButton>
        </div>
      </div>

      <!-- Main navbar area - Only visible on desktop -->
      <div class="nav-main desktop-only"></div>

      <!-- Right section with language and user controls - Only visible on desktop -->
      <div class="nav-right desktop-only">
        <!-- The assistant's reachability, visible on every page: online is a
             quiet pill, offline turns danger and carries the explanation. -->
        <span
          class="nav-status"
          data-testid="nav-status"
          :data-status="status.online ? 'online' : 'offline'"
          role="status"
          :title="
            status.online
              ? status.lastResponseTime !== null
                ? `${status.lastResponseTime}ms`
                : $t('nav.statusOnline')
              : status.errorMessage || $t('nav.statusOffline')
          "
        >
          <span class="nav-status__dot" aria-hidden="true"></span>
          {{ status.online ? $t('nav.statusOnline') : $t('nav.statusOffline') }}
        </span>
        <div class="language-select-container">
          <language-selector />
        </div>

        <!-- Analytics button for Desktop -->
        <DsButton
          variant="ghost"
          class="icon-btn"
          aria-label="Analytics"
          :disabled="!isAdmin"
          :class="{ 'disabled-btn': !isAdmin }"
          @click="$router.push('/analytics')"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
            <path d="M22 12A10 10 0 0 0 12 2v10z" />
          </svg>
          <span class="tooltip">{{ $t('nav.analytics') }}</span>
        </DsButton>

        <!-- Admin button for Desktop -->
        <DsButton
          variant="ghost"
          class="icon-btn admin-btn"
          aria-label="Administration"
          :disabled="!isAdmin"
          :class="{ 'disabled-btn': !isAdmin }"
          @click="$router.push('/admin')"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <line x1="3" y1="9" x2="21" y2="9" />
            <line x1="9" y1="21" x2="9" y2="9" />
          </svg>
          <span class="tooltip">{{ $t('nav.administration') }}</span>
        </DsButton>

        <DsButton variant="ghost" class="icon-btn" aria-label="Settings" @click="$router.push('/settings')">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path
              d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v-.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
            />
          </svg>
          <span class="tooltip">{{ $t('nav.settings') }}</span>
        </DsButton>

        <DsButton variant="ghost" class="icon-btn user-btn" aria-label="User profile" @click="$router.push('/profile')">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          <span class="tooltip">{{ $t('nav.userProfile') }}</span>
        </DsButton>

        <!-- ADDED: Logout button -->
        <DsButton variant="ghost" class="icon-btn logout-btn" aria-label="Log out" @click="handleLogout">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          <span class="tooltip">{{ $t('nav.logout') }}</span>
        </DsButton>
      </div>
    </header>
  </div>
</template>

<script>
import LanguageSelector from '@/components/LanguageSelector.vue';
import DsButton from './ds/Button.vue';
import { mapGetters } from 'vuex';

export default {
  name: 'NavBarComponent',
  components: {
    LanguageSelector,
    DsButton
  },
  props: {
    // The left sidebar's open/closed state used to be passed in so
    // the hamburger button could show its active styling. The
    // hamburger is gone; both sidebars collapse from their edge
    // handle (SidebarHandle.vue). The prop is left removed.
    // GENIE.AI configuration for title, icon, and navbar styling
    config: {
      type: Object,
      required: false,
      default: () => ({
        app: { title: 'GENIE.AI', icon: { type: 'file', value: '/config/logo-genie-ai.jpeg' } },
        theme: { navbar: {} }
      })
    }
  },
  emits: ['logout'],
  data() {
    return {};
  },
  computed: {
    ...mapGetters('status', ['status']),
    // Only the GENIE.AI brand carries the gradient wordmark; the flavour
    // configs ship their own titles and are left as plain text. Comparing
    // the title keeps this off the config schema and off the decoration
    // switch, either of which an operator could turn off by accident.
    brandWordmarkClass() {
      return this.config?.app?.title === 'GENIE.AI' ? 'brand-wordmark' : '';
    },
    isAdmin() {
      const user = this.$store.getters.currentUser;
      if (!user) return false;

      const roles = user.roles || [];
      return roles.map((r) => r.toLowerCase()).includes('admin');
    }
  },
  watch: {
    '$i18n.locale'(newLocale) {
      this.currentLocale = newLocale;
    }
  },
  mounted() {},
  beforeUnmount() {},

  methods: {
    //Logout handler — delegates to Vuex store (keycloakAuthService handles Keycloak redirect)
    async handleLogout() {
      try {
        this.$emit('logout');
        await this.$store.dispatch('logout');
      } catch {
        this.$emit('logout');
      }
    }
  }
};
</script>

<style scoped>
/* The reachability pill: a quiet dot+label online; danger with the
   explanation on hover when the assistant is unreachable. */
.nav-status {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  font-size: var(--text-sm);
  font-weight: 500;
  /* The pill sits on the navbar band, so its ink must be the band's
     (accent-fg is rebound to --navbar-fg by .nav-bar), not the page's
     --muted — on a saturated light-mode band (agrogenio) that one is
     a light-surface grey and the pill vanishes. Quieted to 82 % so it
     still reads as secondary next to the controls beside it. */
  color: color-mix(in oklch, var(--accent-fg) 82%, transparent);
  padding: 3px var(--space-sm);
  border-radius: var(--radius-pill, 999px);
  white-space: nowrap;
}

.nav-status__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--success);
  /* Ring in the band's ink: the success green sits on a green brand
     band in both themes here, and without the ring the dot melts into
     the background. */
  box-shadow: 0 0 0 2px color-mix(in oklch, var(--accent-fg) 35%, transparent);
}

.nav-status[data-status='offline'] {
  color: var(--danger);
  background: var(--danger-bg);
}

.nav-status[data-status='offline'] .nav-status__dot {
  background: var(--danger);
}
/* Base styles - applied to all themes */
.nav-container {
  position: relative;
}

/* Navbar styling — a brand-tinted band, pale in light and saturated in dark */
.nav-bar {
  /* Several controls in here — the ghost buttons and the language select
     among them — read --accent-fg, which is the app-wide ink for the page
     surface, not for this band. Rebinding it once to the navbar's own token
     is what keeps them readable when the band changes value; without it the
     bar inherits one theme's ink and paints the other's. */
  --accent-fg: var(--navbar-fg);
  display: flex;
  align-items: center;
  background: var(--navbar-bg, var(--accent));
  color: var(--navbar-fg, var(--accent-fg));
  height: 60px;
  padding: var(--space-sm) var(--space-md);
  /* Square corners: the band is a full-width structural bar, not a
     floating card. Its rounding only ever showed on deployments whose
     configured band colour contrasts with the page background (the
     default light tokens paint a pale wash that melts into it), so the
     property read as arbitrary from flavour to flavour. */
  position: relative;
  z-index: 20;
}

.nav-left {
  display: flex;
  align-items: center;
  flex: 1;
}

.nav-main {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-width: 120px;
}

.nav-right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-width: 210px;
}

/* Brand name styling */
.brand-name {
  margin: 0 0 0 var(--space-md);
  font-family: var(--font-mono);
  font-size: var(--text-base);
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: 0.5px;
  color: var(--accent-fg);
  text-decoration: none;
}

/*
 * The wordmark. .brand-wordmark in genie-visual-effects.css paints the
 * gradient; this only sets the type it is painted in, and outranks
 * .brand-name above on specificity so the two compose instead of
 * competing.
 */
.brand-name.brand-wordmark {
  /* Sizes assume --font-scale: 1; the operator's typography.fontScale
     scales --text-lg / --text-xl with the rest of the tokens, so the
     wordmark scales with the rest of the navbar rather than holding a
     fixed size. The clamp floor is the small-screen view (~16px at 1.0
     scale = var(--text-lg); 1.6vw reaches 16px at a 1024px viewport). */
  font-family: var(--font-display);
  font-size: clamp(var(--text-lg), 1.6vw, var(--text-xl));
  font-weight: 800;
  letter-spacing: -0.035em;
}

/* Logo styling and animations. The `--no-hamburger` modifier
   preserves the visual layout that the retired hamburger button
   used to occupy; without the hamburger the logo would otherwise
   shift left to the navbar's padding edge and the brand layout
   would lose its anchor. */
.logo-container {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  margin-left: var(--space-sm);
  background-color: var(--accent-muted);
  border-radius: 50%;
}

.logo-container--no-hamburger {
  /* Sits flush on the nav's own padding — the same 16 px the logout
     control keeps from the right edge — so the branding and the
     controls mirror each other across the bar. */
  margin-left: 0;
}

.govt-logo {
  height: 40px;
  width: 40px;
  border-radius: var(--radius-md);
  object-fit: cover;
  transition: transform 0.3s ease;
}

.logo-container:hover .govt-logo {
  transform: scale(1.08);
}

/* Logo animations */
@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes slideDown {
  from {
    transform: translateY(-10px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

@keyframes pulse {
  0% {
    opacity: 0.8;
    transform: scale(1);
  }
  50% {
    opacity: 1;
    transform: scale(1.08);
  }
  100% {
    opacity: 0.8;
    transform: scale(1);
  }
}

@keyframes rotateIn {
  from {
    transform: rotate(-15deg);
    opacity: 0;
  }
  to {
    transform: rotate(0deg);
    opacity: 1;
  }
}

@keyframes shimmer {
  0% {
    stroke-dashoffset: 200;
  }
  100% {
    stroke-dashoffset: 0;
  }
}

.logo-base {
  fill: url(#logoGradient);
  animation: fadeIn 1.2s ease-out forwards;
}

.logo-roof {
  animation: rotateIn 1s ease-out 0.3s both;
  transform-origin: center;
}

.logo-pillars {
  animation: slideDown 0.8s ease-out 0.6s both;
}

.logo-steps {
  animation: slideDown 0.7s ease-out 0.9s both;
}

.logo-outline {
  stroke-dasharray: 200;
  stroke-dashoffset: 200;
  animation: shimmer 2s ease-out 1.2s forwards;
}

.logo-glow {
  animation: pulse 3s ease-in-out infinite;
}

.logo-star {
  animation: pulse 2s ease-in-out infinite;
  transform-origin: center;
}

/* Button styling - Layout overrides for icon buttons on accent navbar */
.nav-bar .icon-btn {
  width: 40px;
  height: 40px;
  margin-left: var(--space-sm);
  position: relative;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-fg);
  --ds-btn-ghost-color: var(--accent-fg);
  --ds-btn-ghost-hover-color: var(--fg);
  --ds-btn-ghost-hover-bg: color-mix(in oklch, var(--fg) 15%, transparent);
}

.icon-btn svg {
  width: 22px;
  height: 22px;
  color: var(--ds-btn-ghost-color, var(--accent-fg));
  transition:
    transform 0.2s ease,
    color 0.2s ease;
}

.icon-btn:hover svg {
  transform: scale(1.1);
  color: var(--ds-btn-ghost-hover-color, var(--fg));
}

/* Disabled button styling */
.icon-btn:disabled,
.disabled-btn {
  opacity: 0.5;
  cursor: not-allowed;
}

.icon-btn:disabled:hover svg,
.disabled-btn:hover svg {
  transform: none;
}

/* Tooltip styling */
/*
 * A tooltip may not reach past the viewport.
 *
 * Centred on its button and `white-space: nowrap`, this opened
 * outward from the right-hand group and crossed the window's edge:
 * measured in French at 1920 px, "Déconnexion" spanned 1839..1929 —
 * 9 px past the viewport. It only shows on hover, which is why the
 * overflow is intermittent: one measurement saw scrollWidth 1920 and
 * the next 1932.
 *
 * A tooltip is anchored to the button's outer edge and opens INWARD,
 * so it can only ever grow away from the edge it would have crossed.
 * The two groups are mirrored; within a group every tooltip opens the
 * same way, so the row reads consistently rather than flickering
 * between orientations as the labels change length.
 */
.tooltip {
  position: absolute;
  bottom: -34px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--tooltip-bg);
  color: var(--tooltip-fg);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  white-space: nowrap;
  /* A backstop under the inward anchoring: however long a translation
     turns out to be, the label cannot exceed the viewport's width, so
     it can never become the thing that widens the page. Truncates
     rather than wraps — a tooltip that reflows to three lines is a
     tooltip that has stopped being a tooltip. */
  max-width: calc(100vw - 2 * var(--space-md));
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0;
  visibility: hidden;
  transition:
    opacity 0.2s,
    visibility 0.2s;
  pointer-events: none;
  z-index: 40;
}

.tooltip::before {
  content: '';
  position: absolute;
  top: -4px;
  left: 50%;
  transform: translateX(-50%) rotate(45deg);
  width: 8px;
  height: 8px;
  background: var(--tooltip-bg);
}

.icon-btn:hover .tooltip {
  opacity: 1;
  visibility: visible;
}

/* Right-hand group: anchored to the button's right edge, opening
   leftward into the page. */
.nav-right .icon-btn .tooltip,
.nav-right .language-select-container .tooltip {
  left: auto;
  right: 0;
  transform: none;
}

/* Left-hand group: the mirror, opening rightward. */
.nav-left .icon-btn .tooltip,
.nav-left .language-select-container .tooltip {
  left: 0;
  right: auto;
  transform: none;
}

/* Language dropdown styling */
.language-select-container {
  position: relative;
  width: auto;
  margin-right: var(--space-sm);
  --ds-select-bg: color-mix(in oklch, var(--accent) 20%, transparent);
  --ds-select-color: var(--accent-fg);
  --ds-select-border-color: color-mix(in oklch, var(--accent-fg) 50%, transparent);
}

.language-select-container :deep(.ds-select:focus) {
  border-color: color-mix(in oklch, var(--accent-fg) 70%, transparent);
}

.language-select-container :deep(option) {
  background: var(--surface);
  color: var(--fg);
}

/* Mobile controls and responsive styles */
.mobile-controls {
  display: none;
  align-items: center;
  margin-left: auto;
}

.mobile-language-select {
  width: 60px;
  margin-left: var(--space-sm);
  margin-right: 0;
}

.mobile-btn {
  width: 36px;
  height: 36px;
  margin-left: var(--space-sm);
}

.mobile-btn svg {
  width: 20px;
  height: 20px;
}

/* Desktop vs Mobile display control */
.desktop-only {
  display: flex;
}

/* Hide elements on mobile */
.hide-on-mobile {
  display: block;
}

/* Responsive adjustments */
@media (max-width: 1024px) {
  .brand-name {
    font-size: var(--text-lg);
  }
}

@media (max-width: 1024px) {
  .brand-name {
    font-size: var(--text-md);
    max-width: 300px;
  }

  .icon-btn {
    margin-left: var(--space-sm);
  }
}

@media (max-width: 768px) {
  /* Hide desktop controls and show mobile controls */
  .desktop-only {
    display: none;
  }

  .hide-on-mobile {
    display: none;
  }

  .mobile-controls {
    display: flex;
  }

  .govt-logo {
    height: 36px;
    width: 36px;
  }

  .nav-bar {
    padding: 0 var(--space-md);
  }

  .mobile-language-select {
    --ds-select-bg: transparent;
    --ds-select-color: var(--accent-fg);
    --ds-select-border-color: transparent;
  }

  .mobile-language-select :deep(option) {
    background: var(--accent);
    color: var(--accent-fg);
  }
}

@media (max-width: 480px) {
  .govt-logo {
    height: 32px;
    width: 32px;
  }

  .icon-btn {
    width: 36px;
    height: 36px;
  }

  .icon-btn svg {
    width: 20px;
    height: 20px;
  }

  .tooltip {
    display: none;
  }
}

@media (max-width: 480px) {
  .govt-logo {
    height: 32px;
    width: 32px;
  }

  .nav-bar {
    height: 54px;
  }

  /* Space mobile controls more compactly */
  .mobile-btn {
    margin-left: var(--space-sm);
    width: 32px;
    height: 32px;
  }

  .mobile-language-select {
    width: 50px;
    margin-left: var(--space-sm);
  }
}

.nav-mascot {
  width: 44px;
  height: 44px;
  margin-left: var(--space-sm);
  border-radius: 50%;
  filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.3));
  position: relative;
  z-index: 1;
}

.nav-bar::after {
  content: '';
  position: absolute;
  inset: 0;
  background-image: radial-gradient(
    circle at 95% 50%,
    color-mix(in srgb, var(--brand) 22%, transparent),
    transparent 35%
  );
  pointer-events: none;
  z-index: 0;
}
</style>
