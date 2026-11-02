<!-- NavBarComponent.vue with logout button and admin role check -->
<template>
  <div class="nav-container">
    <header class="nav-bar">
      <!-- Left section with hamburger menu, logo, and title -->
      <div class="nav-left">
        <!-- Hamburger button for sidebar toggle -->
        <button class="icon-btn hamburger-btn" @click="toggleSidebar" :class="{ 'is-active': isSidebarOpen }"
          aria-label="Toggle sidebar">
          <span class="hamburger-inner"></span>
        </button>

        <!-- Brand logo — config-driven (L.1: the single Agrivisory mark
             replaced the ITU+FAO+Genie trio; DEC-31) -->
        <div class="logo-container home-link" @click="$emit('goHome')" :title="$t('nav.home', 'Home')">
          <!-- Display image or inline SVG from config; a failed image load
               hides the slot (title carries the brand) rather than showing
               a broken-image glyph -->
          <img
            v-if="config.app.icon.type === 'file' && !logoLoadFailed"
            :src="config.app.icon.value"
            class="govt-logo"
            :alt="config.app.title"
            @error="logoLoadFailed = true"
          />
          <span v-else-if="config.app.icon.type !== 'file'" v-html="config.app.icon.value" class="govt-logo"></span>
        </div>
        <!-- Title from GENIE.AI config - Hide on mobile -->
        <h1 class="brand-name hide-on-mobile home-link" @click="$emit('goHome')">{{ config.app.title }}</h1>

        <!-- Mobile controls - Only shown on mobile devices -->
        <div class="mobile-controls">
          <!-- Status Indicator for Mobile (M.21: admin-only — its data
               fetch is admin-gated) -->
          <div v-if="isAdmin" class="status-indicator-container" ref="mobileStatusContainer">
            <button class="status-indicator-btn mobile-status-btn" @click="toggleStatusDropdown"
              aria-label="System Status">
              <span class="status-dot" :class="getStatusDotClass"></span>
              <span class="tooltip">{{ $t('nav.systemStatus') }}</span>
            </button>

            <!-- Status Dropdown (shared with desktop version) -->
            <div v-if="isStatusDropdownOpen" class="status-dropdown">
              <div class="status-dropdown-header">
                <h4>{{ $t('systemStatus.title') }}</h4>
                <div class="status-summary">
                  <span>{{ totalServices }} {{ $t('systemStatus.services') }}</span>
                </div>
              </div>

              <div class="status-counts">
                <div class="status-count-item">
                  <span class="status-dot status-operational"></span>
                  <span class="status-label">{{ $t('systemStatus.operational') }}</span>
                  <span class="status-value">{{ operationalCount }}</span>
                </div>
                <div class="status-count-item">
                  <span class="status-dot status-degraded"></span>
                  <span class="status-label">{{ $t('systemStatus.degraded') }}</span>
                  <span class="status-value">{{ degradedCount }}</span>
                </div>
                <div class="status-count-item">
                  <span class="status-dot status-outage"></span>
                  <span class="status-label">{{ $t('systemStatus.outage') }}</span>
                  <span class="status-value">{{ outageCount }}</span>
                </div>
              </div>

              <!-- Individual service details when issues exist -->
              <div v-if="servicesWithIssues.length > 0" class="status-issues">
                <div v-for="service in servicesWithIssues" :key="service.name" class="status-issue-item">
                  <span class="status-dot" :class="'status-' + service.status"></span>
                  <div class="issue-details">
                    <span class="issue-service-name">{{ service.name }}</span>
                    <span v-if="service.message" class="issue-message">{{ service.message }}</span>
                  </div>
                </div>
              </div>

              <!-- GPU usage indicator if available -->
              <div v-if="systemStatus.gpuUsage !== null" class="status-gpu-info">
                <div class="gpu-usage-row">
                  <span class="gpu-label">GPU</span>
                  <div class="gpu-bar-container">
                    <div class="gpu-bar" :style="{ width: systemStatus.gpuUsage + '%' }"
                      :class="{ 'gpu-high': systemStatus.gpuUsage >= 90 }"></div>
                  </div>
                  <span class="gpu-value">{{ systemStatus.gpuUsage }}%</span>
                </div>
              </div>

              <div v-if="nextDeadline" class="next-deadline">
                <h4>{{ $t('systemStatus.nextDeadline') }}</h4>
                <div class="deadline-info">
                  <span class="deadline-title">{{ $t('deadlines.taxFiling') }}</span>
                  <span class="deadline-days" :class="{ 'urgent': nextDeadline.daysRemaining < 7 }">
                    {{ nextDeadline.daysRemaining }} {{ $t('systemStatus.days') }}
                  </span>
                </div>
              </div>

              <div class="status-footer">
                <a href="#" @click.prevent="viewStatusPage">
                  {{ $t('systemStatus.viewDetails') }}
                </a>
              </div>
            </div>
          </div>

          <!-- Analytics button for Mobile -->
          <!-- M1.5/CAP-2: hidden (not greyed) for regular users -->
          <button v-if="isManagerOrAbove" class="icon-btn mobile-btn" @click="$emit('openAnalytics')" aria-label="Analytics">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21.21 15.89A10 10 0 1 1 8 2.83"></path>
              <path d="M22 12A10 10 0 0 0 12 2v10z"></path>
            </svg>
            <span class="tooltip">{{ $t('nav.analytics') }}</span>
          </button>

          <!-- Dashboard button for Mobile -->
          <button v-if="isManagerOrAbove" class="icon-btn admin-btn mobile-btn" @click="$emit('openAdmin')" aria-label="Dashboard">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="3" y1="9" x2="21" y2="9"></line>
              <line x1="9" y1="21" x2="9" y2="9"></line>
            </svg>
            <span v-if="pendingUsersCount > 0" class="pending-badge">{{ pendingUsersCount }}</span>
            <span class="tooltip">{{ $t('nav.dashboard', 'Dashboard') }}</span>
          </button>

          <button class="icon-btn mobile-btn" @click="$emit('openSettings')" aria-label="Settings">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"></circle>
              <path
                d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v-.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l-.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z">
              </path>
            </svg>
            <span class="tooltip">{{ $t('nav.settings') }}</span>
          </button>

          <button class="icon-btn user-btn mobile-btn" @click="$emit('openProfile')" aria-label="User profile">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
            <span class="tooltip">{{ $t('nav.userProfile') }}</span>
          </button>

          <!-- M1.5/CAP-3: farmer button merged into the single Profile button above -->

          <!-- ADDED: Logout button for mobile -->
          <button class="icon-btn logout-btn mobile-btn" @click="handleLogout" aria-label="Log out">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
              <polyline points="16 17 21 12 16 7"></polyline>
              <line x1="21" y1="12" x2="9" y2="12"></line>
            </svg>
            <span class="tooltip">{{ $t('nav.logout') }}</span>
          </button>
        </div>
      </div>

      <!-- Main navbar area with status - Only visible on desktop -->
      <div class="nav-main desktop-only">
        <!-- Status Indicator (M.21: admin-only) -->
        <div v-if="isAdmin" class="status-indicator-container" ref="statusContainer">
          <button class="status-indicator-btn" @click="toggleStatusDropdown" aria-label="System Status">
            <span class="status-dot" :class="getStatusDotClass"></span>
            <span class="status-text">{{ statusText }}</span>
            <span class="tooltip">{{ $t('nav.systemStatus') }}</span>
          </button>

          <!-- Status Dropdown -->
          <div v-if="isStatusDropdownOpen" class="status-dropdown">
            <div class="status-dropdown-header">
              <h4>{{ $t('systemStatus.title') }}</h4>
              <div class="status-summary">
                <span>{{ totalServices }} {{ $t('systemStatus.services') }}</span>
              </div>
            </div>

            <div class="status-counts">
              <div class="status-count-item">
                <span class="status-dot status-operational"></span>
                <span class="status-label">{{ $t('systemStatus.operational') }}</span>
                <span class="status-value">{{ operationalCount }}</span>
              </div>
              <div class="status-count-item">
                <span class="status-dot status-degraded"></span>
                <span class="status-label">{{ $t('systemStatus.degraded') }}</span>
                <span class="status-value">{{ degradedCount }}</span>
              </div>
              <div class="status-count-item">
                <span class="status-dot status-outage"></span>
                <span class="status-label">{{ $t('systemStatus.outage') }}</span>
                <span class="status-value">{{ outageCount }}</span>
              </div>
            </div>

            <!-- Individual service details when issues exist -->
            <div v-if="servicesWithIssues.length > 0" class="status-issues">
              <div v-for="service in servicesWithIssues" :key="service.name" class="status-issue-item">
                <span class="status-dot" :class="'status-' + service.status"></span>
                <div class="issue-details">
                  <span class="issue-service-name">{{ service.name }}</span>
                  <span v-if="service.message" class="issue-message">{{ service.message }}</span>
                </div>
              </div>
            </div>

            <!-- GPU usage indicator if available -->
            <div v-if="systemStatus.gpuUsage !== null" class="status-gpu-info">
              <div class="gpu-usage-row">
                <span class="gpu-label">GPU</span>
                <div class="gpu-bar-container">
                  <div class="gpu-bar" :style="{ width: systemStatus.gpuUsage + '%' }"
                    :class="{ 'gpu-high': systemStatus.gpuUsage >= 90 }"></div>
                </div>
                <span class="gpu-value">{{ systemStatus.gpuUsage }}%</span>
              </div>
              <div v-if="systemStatus.gpuMemory !== null" class="gpu-usage-row">
                <span class="gpu-label">VRAM</span>
                <div class="gpu-bar-container">
                  <div class="gpu-bar" :style="{ width: systemStatus.gpuMemory + '%' }"
                    :class="{ 'gpu-high': systemStatus.gpuMemory >= 90 }"></div>
                </div>
                <span class="gpu-value">{{ systemStatus.gpuMemory }}%</span>
              </div>
            </div>

            <div v-if="nextDeadline" class="next-deadline">
              <h4>{{ $t('systemStatus.nextDeadline') }}</h4>
              <div class="deadline-info">
                <span class="deadline-title">{{ $t('deadlines.taxFiling') }}</span>
                <span class="deadline-days" :class="{ 'urgent': nextDeadline.daysRemaining < 7 }">
                  {{ nextDeadline.daysRemaining }} {{ $t('systemStatus.days') }}
                </span>
              </div>
            </div>

            <div class="status-footer">
              <a href="#" @click.prevent="viewStatusPage">
                {{ $t('systemStatus.viewDetails') }}
              </a>
            </div>
          </div>
        </div>
      </div>

      <!-- Right section with user controls - Only visible on desktop -->
      <div class="nav-right desktop-only">
        <!-- Analytics button for Desktop -->
        <button v-if="isManagerOrAbove" class="icon-btn" @click="$emit('openAnalytics')" aria-label="Analytics">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21.21 15.89A10 10 0 1 1 8 2.83"></path>
            <path d="M22 12A10 10 0 0 0 12 2v10z"></path>
          </svg>
          <span class="tooltip">{{ $t('nav.analytics') }}</span>
        </button>

        <!-- Dashboard button for Desktop -->
        <button v-if="isManagerOrAbove" class="icon-btn admin-btn" @click="$emit('openAdmin')" aria-label="Dashboard">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="3" y1="9" x2="21" y2="9"></line>
            <line x1="9" y1="21" x2="9" y2="9"></line>
          </svg>
          <span v-if="pendingUsersCount > 0" class="pending-badge">{{ pendingUsersCount }}</span>
          <span class="tooltip">{{ $t('nav.dashboard', 'Dashboard') }}</span>
        </button>

        <button class="icon-btn" @click="$emit('openSettings')" aria-label="Settings">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path
              d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v-.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z">
            </path>
          </svg>
          <span class="tooltip">{{ $t('nav.settings') }}</span>
        </button>

        <button class="icon-btn user-btn" @click="$emit('openProfile')" aria-label="User profile">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
            <circle cx="12" cy="7" r="4"></circle>
          </svg>
          <span class="tooltip">{{ $t('nav.userProfile') }}</span>
        </button>

        <!-- M1.5/CAP-3: farmer button merged into the single Profile button above -->

        <!-- ADDED: Logout button -->
        <button class="icon-btn logout-btn" @click="handleLogout" aria-label="Log out">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
            <polyline points="16 17 21 12 16 7"></polyline>
            <line x1="21" y1="12" x2="9" y2="12"></line>
          </svg>
          <span class="tooltip">{{ $t('nav.logout') }}</span>
        </button>
      </div>
    </header>
  </div>
