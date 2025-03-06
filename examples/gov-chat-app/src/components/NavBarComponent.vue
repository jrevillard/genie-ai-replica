<!-- NavBarComponent.vue -->
<template>
  <header class="nav-bar">
    <div class="nav-left">
      <!-- Hamburger menu button with animation -->
      <button 
        class="icon-btn hamburger-btn" 
        @click="toggleSidebar"
        :class="{ 'is-active': isSidebarOpen }"
        aria-label="Toggle sidebar"
      >
        <span class="hamburger-inner"></span>
      </button>

      <!-- Brand text or logo -->
      <h1 class="brand-name">{{ $t('brandName') }}</h1>
    </div>

    <!-- Center area: language dropdown -->
    <div class="nav-center">
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
    </div>

    <!-- Right side: analytics + settings + user profile buttons -->
    <div class="nav-right">
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
</template>

<script>
export default {
  name: 'NavBarComponent',
  emits: ['toggleSidebar', 'openAnalytics', 'openProfile', 'openSettings'],
  props: {
    isSidebarOpen: {
      type: Boolean,
      default: true
    }
  },
  data() {
    return {
      currentLocale: this.$i18n.locale
    }
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
    }
  }
}
</script>

<style scoped>
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

.nav-left,
.nav-center,
.nav-right {
  display: flex;
  align-items: center;
}

.nav-left {
  flex: 1;
}

.nav-center {
  flex: 1;
  justify-content: center;
}

.nav-right {
  flex: 1;
  justify-content: flex-end;
  position: relative;
}

.brand-name {
  margin-left: 12px;
  font-size: 1.2rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
@media (max-width: 600px) {
  .nav-center {
    display: none;
  }
  
  .nav-right {
    justify-content: flex-end;
  }
  
  .brand-name {
    font-size: 1rem;
    max-width: 150px;
  }
}
</style>
