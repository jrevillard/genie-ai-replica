<template>
  <div class="settings-overlay">
    <div
      class="settings-dialog"
      :key="'settings-dialog-' + currentLocale"
      :style="dialogThemeStyles"
    >
      <div class="dialog-header">
        <h2 class="header-title" :data-themed="isThemeReady">
          {{ translate("settings.title", "Settings") }}
        </h2>
        <div class="header-actions">
          <button class="btn-close" @click="close">
            {{ translate("settings.close", "Close") }}
          </button>
          <button class="btn-save" @click="save">
            {{ translate("settings.saveSettings", "Save Settings") }}
          </button>
        </div>
      </div>

      <div v-if="isLoading" class="loading-overlay">
        <div class="loading-spinner"></div>
        <p>
          {{
            translate("settings.loadingUserInfo", "Loading user information...")
          }}
        </p>
      </div>

      <div v-else-if="errorMessage" class="error-container">
        <p class="error-message">{{ errorMessage }}</p>
        <button @click="fetchUserData" class="btn-retry">
          {{ translate("settings.retry", "Retry") }}
        </button>
      </div>

      <div v-else>
        <div class="settings-grid">
          <div class="settings-box">
            <h3 class="section-title">
              {{ translate("settings.display", "Display") }}
            </h3>

            <div class="setting-item">
              <label class="section-label">{{
                translate("settings.displayLanguage", "Display Language")
              }}</label>
              <!-- M.4: LanguageSelector manages $i18n.locale + persistence
                   itself; the old v-model here was a no-op prop -->
              <language-selector />
            </div>

            <div class="setting-item">
              <label class="section-label">{{
                translate("settings.theme", "Theme")
              }}</label>
              <div class="theme-buttons">
                <button
                  class="theme-toggle"
                  :class="{ active: settings.theme === 'light' }"
                  @click="applyTheme('light')"
                >
                  {{ translate("settings.themes.light", "Light") }}
                </button>
                <button
                  class="theme-toggle"
                  :class="{ active: settings.theme === 'dark' }"
                  @click="applyTheme('dark')"
                >
                  {{ translate("settings.themes.dark", "Dark") }}
                </button>
              </div>
            </div>

            <div class="setting-item">
              <label class="section-label">{{
                translate("settings.fontSize", "Font Size")
              }}</label>
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

          <div class="settings-box">
            <h3 class="section-title">
              {{ translate("settings.notifications", "Notifications") }}
            </h3>

            <div class="setting-item">
              <div class="toggle-row">
                <label class="section-label">{{
                  translate("settings.emailUpdates", "Email Updates")
                }}</label>
                <div
                  class="switch"
                  @click="settings.emailUpdates = !settings.emailUpdates"
                >
                  <div
                    class="switch-track"
                    :class="{ active: settings.emailUpdates }"
                  >
                    <div class="switch-thumb"></div>
                  </div>
                </div>
              </div>
            </div>

            <div class="setting-item">
              <div class="toggle-row">
                <label class="section-label">{{
                  translate(
                    "settings.soundNotifications",
                    "Sound Notifications"
                  )
                }}</label>
                <div
                  class="switch"
                  @click="
                    settings.soundNotifications = !settings.soundNotifications
                  "
                >
                  <div
                    class="switch-track"
                    :class="{ active: settings.soundNotifications }"
                  >
                    <div class="switch-thumb"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
// Import the user service to handle user-related API calls and data management
import userService from "@/services/userService";

// Import the notifications service to display user feedback messages (success, error, info)
import notificationService from "@/services/notificationService";

// Import the theme manager utilities to handle theme application and persistence
import { themeManager } from "@/utils/ThemeManager";

// Import LanguageSelector component
import LanguageSelector from "@/components/LanguageSelector.vue";

