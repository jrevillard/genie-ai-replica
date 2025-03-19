<!-- NavBarComponent.vue with logout button -->
<template>
  <div class="nav-container">
    <header class="nav-bar">
      <!-- Left section with hamburger menu, logo, and title -->
      <div class="nav-left">
        <!-- Existing code for hamburger menu, logo, and title -->
        <button class="icon-btn hamburger-btn" @click="toggleSidebar" :class="{ 'is-active': isSidebarOpen }"
          aria-label="Toggle sidebar">
          <span class="hamburger-inner"></span>
        </button>

        <div class="logo-container">
          <!-- Animated Government Logo - Size adjusted to match control buttons -->
          <svg class="govt-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="40" height="40">
            <defs>
              <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#4E97D1" />
                <stop offset="100%" stop-color="#2C5F8A" />
              </linearGradient>
              <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>

            <!-- Background circle -->
            <circle cx="50" cy="50" r="30" fill="#f0f9ff" class="logo-base" />

            <!-- Building base -->
            <rect x="25" y="65" width="50" height="5" fill="#2C5F8A" class="logo-steps" />

            <!-- Steps -->
            <rect x="30" y="60" width="40" height="5" fill="#3A7DA0" class="logo-steps" />
            <rect x="35" y="55" width="30" height="5" fill="#4E97D1" class="logo-steps" />

            <!-- Pillars -->
            <rect x="38" y="30" width="6" height="25" fill="#2C5F8A" class="logo-pillars" />
            <rect x="47" y="30" width="6" height="25" fill="#3A7DA0" class="logo-pillars" />
            <rect x="56" y="30" width="6" height="25" fill="#2C5F8A" class="logo-pillars" />

            <!-- Roof/Pediment -->
            <path d="M32 30 L68 30 L50 18 Z" fill="#4E97D1" class="logo-roof" />

            <!-- Star symbolizing service -->
            <g class="logo-star" filter="url(#glow)">
              <path d="M50 12 L52 17 L58 17 L53 21 L55 26 L50 22 L45 26 L47 21 L42 17 L48 17 Z" fill="#FFD700" />
            </g>

            <!-- Glow effect -->
            <circle cx="50" cy="50" r="31" fill="none" stroke="#4E97D1" stroke-width="1.5" opacity="0.5"
              class="logo-glow" />

            <!-- Animated outline -->
            <path d="M32 30 L68 30 L50 18 Z M38 30 L38 55 M47 30 L47 55 M56 30 L56 55" fill="none" stroke="white"
              stroke-width="1.2" class="logo-outline" />
          </svg>
        </div>
        <!-- Title moved to left, adjacent to logo - Hide on mobile -->
        <h1 class="brand-name hide-on-mobile">{{ $t('brandName') }}</h1>

        <!-- Mobile controls - Only shown on mobile devices -->
        <div class="mobile-controls">
          <!-- Existing mobile controls code -->
          <!-- Status Indicator for Mobile -->
          <div class="status-indicator-container" ref="mobileStatusContainer">
            <button class="status-indicator-btn mobile-status-btn" @click="toggleStatusDropdown"
              aria-label="System Status">
              <span class="status-dot" :class="getStatusDotClass"></span>
              <span class="tooltip">{{ $t('nav.systemStatus') }}</span>
            </button>

            <!-- Status Dropdown (shared with desktop version) -->
            <div v-if="isStatusDropdownOpen" class="status-dropdown">
              <!-- Existing dropdown content -->
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

          <!-- Language Selector for Mobile -->
          <div class="language-select-container mobile-language-select">
            <select v-model="currentLocale" @change="changeLocale" aria-label="Change language" class="language-select">
              <option value="en">EN</option>
              <option value="fr">FR</option>
              <option value="sw">SW</option>
            </select>
            <div class="select-arrow"></div>
          </div>

          <!-- Other mobile controls -->
          <button class="icon-btn mobile-btn" @click="$emit('openAnalytics')" aria-label="Analytics">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21.21 15.89A10 10 0 1 1 8 2.83"></path>
              <path d="M22 12A10 10 0 0 0 12 2v10z"></path>
            </svg>
            <span class="tooltip">{{ $t('nav.analytics') }}</span>
          </button>

          <button class="icon-btn mobile-btn" @click="$emit('openSettings')" aria-label="Settings">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"></circle>
              <path
                d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z">
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
        <!-- Status Indicator -->
        <div class="status-indicator-container" ref="statusContainer">
          <button class="status-indicator-btn" @click="toggleStatusDropdown" aria-label="System Status">
            <span class="status-dot" :class="getStatusDotClass"></span>
            <span class="status-text">{{ statusText }}</span>
            <span class="tooltip">{{ $t('nav.systemStatus') }}</span>
          </button>

          <!-- Status Dropdown -->
          <div v-if="isStatusDropdownOpen" class="status-dropdown">
            <!-- Existing dropdown content -->
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

      <!-- Right section with language and user controls - Only visible on desktop -->
      <div class="nav-right desktop-only">
        <div class="language-select-container">
          <select v-model="currentLocale" @change="changeLocale" aria-label="Change language" class="language-select">
            <option value="en">English</option>
            <option value="fr">Français</option>
            <option value="sw">Kiswahili</option>
          </select>
          <div class="select-arrow"></div>
        </div>

        <button class="icon-btn" @click="$emit('openAnalytics')" aria-label="Analytics">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21.21 15.89A10 10 0 1 1 8 2.83"></path>
            <path d="M22 12A10 10 0 0 0 12 2v10z"></path>
          </svg>
          <span class="tooltip">{{ $t('nav.analytics') }}</span>
        </button>

        <button class="icon-btn" @click="$emit('openSettings')" aria-label="Settings">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path
              d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z">
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
  emits: ['toggleSidebar', 'openAnalytics', 'openProfile', 'openSettings', 'viewStatusPage', 'logout'],
  props: {
    isSidebarOpen: {
      type: Boolean,
      default: true
    },
    sidebarWidth: {
      type: Number,
      default: 250 // Default sidebar width in pixels
    }
  },
  data() {
    return {
      currentLocale: this.$i18n.locale,
      isStatusDropdownOpen: false,
      // Sample system status data - would be fetched from an API
      systemStatus: {
        overall: 'degraded', // 'operational', 'degraded', or 'outage'
        services: [
          { name: 'eCitizen Portal', status: 'operational' },
          { name: 'Tax Filing System', status: 'degraded' },
          { name: 'ID Application', status: 'outage' },
          { name: 'Business Registration', status: 'operational' },
          { name: 'Driving License', status: 'operational' }
        ]
      },
      // Sample next deadline - would be personalized
      nextDeadline: {
        titleKey: 'taxFiling',
        daysRemaining: 12
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

    // In a real app, you would fetch the system status from an API here
    // this.fetchSystemStatus();
  },
  beforeUnmount() {
    document.removeEventListener('click', this.handleClickOutside);
  },
  methods: {
  // FIXED: Logout handler that properly handles errors
  async handleLogout() {
  try {
    console.log('Logout started');
    
    // Clear local storage first - this is the most important part
    localStorage.removeItem('user');
    
    // Try to call the logout API, but don't await it to prevent navigation issues
    if (this.$store && this.$store.dispatch) {
      // Use a timeout to prevent blocking the UI
      setTimeout(() => {
        try {
          this.$store.dispatch('logout').catch(err => console.error('API logout error:', err));
        } catch (e) {
          console.error('Store dispatch error:', e);
        }
      }, 0);
    }
    
    // Emit the event before navigation
    this.$emit('logout');
    
    // Navigate using window.location instead of Vue Router for a cleaner break
    console.log('Redirecting to login page');
    window.location.href = '/login';
    
  } catch (error) {
    console.error('Logout error:', error);
    
    // Still clear storage and redirect on error
    localStorage.removeItem('user');
    window.location.href = '/login';
  }
},
  changeLocale() {
    // Use the global method defined in main.js if available
    if (this.$setLocale) {
      this.$setLocale(this.currentLocale);
    } else {
      this.$i18n.locale = this.currentLocale;
      
      // Save preference
      try {
        localStorage.setItem('userLocale', this.currentLocale);
      } catch (e) {
        console.warn('Unable to save locale preference:', e);
      }
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
    this.$emit('viewStatusPage');
    this.isStatusDropdownOpen = false;
  }
}}
</script>

<style scoped>
/* All existing styles */
.nav-container {
  position: relative;
}

.nav-bar {
  display: flex;
  align-items: center;
  background: linear-gradient(135deg, #4E97D1, #2C5F8A);
  color: #fff;
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

/* Logo styling and animations - Enhanced */
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

/* Logo animations - More noticeable */
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

.status-indicator-btn:hover {
  background: rgba(255, 255, 255, 0.25);
  transform: translateY(-1px);
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
  background-color: #10b981;
  /* Green */
}

.status-degraded {
  background-color: #f59e0b;
  /* Yellow/Orange */
}

.status-outage {
  background-color: #ef4444;
  /* Red */
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
  from {
    opacity: 0;
    transform: translateY(-10px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
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
  color: #2563eb;
  /* Blue */
  background: #eef2ff;
  padding: 4px 10px;
  border-radius: 12px;
}

.deadline-days.urgent {
  color: #ef4444;
  /* Red */
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

/* Improved button styling */
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

/* ADDED: Logout button styling */
.logout-btn {
  background: rgba(255, 255, 255, 0.1);
}

.logout-btn:hover {
  background-color: rgba(239, 68, 68, 0.25);
  /* Subtle red on hover */
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

/* Improved hamburger menu styling with centered elements */
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
  /* Ensure centered */
}

.hamburger-btn.is-active .hamburger-inner::before {
  transform: translateY(5px) rotate(45deg);
  top: 0;
  /* Ensure centered */
}

.hamburger-btn.is-active .hamburger-inner::after {
  transform: translateY(-5px) rotate(-45deg);
  bottom: 0;
  /* Ensure centered */
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

.language-select {
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

.language-select option {
  background: #4E97D1;
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
    width: 36px;
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

  .mobile-language-select {
    width: 50px;
    margin-left: 6px;
  }
}
</style>