</template>

<script>
export default {
  name: 'NavBarComponent',
  emits: ['toggleSidebar', 'openAnalytics', 'openProfile', 'openSettings', 'viewStatusPage', 'logout', 'openAdmin', 'goHome'],
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
    // (L.1: fallback brand = Agrivisory, matching main.js — never Huduma)
    config: {
      type: Object,
      required: true,
      default: () => ({
        app: { title: 'Agrivisory-Lesotho', icon: { type: 'file', value: '/config/agrivisory-logo.webp' } },
        theme: { navbar: { textColor: '#ffffff' } }
      })
    }
  },
  data() {
    return {
      isStatusDropdownOpen: false,
      logoLoadFailed: false, // L.1: hide the brand img on load error (spec acceptance row)
      pendingUsersCount: 0,
      systemStatus: {
        overall: 'operational',
        services: [],
        gpuUsage: null,
        gpuMemory: null
      },
      nextDeadline: {
        titleKey: '',
        daysRemaining: 0
      }
    }
  },
  computed: {
    operationalCount() {
      return this.systemStatus.services.filter(s => s.status === 'operational').length;
    },
    degradedCount() {
      return this.systemStatus.services.filter(s => s.status === 'degraded').length;
    },
    outageCount() {
      return this.systemStatus.services.filter(s => s.status === 'outage').length;
    },
    totalServices() {
      return this.systemStatus.services.length;
    },
    servicesWithIssues() {
      return this.systemStatus.services.filter(s => s.status !== 'operational');
    },
    getStatusDotClass() {
      switch (this.systemStatus.overall) {
        case 'operational': return 'status-operational';
        case 'degraded': return 'status-degraded';
        case 'outage': return 'status-outage';
        default: return '';
      }
    },
    statusText() {
      // Show in user's language
      switch (this.systemStatus.overall) {
        case 'operational': return this.$t('systemStatus.allOperational');
        case 'degraded': return this.$t('systemStatus.someIssues');
        case 'outage': return this.$t('systemStatus.majorIssues');
        default: return this.$t('systemStatus.checking');
      }
    },
    // A4: user comes from the Vuex auth module (OIDC claims) — the legacy
    // localStorage 'user' key no longer exists
    currentUser() {
      return this.$store.getters.currentUser;
    },
    // Compute if the user has admin role (case-insensitive, like isManagerOrAbove)
    isAdmin() {
      const roles = this.currentUser?.roles || [];
      return roles.some((role) => role.toLowerCase() === 'admin');
    },
    // Compute if the user has manager-level access (Manager, AI Engineer, or Admin)
    isManagerOrAbove() {
      const roles = this.currentUser?.roles || [];
      const managerLevelRoles = ['manager', 'ai engineer', 'admin'];
      return roles.some((role) => managerLevelRoles.includes(role.toLowerCase()));
    }
  },
  watch: {
    // Watch for locale changes and close/reopen dropdown to force refresh
    '$i18n.locale'(newLocale) {
      this.currentLocale = newLocale;

      // Only do this if the dropdown is open
      if (this.isStatusDropdownOpen) {
        // Briefly close and reopen to force re-render with new translations
        const wasOpen = this.isStatusDropdownOpen;
        this.isStatusDropdownOpen = false;

        // Use nextTick to ensure Vue updates the DOM first
        this.$nextTick(() => {
          if (wasOpen) {
            // Small delay to ensure DOM updates
            setTimeout(() => {
              this.isStatusDropdownOpen = true;
            }, 50);
          }
        });
      }
    }
  },
  mounted() {
    // Close dropdown when clicking outside
    document.addEventListener('click', this.handleClickOutside);

    // Only fetch system status if we're not in the middle of an OAuth callback
    // (i.e., the URL has a 'code' param indicating token exchange is in progress)
    const urlParams = new URLSearchParams(window.location.search);
    if (!urlParams.has('code')) {
      this.fetchSystemStatus();
      this.fetchPendingUsersCount();
    }
  },
  beforeUnmount() {
    document.removeEventListener('click', this.handleClickOutside);
  },

  methods: {
//Logout handler — Vuex 'logout' drives the OIDC signoutRedirect
    //(id_token_hint + legacy-key scrub); there is no local /login route anymore
    async handleLogout() {
      try {
        this.$emit('logout');
        await this.$store.dispatch('logout');
      } catch (error) {
        console.error('Logout error:', error);
        this.$emit('logout');
      }
    },
    toggleSidebar() {
      this.$emit('toggleSidebar')
    },
    toggleStatusDropdown() {
      this.isStatusDropdownOpen = !this.isStatusDropdownOpen;
    },
    handleClickOutside(event) {
      // Handle both desktop and mobile status containers
      const desktopContainer = this.$refs.statusContainer;
      const mobileContainer = this.$refs.mobileStatusContainer;

      if ((desktopContainer && !desktopContainer.contains(event.target)) &&
        (mobileContainer && !mobileContainer.contains(event.target))) {
        this.isStatusDropdownOpen = false;
      }
    },
    viewStatusPage() {
      this.$emit('openAdmin');
      this.isStatusDropdownOpen = false;
    },
    async fetchSystemStatus() {
      try {
        // Don't fetch if we're in the middle of an OAuth callback
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('code')) return;

        if (!this.$store.getters.isAuthenticated) return;
        // Audit F7: /admin/system-health is admin-only — every non-admin was
        // 403-toasting + staring at a dead status dot on every page load.
        if (!this.isAdmin) return;
        const adminDashboardService = require('../services/adminDashboardService').default;
        const data = await adminDashboardService.getSystemHealth();
        if (data && data.healthServices) {
          this.systemStatus.services = data.healthServices.map(s => ({
            name: s.name,
            status: s.status === 'good' ? 'operational' : s.status === 'warning' ? 'degraded' : 'outage',
            message: s.message || null
          }));
          const hasOutage = this.systemStatus.services.some(s => s.status === 'outage');
          const hasDegraded = this.systemStatus.services.some(s => s.status === 'degraded');
          this.systemStatus.overall = hasOutage ? 'outage' : hasDegraded ? 'degraded' : 'operational';
        }
        // Update GPU usage from resource data
        if (data && data.resourceUsage) {
          this.systemStatus.gpuUsage = data.resourceUsage.gpu !== undefined ? data.resourceUsage.gpu : null;
          this.systemStatus.gpuMemory = data.resourceUsage.gpuMemory !== undefined ? data.resourceUsage.gpuMemory : null;
        }
      } catch (error) {
        console.warn('Failed to fetch system status:', error.message);
      }
    },
    async fetchPendingUsersCount() {
      try {
        // Only fetch for admin users
        if (!this.isAdmin) return;

        const adminDashboardService = require('../services/adminDashboardService').default;
        this.pendingUsersCount = await adminDashboardService.getPendingUsersCount();
      } catch (error) {
        console.warn('Failed to fetch pending users count:', error.message);
      }
    }
  }
}
</script>

