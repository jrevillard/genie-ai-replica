<!-- SettingsComponent.vue -->
<template>
  <div class="settings-modal">
    <div class="overlay" @click="closeDialog"></div>
    <div class="modal-content">
      <h2>{{ $t('settings.title') }}</h2>
      
      <div class="settings-sections">
        <!-- Language Settings -->
        <div class="settings-section">
          <h3>{{ $t('settings.language.title') }}</h3>
          <div class="setting-item">
            <label for="language-select">{{ $t('settings.language.selectLabel') }}</label>
            <select id="language-select" v-model="selectedLanguage" @change="changeLanguage">
              <option value="en">English</option>
              <option value="fr">Français</option>
              <option value="sw">Kiswahili</option>
            </select>
          </div>
        </div>

        <!-- Appearance Settings -->
        <div class="settings-section">
          <h3>{{ $t('settings.appearance.title') }}</h3>
          <div class="setting-item">
            <label>{{ $t('settings.appearance.theme') }}</label>
            <div class="theme-options">
              <button 
                class="theme-btn" 
                :class="{ active: selectedTheme === 'light' }" 
                @click="setTheme('light')"
              >
                {{ $t('settings.appearance.lightTheme') }}
              </button>
              <button 
                class="theme-btn" 
                :class="{ active: selectedTheme === 'dark' }" 
                @click="setTheme('dark')"
              >
                {{ $t('settings.appearance.darkTheme') }}
              </button>
              <button 
                class="theme-btn" 
                :class="{ active: selectedTheme === 'system' }" 
                @click="setTheme('system')"
              >
                {{ $t('settings.appearance.systemTheme') }}
              </button>
            </div>
          </div>
          <div class="setting-item">
            <label>{{ $t('settings.appearance.fontSize') }}</label>
            <div class="font-size-slider">
              <input 
                type="range" 
                min="80" 
                max="120" 
                step="10" 
                v-model="fontSizePercent" 
                @change="changeFontSize"
              />
              <span>{{ fontSizePercent }}%</span>
            </div>
          </div>
        </div>
        
        <!-- Notifications Settings -->
        <div class="settings-section">
          <h3>{{ $t('settings.notifications.title') }}</h3>
          <div class="setting-item">
            <div class="toggle-wrapper">
              <label for="email-notifications">{{ $t('settings.notifications.emailUpdates') }}</label>
              <label class="toggle">
                <input 
                  type="checkbox" 
                  id="email-notifications" 
                  v-model="notifications.email"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
          <div class="setting-item">
            <div class="toggle-wrapper">
              <label for="sound-notifications">{{ $t('settings.notifications.soundEnabled') }}</label>
              <label class="toggle">
                <input 
                  type="checkbox" 
                  id="sound-notifications" 
                  v-model="notifications.sound"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
        </div>
        
        <!-- Account Settings Section -->
        <div class="settings-section">
          <h3>{{ $t('settings.account.title') }}</h3>
          <div class="setting-item">
            <button class="secondary-btn" @click="resetUserData">
              {{ $t('settings.account.resetUserData') }}
            </button>
            <p class="setting-description">
              {{ $t('settings.account.resetDescription') }}
            </p>
          </div>
        </div>
      </div>
      
      <div class="actions">
        <button class="cancel-btn" @click="closeDialog">{{ $t('settings.close') }}</button>
        <button class="save-btn" @click="saveSettings">{{ $t('settings.save') }}</button>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'SettingsComponent',
  data() {
    return {
      selectedLanguage: this.$i18n.locale,
      selectedTheme: 'light',
      fontSizePercent: 100,
      notifications: {
        email: false,
        sound: true
      }
    }
  },
  mounted() {
    // Load saved settings if available
    this.loadSettings();
  },
  methods: {
    closeDialog() {
      this.$emit('close');
    },
    changeLanguage() {
      this.$i18n.locale = this.selectedLanguage;
      // For persistence across sessions (Optional: if you have this in main.js)
      try {
        localStorage.setItem('userLocale', this.selectedLanguage);
      } catch (e) {
        console.warn('Could not save language preference', e);
      }
    },
    setTheme(theme) {
      this.selectedTheme = theme;
      document.documentElement.setAttribute('data-theme', theme);
      
      if (theme === 'system') {
        // Check system preference
        const isDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', isDarkMode ? 'dark' : 'light');
      }
    },
    changeFontSize() {
      document.documentElement.style.fontSize = `${this.fontSizePercent}%`;
    },
    resetUserData() {
      if (confirm(this.$t('settings.account.confirmReset'))) {
        // Here you would reset user data in your actual implementation
        console.log('User data reset requested');
        alert(this.$t('settings.account.resetComplete'));
      }
    },
    saveSettings() {
      // Save settings to localStorage for persistence
      try {
        const settings = {
          theme: this.selectedTheme,
          fontSizePercent: this.fontSizePercent,
          notifications: this.notifications
        };
        localStorage.setItem('appSettings', JSON.stringify(settings));
        alert(this.$t('settings.saveSuccess'));
      } catch (e) {
        console.warn('Could not save settings', e);
        alert(this.$t('settings.saveError'));
      }
      
      this.closeDialog();
    },
    loadSettings() {
      try {
        const savedSettings = localStorage.getItem('appSettings');
        if (savedSettings) {
          const settings = JSON.parse(savedSettings);
          this.selectedTheme = settings.theme || 'light';
          this.fontSizePercent = settings.fontSizePercent || 100;
          this.notifications = settings.notifications || { email: false, sound: true };
          
          // Apply settings
          this.setTheme(this.selectedTheme);
          this.changeFontSize();
        }
      } catch (e) {
        console.warn('Could not load settings', e);
      }
    }
  }
}
</script>

