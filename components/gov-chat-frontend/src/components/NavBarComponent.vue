<!-- NavBarComponent.vue with logout button and admin role check -->
<template>
  <div class="nav-container">
    <header class="nav-bar" data-test-id="nav-bar">
      <!-- Left section with hamburger menu, logo, and title -->
      <div class="nav-left">
        <!-- Hamburger button for sidebar toggle -->
        <DsButton
          variant="ghost"
          class="icon-btn hamburger-btn"
          :class="{ 'is-active': isSidebarOpen }"
          aria-label="Toggle sidebar"
          @click="toggleSidebar"
        >
          <span class="hamburger-inner"></span>
        </DsButton>

        <!-- Logo container for GENIE.AI configured icon -->
        <router-link to="/dashboard" class="logo-container">
          <!-- Display SVG icon from config (file or inline) -->
          <img v-if="config.app.icon.type === 'file'" :src="config.app.icon.value" class="govt-logo" alt="App Icon" />
          <!-- eslint-disable-next-line vue/no-v-html -->
          <span v-else class="govt-logo" v-html="config.app.icon.value"></span>
        </router-link>
        <!-- Title from GENIE.AI config - Hide on mobile -->
        <router-link to="/dashboard" class="brand-name hide-on-mobile">{{ config.app.title }}</router-link>

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

export default {
  name: 'NavBarComponent',
  components: {
    LanguageSelector,
    DsButton
  },
  props: {
    isSidebarOpen: {
      type: Boolean,
      default: true
    },
    sidebarWidth: {
      type: Number,
      default: 250 // Default sidebar width in pixels
    },
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
  emits: ['toggleSidebar', 'logout'],
  data() {
    return {};
  },
  computed: {
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
    },
    toggleSidebar() {
      this.$emit('toggleSidebar');
    }
  }
};
</script>

<style scoped>
/* Base styles - applied to all themes */
.nav-container {
  position: relative;
}

/* Navbar styling — flat solid accent background (tech-utility direction) */
.nav-bar {
  display: flex;
  align-items: center;
  background: var(--navbar-bg, var(--accent));
  color: var(--navbar-fg, var(--accent-fg));
  height: 60px;
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
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

/* Logo styling and animations */
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

/* Hamburger menu styling - Layout only, colors handled by DsButton ghost variant */
.hamburger-btn {
  position: relative;
  width: 40px;
  height: 40px;
  padding: 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.hamburger-inner {
  position: relative;
  width: 18px;
  height: 2px;
  background-color: var(--accent-fg);
  transition: background-color 0.2s ease;
}

.hamburger-inner::before,
.hamburger-inner::after {
  content: '';
  position: absolute;
  left: 0;
  width: 18px;
  height: 2px;
  background-color: var(--accent-fg);
  transition:
    transform 0.3s ease,
    background-color 0.2s ease;
}

.hamburger-inner::before {
  top: -5px;
}

.hamburger-inner::after {
  bottom: -5px;
}

.hamburger-btn:hover .hamburger-inner,
.hamburger-btn:hover .hamburger-inner::before,
.hamburger-btn:hover .hamburger-inner::after {
  background-color: var(--fg);
}

/* Centered X state */
.hamburger-btn.is-active .hamburger-inner {
  background-color: transparent;
  transform: translateX(0);
}

.hamburger-btn.is-active .hamburger-inner::before {
  transform: translateY(5px) rotate(45deg);
  top: 0;
}

.hamburger-btn.is-active .hamburger-inner::after {
  transform: translateY(-5px) rotate(-45deg);
  bottom: 0;
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

  .hamburger-btn {
    width: 36px;
    height: 36px;
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
</style>