<style scoped>
/* Base styles - applied to all themes */
.nav-container {
  position: relative;
}

/* Navbar styling — M1.5/CAP-1: solid ITU blue #001489 (both themes; the old
   config gradient vars and the dark-mode gradient override are retired) */
.nav-bar {
  display: flex;
  align-items: center;
  background: #001489;
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

/* Home link - clickable logo and title */
.home-link {
  cursor: pointer;
  transition: opacity 0.2s ease, transform 0.15s ease;
}

.home-link:hover {
  opacity: 0.85;
  transform: scale(1.03);
}

/* Brand logo slot (L.1: bare, no chip — DEC-31 option A) */
.logo-container {
  display: flex;
  align-items: center;
  margin-left: 8px;
}

/* Config-driven logo. Height-keyed so non-square marks (the Agrivisory
   shield) keep their aspect ratio. Applies to the file-type <img>; an
   inline-SVG config (span branch, unused by every shipped config) sizes
   by its own viewBox, unchanged from before. */
.govt-logo {
  height: 40px;
  width: auto;
  max-width: none;
  color: white;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2));
  transition: transform 0.3s ease;
}

.logo-container:hover .govt-logo {
  transform: scale(1.08);
}

/* Logo animations */
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideDown {
  from { transform: translateY(-10px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

@keyframes pulse {
  0% { opacity: 0.8; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.08); }
  100% { opacity: 0.8; transform: scale(1); }
}

@keyframes rotateIn {
  from { transform: rotate(-15deg); opacity: 0; }
  to { transform: rotate(0deg); opacity: 1; }
}

@keyframes shimmer {
  0% { stroke-dashoffset: 200; }
  100% { stroke-dashoffset: 0; }
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

/* Status Indicator */
.status-indicator-container {
  position: relative;
  margin-left: auto;
  margin-right: 10px;
}

.status-indicator-btn {
  display: flex;
  align-items: center;
  background: rgba(255, 255, 255, 0.15);
  border: none;
  color: white;
  height: 36px;
  padding: 0 14px;
  border-radius: 6px;
  cursor: pointer;
  position: relative;
  font-size: 0.85rem;
  transition: all 0.2s ease;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}


.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-right: 8px;
  transition: transform 0.2s ease;
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.2);
}

.status-indicator-btn:hover .status-dot {
  transform: scale(1.1);
}

.status-text {
  white-space: nowrap;
  font-weight: 500;
}

.status-operational {
  background-color: #10b981; /* Green */
}

.status-degraded {
  background-color: #f59e0b; /* Yellow/Orange */
}

.status-outage {
  background-color: #ef4444; /* Red */
}

/* Status Dropdown */
.status-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 260px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  color: #333;
  font-size: 0.85rem;
  z-index: 30;
  overflow: hidden;
  animation: dropdownFadeIn 0.2s ease-out;
}

