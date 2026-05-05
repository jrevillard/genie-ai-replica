<!-- NavBarComponent.vue with logout button and admin role check -->
<template>
  <div class="nav-container">
    <header class="nav-bar">
      <!-- Left section with hamburger menu, logo, and title -->
      <div class="nav-left">
        <!-- Hamburger button for sidebar toggle -->
        <button
          class="icon-btn hamburger-btn"
          :class="{ 'is-active': isSidebarOpen }"
          aria-label="Toggle sidebar"
          @click="toggleSidebar"
        >
          <span class="hamburger-inner"></span>
        </button>

        <!-- Logo container for GENIE.AI configured icon -->
        <div class="logo-container">
          <!-- Display SVG icon from config (file or inline) -->
          <img v-if="config.app.icon.type === 'file'" :src="config.app.icon.value" class="govt-logo" alt="App Icon" />
          <!-- eslint-disable-next-line vue/no-v-html -->
          <span v-else class="govt-logo" v-html="config.app.icon.value"></span>
        </div>
        <!-- Title from GENIE.AI config - Hide on mobile -->
        <h1 class="brand-name hide-on-mobile">{{ config.app.title }}</h1>

        <!-- Mobile controls - Only shown on mobile devices -->
        <div class="mobile-controls">
          <!-- Language Selector for Mobile -->
          <div class="language-select-container mobile-language-select">
            <language-selector />
          </div>

          <!-- Analytics button for Mobile -->
          <button
            class="icon-btn mobile-btn"
            aria-label="Analytics"
            :disabled="!isAdmin"
            :class="{ 'disabled-btn': !isAdmin }"
            @click="$emit('openAnalytics')"
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
          </button>

          <!-- Admin button for Mobile -->
          <button
            class="icon-btn admin-btn mobile-btn"
            aria-label="Administration"
            :disabled="!isAdmin"
            :class="{ 'disabled-btn': !isAdmin }"
            @click="$emit('openAdmin')"
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
          </button>

          <button class="icon-btn mobile-btn" aria-label="Settings" @click="$emit('openSettings')">
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
          </button>

          <button class="icon-btn user-btn mobile-btn" aria-label="User profile" @click="$emit('openProfile')">
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
          </button>

          <!-- ADDED: Logout button for mobile -->
          <button class="icon-btn logout-btn mobile-btn" aria-label="Log out" @click="handleLogout">
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
          </button>
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
        <button
          class="icon-btn"
          aria-label="Analytics"
          :disabled="!isAdmin"
          :class="{ 'disabled-btn': !isAdmin }"
          @click="$emit('openAnalytics')"
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
        </button>

        <!-- Admin button for Desktop -->
        <button
          class="icon-btn admin-btn"
          aria-label="Administration"
          :disabled="!isAdmin"
          :class="{ 'disabled-btn': !isAdmin }"
          @click="$emit('openAdmin')"
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
        </button>

        <button class="icon-btn" aria-label="Settings" @click="$emit('openSettings')">
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
        </button>

        <button class="icon-btn user-btn" aria-label="User profile" @click="$emit('openProfile')">
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
        </button>

        <!-- ADDED: Logout button -->
        <button class="icon-btn logout-btn" aria-label="Log out" @click="handleLogout">
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
        </button>
      </div>
    </header>
  </div>
</template>

<script>
import LanguageSelector from '@/components/LanguageSelector.vue';