<style scoped>
.settings-modal {
  position: fixed;
  top: 0; left: 0;
  width: 100%;
  height: 100%;
  z-index: 9999;
}
.overlay {
  position: absolute;
  width: 100%;
  height: 100%;
  background: rgba(0,0,0,0.5);
}
.modal-content {
  position: relative;
  background: #fff;
  width: 600px;
  max-width: 90%;
  margin: 40px auto;
  padding: 20px;
  border-radius: 8px;
  overflow-y: auto;
  max-height: 90vh;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}
h2, h3 {
  color: #333;
  margin-top: 0;
}
h3 {
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid #eee;
}
.settings-sections {
  margin-bottom: 20px;
}
.settings-section {
  margin-bottom: 24px;
}
.setting-item {
  margin-bottom: 16px;
}
label {
  display: block;
  margin-bottom: 6px;
  font-weight: 500;
}
select, input[type="text"] {
  width: 100%;
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: #fff;
}
.theme-options {
  display: flex;
  gap: 8px;
}
.theme-btn {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #ddd;
  background: #f5f5f5;
  border-radius: 4px;
  cursor: pointer;
}
.theme-btn.active {
  background: #4E97D1;
  color: white;
  border-color: #3A7DA0;
}
.font-size-slider {
  display: flex;
  align-items: center;
  gap: 12px;
}
.font-size-slider input {
  flex: 1;
}
.toggle-wrapper {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.toggle {
  position: relative;
  display: inline-block;
  width: 50px;
  height: 24px;
}
.toggle input {
  opacity: 0;
  width: 0;
  height: 0;
}
.toggle-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #ccc;
  transition: .4s;
  border-radius: 24px;
}
.toggle-slider:before {
  position: absolute;
  content: "";
  height: 16px;
  width: 16px;
  left: 4px;
  bottom: 4px;
  background-color: white;
  transition: .4s;
  border-radius: 50%;
}
input:checked + .toggle-slider {
  background-color: #4E97D1;
}
input:checked + .toggle-slider:before {
  transform: translateX(26px);
}
.setting-description {
  margin-top: 6px;
  font-size: 0.85rem;
  color: #666;
}
.secondary-btn {
  padding: 8px 12px;
  background: #f5f5f5;
  border: 1px solid #ddd;
  border-radius: 4px;
  cursor: pointer;
}
.secondary-btn:hover {
  background: #e5e5e5;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}
.cancel-btn, .save-btn {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
.cancel-btn {
  background: #ccc;
  color: #333;
}
.cancel-btn:hover {
  background: #bbb;
}
.save-btn {
  background: #4E97D1;
  color: #fff;
}
.save-btn:hover {
  background: #3a7da0;
}
</style>