@keyframes dropdownFadeIn {
  from { opacity: 0; transform: translateY(-10px); }
  to { opacity: 1; transform: translateY(0); }
}

.status-dropdown-header {
  padding: 14px 16px;
  border-bottom: 1px solid #eee;
  background: #f8f9fa;
}

.status-dropdown-header h4 {
  margin: 0 0 6px 0;
  font-weight: 600;
  color: #333;
  font-size: 1rem;
}

.status-summary {
  display: flex;
  justify-content: space-between;
  color: #666;
  font-size: 0.8rem;
}

.status-counts {
  padding: 12px 16px;
  border-bottom: 1px solid #eee;
}

.status-count-item {
  display: flex;
  align-items: center;
  margin-bottom: 10px;
  padding: 4px 0;
  transition: background-color 0.2s;
  border-radius: 4px;
}

.status-count-item:hover {
  background-color: #f8f9fa;
}

.status-count-item:last-child {
  margin-bottom: 0;
}

.status-label {
  flex: 1;
  margin-left: 8px;
  color: #555;
}

.status-value {
  font-weight: 600;
  color: #333;
  background: #f5f5f5;
  border-radius: 12px;
  min-width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 8px;
}

.next-deadline {
  padding: 14px 16px;
  border-bottom: 1px solid #eee;
}