export default {
  name: 'NavBarComponent',
  components: {
    LanguageSelector
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
        app: { title: 'Huduma AI', icon: { type: 'file', value: '/config/huduma-icon.svg' } },
        theme: { navbar: { textColor: '#ffffff' } }
      })
    }
  },
  emits: ['toggleSidebar', 'openAnalytics', 'openProfile', 'openSettings', 'logout', 'openAdmin'],
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
      } catch (error) {
        console.error('Logout error:', error.message);
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

/* Navbar styling with GENIE.AI configured gradient and text color */
.nav-bar {
  display: flex;
  align-items: center;
  background: linear-gradient(135deg, var(--navbar-gradient-start, #4e97d1), var(--navbar-gradient-end, #2c5f8a));
  color: var(--navbar-text-color, #fff);
  height: 60px;
  padding: 0 16px;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.15);
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
  margin: 0 0 0 12px;
  font-size: 1.2rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: 0.5px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}

/* Logo styling and animations */
.logo-container {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  margin-left: 8px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 50%;
}

/* Adjusted for GENIE.AI configured SVG icon */
.govt-logo {
  height: 40px;
  width: 40px;
  color: white;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2));
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

/* Button styling */
.icon-btn {
  background: rgba(255, 255, 255, 0.1);
  border: none;
  cursor: pointer;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: 10px;
  position: relative;
  transition: all 0.2s ease;
  color: white;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.icon-btn:hover {
  background-color: rgba(255, 255, 255, 0.25);
  transform: translateY(-1px);
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.15);
}

.icon-btn:active {
  transform: translateY(0);
}

.icon-btn svg {
  width: 22px;
  height: 22px;
  transition: transform 0.2s ease;
}

.icon-btn:hover svg {
  transform: scale(1.1);
}

/* Disabled button styling */
.icon-btn:disabled,
.disabled-btn {
  opacity: 0.5;
  cursor: not-allowed;
  background: rgba(255, 255, 255, 0.05);
  box-shadow: none;
}

.icon-btn:disabled:hover,
.disabled-btn:hover {
  transform: none;
  background: rgba(255, 255, 255, 0.05);
  box-shadow: none;
}

.icon-btn:disabled svg,
.disabled-btn svg {
  opacity: 0.6;
}

.icon-btn:disabled:hover svg,
.disabled-btn:hover svg {
  transform: none;
}

/* Logout button styling */
.logout-btn {
  background: rgba(255, 255, 255, 0.1);
}

.logout-btn:hover {
  background-color: rgba(239, 68, 68, 0.25); /* Subtle red on hover */
}

/* Tooltip styling */
.tooltip {
  position: absolute;
  bottom: -34px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.8);
  color: white;
  padding: 5px 10px;
  border-radius: 4px;
  font-size: 12px;
  white-space: nowrap;
  opacity: 0;
  visibility: hidden;
  transition:
    opacity 0.2s,
    visibility 0.2s;
  pointer-events: none;
  z-index: 40;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
}

.tooltip::before {
  content: '';
  position: absolute;
  top: -4px;
  left: 50%;
  transform: translateX(-50%) rotate(45deg);
  width: 8px;
  height: 8px;
  background: rgba(0, 0, 0, 0.8);
}

.icon-btn:hover .tooltip {
  opacity: 1;
  visibility: visible;
}

/* Hamburger menu styling */
.hamburger-btn {
  position: relative;
  width: 40px;
  height: 40px;
  padding: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.hamburger-btn:hover {
  background: rgba(255, 255, 255, 0.25);
}

.hamburger-inner {
  position: relative;
  width: 18px;
  height: 2px;
  background-color: white;
  transition: background-color 0.3s ease;
}

.hamburger-inner::before,
.hamburger-inner::after {
  content: '';
  position: absolute;
  left: 0;
  width: 18px;
  height: 2px;
  background-color: white;
  transition: transform 0.3s ease;
}

.hamburger-inner::before {
  top: -5px;
}

.hamburger-inner::after {
  bottom: -5px;
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
  background: rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  width: 120px;
  margin-right: 10px;
  transition: background-color 0.2s;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.language-select-container:hover {
  background: rgba(255, 255, 255, 0.25);
}

.language-select-container :deep(select) {
  width: 100%;
  padding: 8px 10px;
  padding-right: 28px;
  border: none;
  background: transparent;
  color: white;
  font-size: 0.9rem;
  font-weight: 500;
  appearance: none;
  cursor: pointer;
  height: 36px;
}

.language-select-container :deep(select option) {
  background: #4e97d1;
  color: white;
  padding: 8px;
  font-weight: 500;
}

.select-arrow {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  width: 0;
  height: 0;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-top: 5px solid white;
  pointer-events: none;
}

/* Mobile controls and responsive styles */
.mobile-controls {
  display: none;
  align-items: center;
  margin-left: auto;
}

.mobile-language-select {
  width: 60px;
  margin-left: 8px;
  margin-right: 0;
}

.mobile-btn {
  width: 36px;
  height: 36px;
  margin-left: 8px;
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
    font-size: 1.1rem;
  }
}

@media (max-width: 900px) {
  .brand-name {
    font-size: 1rem;
    max-width: 300px;
  }

  .icon-btn {
    margin-left: 8px;
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
    padding: 0 12px;
  }

  .mobile-language-select :deep(select) {
    width: 100%;
    padding: 8px 10px;
    padding-right: 28px;
    border: none;
    background: transparent;
    color: white;
    font-size: 0.9rem;
    font-weight: 500;
    appearance: none;
    cursor: pointer;
    height: 36px;
  }

  .mobile-language-select :deep(select option) {
    background: #4e97d1;
    color: white;
    padding: 8px;
    font-weight: 500;
  }
}

@media (max-width: 600px) {
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
    margin-left: 6px;
    width: 32px;
    height: 32px;
  }

  .mobile-language-select {
    width: 50px;
    margin-left: 6px;
  }
}

/* Theme Styles - Dark and System Mode */
/* Dark mode - applied to both explicit dark theme and system dark mode */
.nav-bar[data-theme='dark'],
html[data-theme='dark'] .nav-bar,
.nav-bar[data-theme='system'].dark-mode,
html[data-theme='system'].dark-mode .nav-bar {
  background: linear-gradient(135deg, var(--navbar-gradient-start, #1e3a58), var(--navbar-gradient-end, #0f1c2b));
}

/* Buttons and Controls - Dark Mode */
[data-theme='dark'] .icon-btn,
[data-theme='dark'] .hamburger-btn,
[data-theme='dark'] .language-select-container,
html[data-theme='dark'] .icon-btn,
html[data-theme='dark'] .hamburger-btn,
html[data-theme='dark'] .language-select-container,
[data-theme='system'].dark-mode .icon-btn,
[data-theme='system'].dark-mode .hamburger-btn,
[data-theme='system'].dark-mode .language-select-container,
html[data-theme='system'].dark-mode .icon-btn,
html[data-theme='system'].dark-mode .hamburger-btn,
html[data-theme='system'].dark-mode .language-select-container {
  background: rgba(255, 255, 255, 0.08);
}

/* Button Hover States - Dark Mode */
[data-theme='dark'] .icon-btn:hover,
[data-theme='dark'] .hamburger-btn:hover,
[data-theme='dark'] .language-select-container:hover,
html[data-theme='dark'] .icon-btn:hover,
html[data-theme='dark'] .hamburger-btn:hover,
html[data-theme='dark'] .language-select-container:hover,
[data-theme='system'].dark-mode .icon-btn:hover,
[data-theme='system'].dark-mode .hamburger-btn:hover,
[data-theme='system'].dark-mode .language-select-container:hover,
html[data-theme='system'].dark-mode .icon-btn:hover,
html[data-theme='system'].dark-mode .hamburger-btn:hover,
html[data-theme='system'].dark-mode .language-select-container:hover {
  background: rgba(255, 255, 255, 0.15);
}
</style>