export default {
  name: "SettingsComponent",
  components: {
    LanguageSelector,
  },
  data() {
    return {
      currentLocale: this.$i18n ? this.$i18n.locale : "en",
      isLoading: true,
      errorMessage: null,
      isThemeReady: false,
      currentUserId: "",
      themeEnforcementInterval: null, // Track interval ID here
      settings: {
        language: this.getCurrentLanguage(),
        theme: this.getCurrentTheme(),
        fontSize: this.getSavedFontSize(),
        emailUpdates: this.getSavedPreference("emailUpdates", false),
        soundNotifications: this.getSavedPreference("soundNotifications", true),
      },
      userData: {
        name: "",
        email: "",
        accountType: "",
        userId: "",
        createdAt: "",
      },
      userAvatar: null,
    };
  },
  computed: {
    isDarkMode() {
      console.log(
        "[SETTINGS] Computing isDarkMode, settings.theme:",
        this.settings.theme
      );
      return this.settings.theme === "dark";
    },
    dialogThemeStyles() {
      const isDark = this.isDarkMode;
      console.log("[SETTINGS] Computing dialogThemeStyles, isDark:", isDark);
      return {
        "--dialog-background": isDark ? "#2a2a2a" : "#ffffff",
        "--dialog-title-color": isDark ? "#f0f0f0" : "#333333",
        "--dialog-text-color": isDark ? "rgba(255, 255, 255, 0.8)" : "#666666",
        "--dialog-border-color": isDark ? "#3a3a3a" : "#dcdfe4",
        "--dialog-box-shadow": isDark
          ? "0 4px 12px rgba(0, 0, 0, 0.4)"
          : "0 4px 12px rgba(0, 0, 0, 0.15)",
        "--dialog-overlay-background": isDark
          ? "rgba(0, 0, 0, 0.7)"
          : "rgba(0, 0, 0, 0.5)",
      };
    },
  },
  created() {
    console.log("[SETTINGS] Initializing currentLocale...");
    this.currentLocale = this.$i18n ? this.$i18n.locale : "en";
    console.log("[SETTINGS] currentLocale initialized to:", this.currentLocale);

    console.log("[SETTINGS] Component created, fetching user data...");
    this.fetchUserData();

    console.log("[SETTINGS] Initial settings.theme:", this.settings.theme);
    console.log(
      "[SETTINGS] Initial DOM data-theme:",
      document.documentElement.getAttribute("data-theme")
    );

    console.log("[SETTINGS] Setting up watcher for settings.language...");
    this.$watch("settings.language", (newVal) => {
      console.log("[SETTINGS] settings.language changed to:", newVal);
      if (this.$i18n) {
        console.log("[SETTINGS] Updating i18n locale...");
        this.$i18n.locale = newVal;
        console.log("[SETTINGS] Updating currentLocale to:", newVal);
        this.currentLocale = newVal;
        console.log(
          "[SETTINGS] Forcing component re-render for language update..."
        );
        this.$forceUpdate();
        if (this.$root) {
          console.log("[SETTINGS] Forcing root component re-render...");
          this.$root.$forceUpdate();
        }
      }
    });

    console.log("[SETTINGS] Setting up watcher for $i18n.locale...");
    if (this.$i18n) {
      this.$watch("$i18n.locale", (newLocale) => {
        console.log("Locale changed in Settings:", newLocale);
        this.currentLocale = newLocale;
        if (this.settings && this.settings.language !== newLocale) {
          console.log("[SETTINGS] Syncing settings.language to:", newLocale);
          this.settings.language = newLocale;
        }
        console.log(
          "[SETTINGS] Forcing component re-render for external locale change..."
        );
        this.$forceUpdate();
      });
    }
  },
  mounted() {
    console.log("[SETTINGS] Adding theme change event listener...");
    window.addEventListener("themeChange", this.updateTheme);

    console.log("[SETTINGS] Forcing theme application on mount...");
    this.applyTheme(this.settings.theme);

    // Continuously enforce theme to handle external overrides
    // FIXED: Assigned to 'this' instead of const, removed $once
    console.log("[SETTINGS] Setting up theme enforcement interval...");
    this.themeEnforcementInterval = setInterval(() => {
      const currentDomTheme =
        document.documentElement.getAttribute("data-theme") || "light";
      if (currentDomTheme !== this.settings.theme) {
        console.log(
          "[SETTINGS] Theme mismatch detected! DOM data-theme:",
          currentDomTheme,
          "Settings theme:",
          this.settings.theme
        );
        console.log("[SETTINGS] Re-applying settings.theme...");
        this.applyTheme(this.settings.theme);
      }
    }, 100);

    console.log("[SETTINGS] Scheduling theme readiness update...");
    this.$nextTick(() => {
      console.log("[SETTINGS] Setting isThemeReady to true...");
      this.isThemeReady = true;
    });

    console.log("[SETTINGS] Forcing i18n update on mount...");
    if (this.$i18n) {
      const savedLanguage = localStorage.getItem("userLocale") || "en";
      console.log(
        "[SETTINGS] Saved language from localStorage:",
        savedLanguage
      );
      console.log("[SETTINGS] Setting i18n locale to:", savedLanguage);
      this.$i18n.locale = savedLanguage;
      console.log("[SETTINGS] Setting settings.language to:", savedLanguage);
      this.settings.language = savedLanguage;
      console.log("[SETTINGS] Scheduling $forceUpdate after i18n update...");
      this.$nextTick(() => {
        console.log(
          "[SETTINGS] Forcing component re-render after i18n update..."
        );
        this.$forceUpdate();
      });
    }

    console.log("Current locale:", this.$i18n.locale);
    console.log("Available locales:", this.$i18n.availableLocales);
    console.log(
      "Sample translation for deleteAccount:",
      this.$i18n.t("settings.deleteAccount"),
      this.$i18n.te("settings.deleteAccount") ? "exists" : "missing"
    );
  },
  // FIXED: Added beforeUnmount to replace $once('hook:beforeDestroy')
  beforeUnmount() {
    if (this.themeEnforcementInterval) {
      console.log("[SETTINGS] Cleaning up theme enforcement interval...");
      clearInterval(this.themeEnforcementInterval);
      this.themeEnforcementInterval = null;
    }
    console.log("[SETTINGS] Removing theme change event listener...");
    window.removeEventListener("themeChange", this.updateTheme);
  },
  methods: {
    getCurrentTheme() {
      console.log("[SETTINGS] Getting current theme...");
      let theme = localStorage.getItem("theme") || "light";
      console.log("[SETTINGS] Theme from localStorage:", theme);

      if (theme === "system") {
        console.log(
          "[SETTINGS] Theme set to 'system', checking OS preference..."
        );
        theme = window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
        console.log("[SETTINGS] Resolved system theme to:", theme);
      }
      return theme;
    },
    getCurrentLanguage() {
      console.log("[SETTINGS] Getting current language...");

      if (this.$i18n && this.$i18n.locale) {
        console.log("[SETTINGS] Language from i18n:", this.$i18n.locale);
        return this.$i18n.locale;
      }

      try {
        const savedLocale = localStorage.getItem("userLocale");
        if (savedLocale) {
          console.log("[SETTINGS] Language from localStorage:", savedLocale);
          return savedLocale;
        }
      } catch (e) {
        console.warn(
          "[SETTINGS] Error accessing localStorage for language:",
          e
        );
      }

      console.log("[SETTINGS] Defaulting to language: 'en'");
      return "en";
    },
    getSavedFontSize() {
      console.log("[SETTINGS] Getting saved font size...");
      try {
        const fontSize = localStorage.getItem("fontSize");
        if (fontSize) {
          console.log("[SETTINGS] Font size from localStorage:", fontSize);
          return parseInt(fontSize);
        }
        console.log("[SETTINGS] No font size found, defaulting to 50%");
        return 50;
      } catch (e) {
        console.warn(
          "[SETTINGS] Error accessing localStorage for font size:",
          e
        );
        return 50;
      }
    },
    getSavedPreference(key, defaultValue) {
      console.log(`[SETTINGS] Getting saved preference for ${key}...`);
      try {
        const value = localStorage.getItem(key);
        if (value !== null) {
          console.log(`[SETTINGS] Preference ${key} from localStorage:`, value);
          return JSON.parse(value);
        }
        console.log(
          `[SETTINGS] No preference for ${key}, defaulting to:`,
          defaultValue
        );
        return defaultValue;
      } catch (e) {
        console.warn(`[SETTINGS] Error accessing localStorage for ${key}:`, e);
        return defaultValue;
      }
    },
    translate(key, fallback = "") {
      console.log("[SETTINGS] Translating key:", key);
      if (!this.$i18n) {
        console.log(
          "[SETTINGS] No i18n instance, returning fallback:",
          fallback
        );
        return fallback;
      }
      try {
        console.log("[SETTINGS] Using locale:", this.currentLocale);
        const translation = this.$i18n.t(key, { locale: this.currentLocale });
        if (translation === key) {
          console.log(
            "[SETTINGS] Translation not found, using fallback:",
            fallback || key
          );
          return fallback || key;
        }
        console.log("[SETTINGS] Translation found:", translation);
        return translation;
      } catch (e) {
        console.error("[SETTINGS] Translation error:", e);
        console.log(
          "[SETTINGS] Returning fallback due to error:",
          fallback || key
        );
        return fallback || key;
      }
    },
    updateTheme() {
      console.log("[SETTINGS] Theme change event triggered");
      const currentTheme =
        document.documentElement.getAttribute("data-theme") || "light";
      console.log("[SETTINGS] Current theme from DOM:", currentTheme);
      if (this.settings.theme !== currentTheme) {
        console.log(
          "[SETTINGS] Updating settings.theme to match DOM:",
          currentTheme
        );
        this.settings.theme = currentTheme;
      }
      console.log("[SETTINGS] Resetting theme readiness...");
      this.isThemeReady = false;
      this.$nextTick(() => {
        console.log("[SETTINGS] Setting theme readiness to true...");
        this.isThemeReady = true;
        console.log(
          "[SETTINGS] Forcing component update after theme change..."
        );
        this.$forceUpdate();
      });
    },
    applyTheme(theme) {
      console.log("[SETTINGS] Theme button clicked:", theme);
      console.log("[SETTINGS] Updating settings.theme to:", theme);
      this.settings.theme = theme;
      console.log("[SETTINGS] Saving theme to localStorage...");
      localStorage.setItem("theme", theme);
      console.log("[SETTINGS] Theme saved successfully");
      try {
        console.log("[SETTINGS] Applying theme with ThemeManager...");
        if (themeManager && typeof themeManager.setTheme === "function") {
          console.log("[SETTINGS] Using ThemeManager.setTheme...");
          themeManager.setTheme(theme);
          console.log("[SETTINGS] Theme applied via ThemeManager");
        } else {
          console.log("[SETTINGS] ThemeManager unavailable, using fallback...");
          const effectiveTheme =
            theme === "system"
              ? window.matchMedia("(prefers-color-scheme: dark)").matches
                ? "dark"
                : "light"
              : theme;
          console.log(
            "[SETTINGS] Effective theme resolved to:",
            effectiveTheme
          );
          console.log("[SETTINGS] Setting data-theme attribute on document...");
          document.documentElement.setAttribute("data-theme", effectiveTheme);
          document.body.setAttribute("data-theme", effectiveTheme);
          if (effectiveTheme === "dark") {
            console.log("[SETTINGS] Applying dark mode classes...");
            document.documentElement.classList.add("dark-mode");
            document.documentElement.classList.remove("light-mode");
            document.body.classList.remove("light-mode");
            document.body.classList.add("dark-mode");
          } else {
            console.log("[SETTINGS] Applying light mode classes...");
            document.documentElement.classList.remove("dark-mode");
            document.documentElement.classList.add("light-mode");
            document.body.classList.remove("dark-mode");
            document.body.classList.add("light-mode");
          }
          console.log("[SETTINGS] Fallback theme application completed");
        }
      } catch (e) {
        console.warn("[SETTINGS] Error applying theme:", e);
      }
      console.log("[SETTINGS] Emitting themeChanged event with theme:", theme);
      this.$emit("themeChanged", theme);
      console.log(
        "[SETTINGS] Forcing component re-render after theme change..."
      );
      this.$forceUpdate();
    },
    async fetchUserData() {
      console.log("[SETTINGS] Fetching user data...");
      this.isLoading = true;
      this.errorMessage = null;
      try {
        console.log("[SETTINGS] Fetching user data from API...");
        const userData = await userService.getCurrentUserInfo();
        console.log("[SETTINGS] User data fetched from API:", userData);
        console.log("[SETTINGS] Extracting user ID...");
        let userId = userData._key || userData.id || userData.userId || userData._id || "";
        if (typeof userId === "string" && userId.includes("/")) {
          userId = userId.split("/").pop();
        }
        this.currentUserId = userId;
        console.log(
          "[SETTINGS] Stored user ID for authentication:",
          this.currentUserId
        );
        console.log("[SETTINGS] Updating userData state...");
        this.userData = {
          name:
            userData.fullName ||
            userData.loginName ||
            userData.username ||
            this.translate("settings.user"),
          email: userData.email || "",
          accountType:
            userData.accountType ||
            userData.role ||
            this.translate("settings.standardAccount"),
          userId: this.currentUserId,
          createdAt: userData.createdAt || "",
        };
        console.log("[SETTINGS] userData updated:", this.userData);
        if (userData.avatarUrl) {
          console.log("[SETTINGS] Setting user avatar:", userData.avatarUrl);
          this.userAvatar = userData.avatarUrl;
        }
      } catch (error) {
        console.error("[SETTINGS] Error fetching user data:", error);
        notificationService.error(this.translate("settings.unableToLoadUser"));
      } finally {
        console.log("[SETTINGS] Setting isLoading to false");
        this.isLoading = false;
      }
    },
    close() {
      console.log("[SETTINGS] Closing dialog without saving...");
      this.$emit("close");
    },
    save() {
      console.log("[SETTINGS] Saving settings...");
      notificationService.info(
        this.translate("settings.savingSettings", "Saving your settings..."),
        1000
      );
      const isChangingLanguage =
        this.$i18n && this.$i18n.locale !== this.settings.language;
      console.log("[SETTINGS] Is language changing?:", isChangingLanguage);
      if (this.$i18n) {
        console.log(
          "[SETTINGS] Saving language preference:",
          this.settings.language
        );
        this.$i18n.locale = this.settings.language;
        try {
          localStorage.setItem("userLocale", this.settings.language);
          console.log("[SETTINGS] Language preference saved to localStorage");
        } catch (e) {
          console.warn("[SETTINGS] Error saving language preference:", e);
        }
      }
      console.log("[SETTINGS] Applying theme to DOM:", this.settings.theme);
      document.documentElement.setAttribute("data-theme", this.settings.theme);
      document.body.setAttribute("data-theme", this.settings.theme);
      try {
        localStorage.setItem("theme", this.settings.theme);
        console.log("[SETTINGS] Theme preference saved to localStorage");
      } catch (e) {
        console.warn("[SETTINGS] Error saving theme preference:", e);
      }
      console.log("[SETTINGS] Saving font size:", this.settings.fontSize);
      try {
        localStorage.setItem("fontSize", this.settings.fontSize.toString());
        document.documentElement.style.fontSize = `${
          this.settings.fontSize / 50
        }rem`;
        console.log("[SETTINGS] Font size applied and saved");
      } catch (e) {
        console.warn("[SETTINGS] Error saving font size:", e);
      }
      console.log("[SETTINGS] Saving notification preferences...");
      try {
        localStorage.setItem(
          "emailUpdates",
          JSON.stringify(this.settings.emailUpdates)
        );
        localStorage.setItem(
          "soundNotifications",
          JSON.stringify(this.settings.soundNotifications)
        );
        console.log("[SETTINGS] Notification preferences saved:", {
          emailUpdates: this.settings.emailUpdates,
          soundNotifications: this.settings.soundNotifications,
        });
      } catch (e) {
        console.warn("[SETTINGS] Error saving notification preferences:", e);
      }
      console.log(
        "[SETTINGS] Emitting themeChanged event:",
        this.settings.theme
      );
      this.$emit("themeChanged", this.settings.theme);
      notificationService.success(
        this.translate("settings.settingsSaved", "Settings saved successfully!")
      );
      console.log("[SETTINGS] Closing dialog after saving...");
      this.$emit("close");
      if (isChangingLanguage) {
        console.log("[SETTINGS] Language changed, scheduling page reload...");
        setTimeout(() => {
          window.location.reload();
        }, 100);
      }
    },
  },
  watch: {
    "settings.theme"(newTheme) {
      console.log("[SETTINGS] settings.theme changed to:", newTheme);
      this.$forceUpdate();
    },
  },
};
</script>

