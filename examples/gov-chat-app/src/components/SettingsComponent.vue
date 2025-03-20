<template>
  <div class="settings-overlay">
    <div class="settings-dialog">
      <h2 class="dialog-header">Settings</h2>
      
      <!-- Language Section -->
      <div class="settings-section">
        <h3 class="section-title">Language</h3>
        <div class="setting-item">
          <label class="section-label">Display Language</label>
          <select 
            class="dropdown"
            v-model="settings.language"
          >
            <option value="en">English</option>
            <option value="fr">French</option>
            <option value="sw">Swahili</option>
          </select>
        </div>
      </div>
      
      <!-- Appearance Section -->
      <div class="settings-section">
        <h3 class="section-title">Appearance</h3>
        
        <div class="setting-item">
          <label class="section-label">Theme</label>
          <div class="theme-buttons">
            <button 
              class="theme-toggle"
              :class="{ active: settings.theme === 'light' }"
              @click="applyTheme('light')"
            >
              Light
            </button>
            <button 
              class="theme-toggle"
              :class="{ active: settings.theme === 'dark' }"
              @click="applyTheme('dark')"
            >
              Dark
            </button>
            <button 
              class="theme-toggle"
              :class="{ active: settings.theme === 'system' }"
              @click="applyTheme('system')"
            >
              System
            </button>
          </div>
        </div>
        
        <div class="setting-item">
          <label class="section-label">Font Size</label>
          <div class="slider-container">
            <input 
              type="range" 
              min="30" 
              max="100" 
              v-model.number="settings.fontSize" 
              class="slider"
            />
            <span class="slider-value">{{ settings.fontSize }}%</span>
          </div>
        </div>
      </div>
      
      <!-- Notifications Section -->
      <div class="settings-section">
        <h3 class="section-title">Notifications</h3>
        
        <div class="setting-item">
          <label class="section-label">Email updates</label>
          <div 
            class="switch"
            @click="settings.emailUpdates = !settings.emailUpdates"
          >
            <div class="switch-track" :class="{ active: settings.emailUpdates }">
              <div class="switch-thumb"></div>
            </div>
          </div>
        </div>
        
        <div class="setting-item">
          <label class="section-label">Sound notifications</label>
          <div 
            class="switch"
            @click="settings.soundNotifications = !settings.soundNotifications"
          >
            <div class="switch-track" :class="{ active: settings.soundNotifications }">
              <div class="switch-thumb"></div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Account Section -->
      <div class="settings-section">
        <h3 class="section-title">Account</h3>
        
        <div class="setting-item">
          <button 
            class="btn-secondary"
            @click="confirmResetUserData"
          >
            Reset User Data
          </button>
          <p class="reset-description">This will clear all your profile data and chat history.</p>
        </div>
      </div>
      
      <!-- Footer Buttons -->
      <div class="dialog-footer">
        <button 
          class="btn-close"
          @click="close"
        >
          Close
        </button>
        <button 
          class="btn-save"
          @click="save"
        >
          Save Settings
        </button>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'SettingsComponent',
  data() {
    return {
      // Initialize with current app settings
      settings: {
        language: this.$i18n ? this.$i18n.locale : 'en',
        theme: document.documentElement.getAttribute('data-theme') || 'light',
        fontSize: this.getSavedFontSize(),
        emailUpdates: this.getSavedPreference('emailUpdates', false),
        soundNotifications: this.getSavedPreference('soundNotifications', true)
      }
    }
  },
  methods: {
    // NEW METHOD - Apply theme immediately upon button click
    applyTheme(theme) {
      console.log('Theme button clicked:', theme);
      
      // Update local state
      this.settings.theme = theme;
      
      // Apply theme immediately to see the change
      document.documentElement.setAttribute('data-theme', theme);
      document.body.setAttribute('data-theme', theme);
      
      // Also save to localStorage immediately for instant persistence
      try {
        localStorage.setItem('theme', theme);
      } catch (e) {
        console.warn('Error saving theme:', e);
      }
      
      // Inform parent component about theme change
      this.$emit('themeChanged', theme);
    },
    
    // Get saved font size or default to 50%
    getSavedFontSize() {
      try {
        const fontSize = localStorage.getItem('fontSize')
        return fontSize ? parseInt(fontSize) : 50
      } catch (e) {
        console.warn('Error accessing localStorage:', e)
        return 50
      }
    },
    
    // Get saved preference with fallback
    getSavedPreference(key, defaultValue) {
      try {
        const value = localStorage.getItem(key)
        return value !== null ? JSON.parse(value) : defaultValue
      } catch (e) {
        console.warn(`Error accessing localStorage for ${key}:`, e)
        return defaultValue
      }
    },
    
    // Close without saving
    close() {
      this.$emit('close')
    },
    
    // Save settings and close
    save() {
      // Save language preference
      if (this.$i18n) {
        this.$i18n.locale = this.settings.language
        try {
          localStorage.setItem('userLocale', this.settings.language)
        } catch (e) {
          console.warn('Error saving language preference:', e)
        }
      }
      
      // Ensure theme is applied and saved
      document.documentElement.setAttribute('data-theme', this.settings.theme);
      document.body.setAttribute('data-theme', this.settings.theme);
      try {
        localStorage.setItem('theme', this.settings.theme);
      } catch (e) {
        console.warn('Error saving theme preference:', e);
      }
      
      // Save font size
      try {
        localStorage.setItem('fontSize', this.settings.fontSize.toString())
        // Apply font size to root element
        document.documentElement.style.fontSize = `${this.settings.fontSize / 50}rem`
      } catch (e) {
        console.warn('Error saving font size:', e)
      }
      
      // Save notification preferences
      try {
        localStorage.setItem('emailUpdates', JSON.stringify(this.settings.emailUpdates))
        localStorage.setItem('soundNotifications', JSON.stringify(this.settings.soundNotifications))
      } catch (e) {
        console.warn('Error saving notification preferences:', e)
      }
      
      // Emit theme change event to parent for global handling
      this.$emit('themeChanged', this.settings.theme);
      
      // Close dialog
      this.$emit('close')
    },
    
    // Show confirmation dialog before resetting user data
    confirmResetUserData() {
      if (confirm('Are you sure you want to reset all user data? This cannot be undone.')) {
        this.resetUserData()
      }
    },
    
    // Reset all user data
    resetUserData() {
      try {
        // Clear all localStorage items except theme and language
        const themeValue = localStorage.getItem('theme')
        const langValue = localStorage.getItem('userLocale')
        
        localStorage.clear()
        
        // Restore theme and language
        if (themeValue) localStorage.setItem('theme', themeValue)
        if (langValue) localStorage.setItem('userLocale', langValue)
        
        // Inform user
        alert('User data has been reset.')
      } catch (e) {
        console.error('Error clearing user data:', e)
        alert('Failed to reset user data.')
      }
    }
  }
}
</script>

