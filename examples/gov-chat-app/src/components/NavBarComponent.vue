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

      <!-- Government services logo -->
      <div class="logo-container">
        <svg class="govt-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
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
      
      <!-- Guided Assistance Dropdown moved next to logo -->
      <div class="guided-assistance-container">
        <select 
          v-model="selectedTask" 
          @change="handleTaskSelection"
          class="guided-assistance-select"
          :class="{ 'has-value': selectedTask }"
        >
          <option value="" disabled selected>{{ $t('quickHelp', 'How can I help?') }}</option>
          <option value="id">ID & Passport Services</option>
          <option value="tax">Tax Services</option>
          <option value="business">Business Registration</option>
          <option value="education">Education Services</option>
          <option value="health">Healthcare Services</option>
          <option value="other">Other Services</option>
        </select>
        <div class="select-arrow"></div>
      </div>
    </div>

    <!-- Center area: Brand name is now in the center -->
    <div class="nav-center">
      <h1 class="brand-name">{{ $t('brandName') }}</h1>
    </div>

    <!-- Right side: language dropdown + analytics + settings + user profile buttons -->
    <div class="nav-right">
      <!-- Language dropdown moved to the right -->
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
</template>

<script>
export default {
  name: 'NavBarComponent',
  emits: ['toggleSidebar', 'openAnalytics', 'openProfile', 'openSettings', 'taskSelected'],
  props: {
    isSidebarOpen: {
      type: Boolean,
      default: true
    }
  },
  data() {
    return {
      currentLocale: this.$i18n.locale,
      selectedTask: ''
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
    },
    handleTaskSelection() {
      // Emit the selected task to parent component
      this.$emit('taskSelected', this.selectedTask);
      
      // Reset the dropdown after selection (optional)
      // You can comment this out if you want the selection to remain visible
      setTimeout(() => {
        this.selectedTask = '';
      }, 500);
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
  flex: 1.5; /* Increased to give more space for the guided assistance */
  min-width: 140px;
}

.nav-center {
  flex: 1;
  justify-content: center;
  text-align: center;
}

.nav-right {
  flex: 1;
  justify-content: flex-end;
  position: relative;
}

/* Logo styling */
.logo-container {
  display: flex;
  align-items: center;
  margin-left: 8px;
  margin-right: 10px; /* Added margin to separate from guided assistance */
}

.govt-logo {
  height: 32px;
  width: 32px;
  color: white;
}

.brand-name {
  margin: 0 auto;
  font-size: 1.2rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Guided Assistance Dropdown */
.guided-assistance-container {
  position: relative;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  min-width: 180px;
  max-width: 250px;
  flex-grow: 1;
}

.guided-assistance-select {
  width: 100%;
  padding: 6px 12px;
  padding-right: 30px;
  border: none;
  background: transparent;
  color: white;
  font-size: 0.9rem;
  appearance: none;
  cursor: pointer;
  border-radius: 4px;
  height: 32px;
}

.guided-assistance-select.has-value {
  background: rgba(255, 255, 255, 0.2);
}

.guided-assistance-select option {
  background: #4E97D1;
  color: white;
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
  .guided-assistance-container {
    min-width: 150px;
  }
  
  .guided-assistance-select {
    font-size: 0.85rem;
  }
}

@media (max-width: 768px) {
  .brand-name {
    font-size: 1rem;
  }
  
  .language-select-container {
    width: 100px;
  }
  
  .guided-assistance-container {
    min-width: 120px;
  }
  
  .guided-assistance-select {
    padding: 4px 8px;
    padding-right: 20px;
    font-size: 0.8rem;
  }
}

@media (max-width: 600px) {
  .nav-left {
    min-width: auto;
    flex: 2;
  }
  
  .nav-center {
    display: none; /* Hide brand name on very small screens */
  }
  
  .guided-assistance-container {
    min-width: 110px;
    max-width: none;
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
</style>