.next-deadline h4 {
  margin: 0 0 8px 0;
  font-weight: 600;
  color: #333;
  font-size: 1rem;
}

.deadline-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  border-radius: 4px;
}

.deadline-info:hover {
  background-color: #f8f9fa;
}

.deadline-title {
  color: #555;
}

.deadline-days {
  font-weight: 600;
  color: #2563eb; /* Blue */
  background: #eef2ff;
  padding: 4px 10px;
  border-radius: 12px;
}

.deadline-days.urgent {
  color: #ef4444; /* Red */
  background: #fee2e2;
}

.status-footer {
  padding: 12px 16px;
  text-align: center;
  background: #f9fafb;
}

.status-footer a {
  color: #2563eb;
  text-decoration: none;
  font-size: 0.9rem;
  font-weight: 500;
  padding: 6px 12px;
  border-radius: 4px;
  transition: background-color 0.2s;
  display: inline-block;
}

.status-footer a:hover {
  text-decoration: none;
  background-color: #e0e7ff;
}

/* Service issues list */
.status-issues {
  padding: 10px 16px;
  border-bottom: 1px solid #eee;
  max-height: 180px;
  overflow-y: auto;
}

.status-issue-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 0;
}

.status-issue-item + .status-issue-item {
  border-top: 1px solid #f3f4f6;
}

