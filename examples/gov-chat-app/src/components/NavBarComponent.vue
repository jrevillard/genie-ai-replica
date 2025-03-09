<!-- NavBarComponent.vue -->
<template>
  <div class="nav-container">
    <header class="nav-bar">
      <!-- Left section with hamburger menu, logo, and title -->
      <div class="nav-left">
        <button 
          class="icon-btn hamburger-btn" 
          @click="toggleSidebar"
          :class="{ 'is-active': isSidebarOpen }"
          aria-label="Toggle sidebar"
        >
          <span class="hamburger-inner"></span>
        </button>

        <div class="logo-container">
          <svg class="govt-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32">
            <path d="M3 22h18" stroke-linecap="round"/>
            <path d="M12 2L2 8h20L12 2z" />
            <rect x="4" y="10" width="16" height="12" stroke-linecap="round" stroke-linejoin="round" />
            <line x1="4" y1="10" x2="4" y2="22" />
            <line x1="20" y1="10" x2="20" y2="22" />
            <line x1="8" y1="10" x2="8" y2="22" />
            <line x1="12" y1="10" x2="12" y2="22" />
            <line x1="16" y1="10" x2="16" y2="22" />
          </svg>
        </div>
        
        <!-- Title moved to left, adjacent to logo -->
        <h1 class="brand-name">{{ $t('brandName') }}</h1>
      </div>
      
      <!-- Main navbar area with status -->
      <div class="nav-main">
        <!-- Status Indicator -->
        <div class="status-indicator-container" ref="statusContainer">
          <button 
            class="status-indicator-btn" 
            @click="toggleStatusDropdown"
            aria-label="System Status"
          >
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
            
            <div v-if="nextDeadline" class="next-deadline">
              <h4>{{ $t('systemStatus.nextDeadline') }}</h4>
              <div class="deadline-info">
                <span class="deadline-title">{{ $t('deadlines.taxFiling') }}</span>
                <span 
                  class="deadline-days"
                  :class="{'urgent': nextDeadline.daysRemaining < 7}"
                >
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

      <!-- Right section with language and user controls -->
      <div class="nav-right">
        <div class="language-select-container">
          <select 
            v-model="currentLocale" 
            @change="changeLocale" 
            aria-label="Change language"
            class="language-select"
          >
            <option value="en">English</option>
            <option value="fr">Français</option>
            <option value="sw">Kiswahili</option>
          </select>
          <div class="select-arrow"></div>
        </div>

        <button 
          class="icon-btn" 
          @click="$emit('openAnalytics')"
          aria-label="Analytics"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21.21 15.89A10 10 0 1 1 8 2.83"></path>
            <path d="M22 12A10 10 0 0 0 12 2v10z"></path>
          </svg>
          <span class="tooltip">{{ $t('nav.analytics') }}</span>
        </button>
        
        <button 
          class="icon-btn"
          @click="$emit('openSettings')"
          aria-label="Settings"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
          <span class="tooltip">{{ $t('nav.settings') }}</span>
        </button>
        
        <button 
          class="icon-btn user-btn" 
          @click="$emit('openProfile')"
          aria-label="User profile"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
            <circle cx="12" cy="7" r="4"></circle>
          </svg>
          <span class="tooltip">{{ $t('nav.userProfile') }}</span>
        </button>
      </div>
    </header>
  </div>
</template>

<script>
export default {
  name: 'NavBarComponent',
  emits: ['toggleSidebar', 'openAnalytics', 'openProfile', 'openSettings', 'viewStatusPage'],
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
      switch(this.systemStatus.overall) {
        case 'operational': return 'status-operational';
        case 'degraded': return 'status-degraded';
        case 'outage': return 'status-outage';
        default: return '';
      }
    },
    statusText() {
      // Show in user's language
      switch(this.systemStatus.overall) {
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
      const container = this.$refs.statusContainer;
      if (container && !container.contains(event.target)) {
        this.isStatusDropdownOpen = false;
      }
    },
    viewStatusPage() {
      this.$emit('viewStatusPage');
      this.isStatusDropdownOpen = false;
    }
  }
}
</script>

<style scoped>
.nav-container {
  position: relative;
}