<style scoped>
/* Settings dialog styling */
.settings-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--dialog-overlay-background, rgba(0, 0, 0, 0.5));
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.settings-dialog {
  width: 800px;
  height: auto;
  max-width: 95vw;
  max-height: 95vh;
  border-radius: 8px;
  background-color: var(--dialog-background, #ffffff) !important;
  box-shadow: var(--dialog-box-shadow, 0 4px 12px rgba(0, 0, 0, 0.15));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

/* Header with buttons */
.dialog-header {
  padding: 1rem 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--dialog-border-color, #dcdfe4);
}

.header-title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
}

.header-title[data-themed="true"] {
  color: var(--dialog-title-color, #333333) !important;
}

/* Fallback override for dark mode */
[data-theme="dark"]
  .settings-dialog
  .dialog-header
  .header-title[data-themed="true"] {
  color: #f0f0f0 !important;
}

.header-actions {
  display: flex;
  gap: 0.5rem;
}

/* Loading indicator */
.loading-overlay {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  height: 300px;
  color: var(--dialog-text-color, #666666);
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 4px solid rgba(0, 0, 0, 0.1);
  border-radius: 50%;
  border-top-color: var(--bg-button-primary, #4e97d1);
  animation: spin 1s linear infinite;
  margin-bottom: 1rem;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Error container */
.error-container {
  padding: 2rem;
  text-align: center;
}

.error-message {
  color: var(--text-danger, #dc3545);
  margin-bottom: 1rem;
}

.btn-retry {
  padding: 0.5rem 1.5rem;
  background-color: var(--bg-button-secondary, #d1d5db);
  color: var(--text-button-secondary, #333333);
  border: 1px solid var(--dialog-border-color, #dcdfe4);
  border-radius: 4px;
  cursor: pointer;
}

/* Main settings area */
.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
  padding: 1rem 1.5rem;
}

.settings-box {
  background-color: var(--bg-section, rgba(0, 0, 0, 0.02));
  border-radius: 6px;
  padding: 1rem;
}

.section-title {
  margin-top: 0;
  margin-bottom: 1rem;
  font-size: 1.25rem;
  font-weight: 500;
  color: var(--dialog-title-color, #333333) !important;
}

/* Fallback override for dark mode */
[data-theme="dark"] .settings-dialog .section-title {
  color: #f0f0f0 !important;
}

.setting-item {
  margin-bottom: 1rem;
}

.section-label {
  display: block;
  margin-bottom: 0.5rem;
  font-size: 1rem;
  font-weight: 400;
  color: var(--dialog-text-color, #666666);
}

/* Override text colors for dark mode */
[data-theme="dark"] .settings-dialog .section-label {
  color: rgba(255, 255, 255, 0.8) !important;
}

/* Toggle row */
.toggle-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

/* Error text */
.error-text {
  color: var(--text-danger, #dc3545);
  font-size: 0.875rem;
  margin-top: 0.25rem;
  margin-bottom: 0;
}

/* Theme buttons styling */
.theme-buttons {
  display: flex;
  gap: 0.5rem;
}

.theme-toggle {
  flex: 1;
  padding: 0.5rem;
  border-radius: 4px;
  cursor: pointer;
  text-align: center;
  font-weight: 500;
  transition: all 0.2s;
  background-color: var(--bg-button-secondary, #d1d5db);
  color: var(--text-button-secondary, #333333);
  border: 1px solid var(--dialog-border-color, #dcdfe4);
}

.theme-toggle.active {
  background-color: var(--bg-button-primary, #4e97d1) !important;
  color: var(--text-button-primary, #ffffff) !important;
  border-color: var(--bg-button-primary, #4e97d1) !important;
}

/* Dropdown styling */
.dropdown {
  width: 100%;
  padding: 0.5rem;
  border-radius: 4px;
  background-color: var(--bg-input, #ffffff);
  color: var(--text-primary, #333333);
  border: 1px solid var(--dialog-border-color, #dcdfe4);
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
  background: var(--slider-thumb, #4e97d1);
  cursor: pointer;
}

.slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--slider-thumb, #4e97d1);
  cursor: pointer;
  border: none;
}

.slider-value {
  min-width: 3rem;
  text-align: right;
  color: var(--dialog-text-color, #666666);
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
  transition: 0.4s;
}

.switch-thumb {
  position: absolute;
  height: 20px;
  width: 20px;
  left: 2px;
  bottom: 2px;
  background-color: var(--switch-thumb, #ffffff);
  border-radius: 50%;
  transition: 0.4s;
}

.switch-track.active .switch-thumb {
  transform: translateX(26px);
}

.switch-track.active {
  background-color: var(--switch-track-on, #4e97d1);
}

/* Text input styling */
.text-input {
  width: 100%;
  padding: 0.5rem;
  border-radius: 4px;
  background-color: var(--bg-input, #ffffff);
  color: var(--text-primary, #333333);
  border: 1px solid var(--dialog-border-color, #dcdfe4);
}

/* Buttons */
.btn-close,
.btn-save {
  padding: 0.5rem 1rem;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 500;
  border: none;
  transition: all 0.2s;
}

.btn-save {
  background-color: var(--bg-button-primary, #4e97d1);
  color: var(--text-button-primary, #ffffff);
}

/* Removed hardcoded dark mode override for btn-save */
/* Let btn-save use theme variables defined in theme-variables.css */

.btn-close {
  background-color: var(--bg-button-secondary, #d1d5db);
  color: var(--text-button-secondary, #333333);
}

/* Override button colors for dark mode */
[data-theme="dark"] .settings-dialog .btn-close {
  background-color: #444444 !important;
  color: #f0f0f0 !important;
}

/* Responsive adjustments */
@media (max-width: 768px) {
  .settings-dialog {
    width: 95vw;
    height: 90vh;
    max-height: 90vh;
    overflow-y: auto;
  }

  .settings-grid {
    grid-template-columns: 1fr;
  }

  .dialog-header {
    position: sticky;
    top: 0;
    background-color: var(--dialog-background, #ffffff);
    z-index: 10;
  }
}
</style>