.status-issue-item .status-dot {
  margin-top: 4px;
  flex-shrink: 0;
}

.issue-details {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.issue-service-name {
  font-weight: 500;
  color: #333;
  font-size: 0.82rem;
}

.issue-message {
  font-size: 0.75rem;
  color: #6b7280;
  line-height: 1.3;
  word-wrap: break-word;
}

/* GPU usage indicator */
.status-gpu-info {
  padding: 10px 16px;
  border-bottom: 1px solid #eee;
}

.gpu-usage-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.gpu-usage-row:last-child {
  margin-bottom: 0;
}

.gpu-label {
  font-size: 0.75rem;
  font-weight: 500;
  color: #6b7280;
  min-width: 35px;
}

.gpu-bar-container {
  flex: 1;
  height: 6px;
  background: #e5e7eb;
  border-radius: 3px;
  overflow: hidden;
}

.gpu-bar {
  height: 100%;
  background: #10b981;
  border-radius: 3px;
  transition: width 0.3s ease;
}

.gpu-bar.gpu-high {
  background: #f59e0b;
}

.gpu-value {
  font-size: 0.75rem;
  font-weight: 600;
  color: #333;
  min-width: 32px;
  text-align: right;
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

/* M.6: bar stays blue on hover — no bg/transform change (tooltips remain) */
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
.icon-btn:disabled, .disabled-btn {
  opacity: 0.5;
  cursor: not-allowed;
  background: rgba(255, 255, 255, 0.05);
  box-shadow: none;
}

.icon-btn:disabled:hover, .disabled-btn:hover {
  transform: none;
  background: rgba(255, 255, 255, 0.05);
  box-shadow: none;
}

.icon-btn:disabled svg, .disabled-btn svg {
  opacity: 0.6;
}

.icon-btn:disabled:hover svg, .disabled-btn:hover svg {
  transform: none;
}

/* Logout button styling */
.logout-btn {
  background: rgba(255, 255, 255, 0.1);
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
  transition: opacity 0.2s, visibility 0.2s;
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

.status-indicator-btn .tooltip {
  bottom: -34px;
}

.status-indicator-btn:hover .tooltip {
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


/* Mobile controls and responsive styles */
.mobile-controls {
  display: none;
  align-items: center;
  margin-left: auto;
}

.mobile-status-btn {
  padding: 0;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  justify-content: center;
}

.mobile-status-btn .status-dot {
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

  .status-text {
    font-size: 0.8rem;
  }
}

@media (max-width: 900px) {
  .status-text {
    display: none;
  }

  .status-indicator-btn {
    padding: 0 10px;
    width: 36px;
  }

  .status-dot {
    margin-right: 0;
  }

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
    width: auto;
  }

  .nav-bar {
    padding: 0 12px;
  }

  .status-dropdown {
    width: 240px;
    right: -40px;
  }

  .status-dropdown::before {
    content: '';
    position: absolute;
    top: -4px;
    right: 50px;
    width: 8px;
    height: 8px;
    background: white;
    transform: rotate(45deg);
  }
}

@media (max-width: 600px) {
  .govt-logo {
    height: 32px;
    width: auto;
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
    width: auto;
  }

  .nav-bar {
    height: 54px;
  }

  /* Position status dropdown on small screens */
  .status-dropdown {
    width: 220px;
    right: -30px;
  }

  .status-dropdown::before {
    right: 40px;
  }

  /* Space mobile controls more compactly */
  .mobile-btn {
    margin-left: 6px;
    width: 32px;
    height: 32px;
  }

  .mobile-status-btn {
    width: 32px;
    height: 32px;
  }
}

/* Theme Styles - Dark and System Mode */
/* Dark mode - applied to both explicit dark theme and system dark mode */
/* M1.5/CAP-1: dark-mode gradient override removed — the bar is solid ITU
   blue #001489 in every theme */

/* Buttons and Controls - Dark Mode */
[data-theme="dark"] .icon-btn,
[data-theme="dark"] .hamburger-btn,
[data-theme="dark"] .status-indicator-btn,
html[data-theme="dark"] .icon-btn,
html[data-theme="dark"] .hamburger-btn,
html[data-theme="dark"] .status-indicator-btn,
[data-theme="system"].dark-mode .icon-btn,
[data-theme="system"].dark-mode .hamburger-btn,
[data-theme="system"].dark-mode .status-indicator-btn,
html[data-theme="system"].dark-mode .icon-btn,
html[data-theme="system"].dark-mode .hamburger-btn,
html[data-theme="system"].dark-mode .status-indicator-btn {
  background: rgba(255, 255, 255, 0.08);
}


/* Status Dropdown - Dark Mode */
[data-theme="dark"] .status-dropdown,
html[data-theme="dark"] .status-dropdown,
[data-theme="system"].dark-mode .status-dropdown,
html[data-theme="system"].dark-mode .status-dropdown {
  background: #1f2937;
  border: 1px solid #374151;
}

[data-theme="dark"] .status-dropdown-header,
html[data-theme="dark"] .status-dropdown-header,
[data-theme="system"].dark-mode .status-dropdown-header,
html[data-theme="system"].dark-mode .status-dropdown-header {
  background: #111827;
  border-bottom: 1px solid #374151;
}

[data-theme="dark"] .status-dropdown-header h4,
[data-theme="dark"] .next-deadline h4,
html[data-theme="dark"] .status-dropdown-header h4,
html[data-theme="dark"] .next-deadline h4,
[data-theme="system"].dark-mode .status-dropdown-header h4,
[data-theme="system"].dark-mode .next-deadline h4,
html[data-theme="system"].dark-mode .status-dropdown-header h4,
html[data-theme="system"].dark-mode .next-deadline h4 {
  color: rgba(255, 255, 255, 0.9);
}

[data-theme="dark"] .status-dropdown .status-label,
[data-theme="dark"] .deadline-title,
html[data-theme="dark"] .status-dropdown .status-label,
html[data-theme="dark"] .deadline-title,
[data-theme="system"].dark-mode .status-dropdown .status-label,
[data-theme="system"].dark-mode .deadline-title,
html[data-theme="system"].dark-mode .status-dropdown .status-label,
html[data-theme="system"].dark-mode .deadline-title {
  color: rgba(255, 255, 255, 0.7);
}

[data-theme="dark"] .status-summary,
html[data-theme="dark"] .status-summary,
[data-theme="system"].dark-mode .status-summary,
html[data-theme="system"].dark-mode .status-summary {
  color: rgba(255, 255, 255, 0.5);
}

[data-theme="dark"] .status-count-item:hover,
[data-theme="dark"] .deadline-info:hover,
html[data-theme="dark"] .status-count-item:hover,
html[data-theme="dark"] .deadline-info:hover,
[data-theme="system"].dark-mode .status-count-item:hover,
[data-theme="system"].dark-mode .deadline-info:hover,
html[data-theme="system"].dark-mode .status-count-item:hover,
html[data-theme="system"].dark-mode .deadline-info:hover {
  background-color: #111827;
}

[data-theme="dark"] .status-value,
html[data-theme="dark"] .status-value,
[data-theme="system"].dark-mode .status-value,
html[data-theme="system"].dark-mode .status-value {
  background: #374151;
  color: rgba(255, 255, 255, 0.9);
}

[data-theme="dark"] .status-footer,
html[data-theme="dark"] .status-footer,
[data-theme="system"].dark-mode .status-footer,
html[data-theme="system"].dark-mode .status-footer {
  background: #111827;
  border-top: 1px solid #374151;
}

[data-theme="dark"] .status-footer a,
html[data-theme="dark"] .status-footer a,
[data-theme="system"].dark-mode .status-footer a,
html[data-theme="system"].dark-mode .status-footer a {
  color: #60a5fa;
}

[data-theme="dark"] .status-footer a:hover,
html[data-theme="dark"] .status-footer a:hover,
[data-theme="system"].dark-mode .status-footer a:hover,
html[data-theme="system"].dark-mode .status-footer a:hover {
  background-color: #1e3a58;
}

/* Fix dropdown arrow in dark mode */
[data-theme="dark"] .status-dropdown::before,
html[data-theme="dark"] .status-dropdown::before,
[data-theme="system"].dark-mode .status-dropdown::before,
html[data-theme="system"].dark-mode .status-dropdown::before {
  background: #111827;
}

/* Dark mode: Status issues and GPU info */
[data-theme="dark"] .status-issues,
html[data-theme="dark"] .status-issues,
[data-theme="system"].dark-mode .status-issues,
html[data-theme="system"].dark-mode .status-issues {
  border-bottom-color: #374151;
}

[data-theme="dark"] .issue-service-name,
html[data-theme="dark"] .issue-service-name,
[data-theme="system"].dark-mode .issue-service-name,
html[data-theme="system"].dark-mode .issue-service-name {
  color: rgba(255, 255, 255, 0.9);
}

[data-theme="dark"] .issue-message,
html[data-theme="dark"] .issue-message,
[data-theme="system"].dark-mode .issue-message,
html[data-theme="system"].dark-mode .issue-message {
  color: rgba(255, 255, 255, 0.5);
}

[data-theme="dark"] .status-gpu-info,
html[data-theme="dark"] .status-gpu-info,
[data-theme="system"].dark-mode .status-gpu-info,
html[data-theme="system"].dark-mode .status-gpu-info {
  border-bottom-color: #374151;
}

[data-theme="dark"] .gpu-label,
html[data-theme="dark"] .gpu-label,
[data-theme="system"].dark-mode .gpu-label,
html[data-theme="system"].dark-mode .gpu-label {
  color: rgba(255, 255, 255, 0.6);
}

[data-theme="dark"] .gpu-value,
html[data-theme="dark"] .gpu-value,
[data-theme="system"].dark-mode .gpu-value,
html[data-theme="system"].dark-mode .gpu-value {
  color: rgba(255, 255, 255, 0.9);
}

[data-theme="dark"] .gpu-bar-container,
html[data-theme="dark"] .gpu-bar-container,
[data-theme="system"].dark-mode .gpu-bar-container,
html[data-theme="system"].dark-mode .gpu-bar-container {
  background: #374151;
}

[data-theme="dark"] .status-issue-item + .status-issue-item,
html[data-theme="dark"] .status-issue-item + .status-issue-item,
[data-theme="system"].dark-mode .status-issue-item + .status-issue-item,
html[data-theme="system"].dark-mode .status-issue-item + .status-issue-item {
  border-top-color: #374151;
}

/* Pending users notification badge on admin button */
.admin-btn {
  position: relative;
}

.pending-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  background-color: #ef4444;
  color: white;
  font-size: 0.65rem;
  font-weight: 700;
  height: 18px;
  min-width: 18px;
  padding: 0 4px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  animation: badgePulse 2s ease-in-out infinite;
}

@keyframes badgePulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.1); }
}
</style>