.nav-bar {
  display: flex;
  align-items: center;
  background: linear-gradient(135deg, #4E97D1, #3A7DA0);
  color: #fff;
  height: 60px;
  padding: 0 16px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
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
}

/* Logo styling */
.logo-container {
  display: flex;
  align-items: center;
  margin-left: 8px;
}

.govt-logo {
  height: 32px;
  width: 32px;
  color: white;
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
  background: rgba(255, 255, 255, 0.1);
  border: none;
  color: white;
  height: 32px;
  padding: 0 12px;
  border-radius: 4px;
  cursor: pointer;
  position: relative;
  font-size: 0.85rem;
}

.status-indicator-btn:hover {
  background: rgba(255, 255, 255, 0.15);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
}

.status-text {
  white-space: nowrap;
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
  top: calc(100% + 4px);
  right: 0;
  width: 240px;
  background: white;
  border-radius: 4px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  color: #333;
  font-size: 0.85rem;
  z-index: 30;
  overflow: hidden;
}

.status-dropdown-header {
  padding: 10px 12px;
  border-bottom: 1px solid #eee;
}

.status-dropdown-header h4 {
  margin: 0 0 4px 0;
  font-weight: 600;
  color: #333;
  font-size: 0.9rem;
}

.status-summary {
  display: flex;
  justify-content: space-between;
  color: #666;
  font-size: 0.8rem;
}

.status-counts {
  padding: 8px 12px;
  border-bottom: 1px solid #eee;
}

.status-count-item {
  display: flex;
  align-items: center;
  margin-bottom: 6px;
}

.status-count-item:last-child {
  margin-bottom: 0;
}

.status-label {
  flex: 1;
  margin-left: 6px;
  color: #555;
}

.status-value {
  font-weight: 500;
  color: #333;
}

.next-deadline {
  padding: 10px 12px;
  border-bottom: 1px solid #eee;
}

.next-deadline h4 {
  margin: 0 0 6px 0;
  font-weight: 600;
  color: #333;
  font-size: 0.9rem;
}

.deadline-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.deadline-title {
  color: #555;
}

.deadline-days {
  font-weight: 500;
  color: #2563eb; /* Blue */
}

.deadline-days.urgent {
  color: #ef4444; /* Red */
}

.status-footer {
  padding: 8px 12px;
  text-align: center;
  background: #f9fafb;
}

.status-footer a {
  color: #2563eb;
  text-decoration: none;
  font-size: 0.8rem;
}

.status-footer a:hover {
  text-decoration: underline;
}

/* Improved button styling */
.icon-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: 8px;
  position: relative;
  transition: background-color 0.2s;
  color: white;
}

.icon-btn:hover {
  background-color: rgba(255, 255, 255, 0.1);
}

.icon-btn svg {
  width: 24px;
  height: 24px;
}

/* Tooltip styling */
.tooltip {
  position: absolute;
  bottom: -30px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.7);
  color: white;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  white-space: nowrap;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.2s, visibility 0.2s;
  pointer-events: none;
  z-index: 30;
}

.icon-btn:hover .tooltip {
  opacity: 1;
  visibility: visible;
}

.status-indicator-btn .tooltip {
  bottom: -30px;
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
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.hamburger-inner {
  position: relative;
  width: 18px;
  height: 2px;
  background-color: white;
  transition: background-color 0.2s;
}

.hamburger-inner::before,
.hamburger-inner::after {
  content: '';
  position: absolute;
  width: 18px;
  height: 2px;
  background-color: white;
  transition: transform 0.3s;
}

.hamburger-inner::before {
  top: -5px;
}

.hamburger-inner::after {
  bottom: -5px;
}

.hamburger-btn.is-active .hamburger-inner {
  background-color: transparent;
}

.hamburger-btn.is-active .hamburger-inner::before {
  transform: translateY(5px) rotate(45deg);
}

.hamburger-btn.is-active .hamburger-inner::after {
  transform: translateY(-5px) rotate(-45deg);
}

/* Language dropdown styling */
.language-select-container {
  position: relative;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  width: 120px;
  margin-right: 8px;
}

.language-select {
  width: 100%;
  padding: 6px 8px;
  padding-right: 24px;
  border: none;
  background: transparent;
  color: white;
  font-size: 0.9rem;
  appearance: none;
  cursor: pointer;
  height: 32px;
}

.language-select option {
  background: #4E97D1;
  color: white;
}

.select-arrow {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  width: 0;
  height: 0;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-top: 5px solid white;
  pointer-events: none;
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
    padding: 0 8px;
    width: 32px;
  }
  
  .status-dot {
    margin-right: 0;
  }
  
  .brand-name {
    font-size: 1rem;
    max-width: 300px;
  }
}

@media (max-width: 768px) {
  .brand-name {
    font-size: 0.9rem;
    max-width: 200px;
  }
  
  .language-select-container {
    width: 100px;
  }
}

@media (max-width: 600px) {
  .brand-name {
    max-width: 150px;
  }
  
  .language-select-container {
    width: 80px;
  }
  
  .language-select {
    font-size: 0.8rem;
    padding: 4px 6px;
    padding-right: 20px;
  }
}

@media (max-width: 480px) {
  .brand-name {
    max-width: 120px;
  }
}
</style>