<style scoped>
/* Settings dialog styling */
.settings-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.settings-dialog {
  width: 500px;
  max-width: 90vw;
  max-height: 90vh;
  overflow-y: auto;
  border-radius: 8px;
  background-color: var(--bg-dialog, #ffffff);
  color: var(--text-primary, #333333);
  box-shadow: var(--shadow-lg, 0 10px 15px rgba(0, 0, 0, 0.1));
}

.dialog-header {
  padding: 1.5rem;
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
  border-bottom: 1px solid var(--border-color, #dcdfe4);
  color: var(--text-primary, #333333);
}

.settings-section {
  padding: 1.5rem;
  border-bottom: 1px solid var(--border-color, #dcdfe4);
}

.section-title {
  margin-top: 0;
  margin-bottom: 1.5rem;
  font-size: 1.25rem;
  font-weight: 500;
  color: var(--text-primary, #333333);
}

.setting-item {
  margin-bottom: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.section-label {
  font-size: 1rem;
  font-weight: 400;
  color: var(--text-secondary, #4d4d4d);
}

/* Theme buttons styling */
.theme-buttons {
  display: flex;
  gap: 0.5rem;
}

.theme-toggle {
  flex: 1;
  padding: 0.75rem;
  border-radius: 4px;
  cursor: pointer;
  text-align: center;
  font-weight: 500;
  transition: all 0.2s;
  background-color: var(--bg-button-secondary, #e9ecef);
  color: var(--text-button-secondary, #4d4d4d);
  border: 1px solid var(--border-color, #dcdfe4);
}

.theme-toggle.active {
  background-color: var(--bg-button-primary, #4E97D1);
  color: var(--text-button-primary, #ffffff);
  border-color: var(--bg-button-primary, #4E97D1);
}

/* Dropdown styling */
.dropdown {
  width: 100%;
  padding: 0.5rem;
  border-radius: 4px;
  background-color: var(--bg-input, #ffffff);
  color: var(--text-primary, #333333);
  border: 1px solid var(--border-input, #dcdfe4);
}

/* Slider styling */
.slider-container {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.slider {
  flex: 1;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: var(--slider-track, #e9ecef);
  outline: none;
  border-radius: 2px;
}

.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--slider-thumb, #4E97D1);
  cursor: pointer;
}

.slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--slider-thumb, #4E97D1);
  cursor: pointer;
  border: none;
}

.slider-value {
  min-width: 3rem;
  text-align: right;
  color: var(--text-primary, #333333);
}

/* Switch toggle */
.switch {
  position: relative;
  display: inline-block;
  width: 50px;
  height: 24px;
  cursor: pointer;
}

.switch-track {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--switch-track-off, #d0d0d0);
  border-radius: 12px;
  transition: .4s;
}

.switch-thumb {
  position: absolute;
  height: 20px;
  width: 20px;
  left: 2px;
  bottom: 2px;
  background-color: var(--switch-thumb, #ffffff);
  border-radius: 50%;
  transition: .4s;
}

.switch-track.active .switch-thumb {
  transform: translateX(26px);
}

.switch-track.active {
  background-color: var(--switch-track-on, #4E97D1);
}

/* Buttons */
.btn-close, 
.btn-save,
.btn-secondary {
  padding: 0.75rem 1.5rem;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 500;
  border: none;
  transition: all 0.2s;
}

.btn-secondary {
  background-color: var(--bg-button-secondary, #e9ecef);
  color: var(--text-button-secondary, #4d4d4d);
  border: 1px solid var(--border-color, #dcdfe4);
}

.btn-save {
  background-color: var(--bg-button-primary, #4E97D1);
  color: var(--text-button-primary, #ffffff);
}

.btn-close {
  background-color: var(--bg-button-secondary, #e9ecef);
  color: var(--text-button-secondary, #4d4d4d);
}

.reset-description {
  margin-top: 0.5rem;
  font-size: 0.875rem;
  color: var(--text-tertiary, #767676);
}

/* Footer buttons */
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 1rem;
  padding: 1.5rem;
}
</style>