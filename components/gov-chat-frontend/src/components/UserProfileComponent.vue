// UserProfileComponent.vue - Simplified single-screen profile view

<template>
  <div
    class="user-profile-modal"
    :style="dialogThemeStyles"
    :data-themed="isThemeReady"
    ref="modalContainer"
  >
    <div class="overlay" @click="close"></div>
    <div class="modal-content">
      <div class="dialog-header">
        <h2 class="header-title" :data-themed="isThemeReady">{{ translate("title") }}</h2>
        <div class="header-actions">
          <button class="btn-close" @click="close">
            {{ translate("actions.close", "Close") }}
          </button>
        </div>
      </div>

      <!-- Loading Indicator -->
      <div v-if="isLoading" class="loading-overlay">
        <div class="loading-spinner"></div>
        <p>{{ translate("loadingProfile", "Loading user profile...") }}</p>
      </div>

      <!-- Error Message -->
      <div v-else-if="errorMessage" class="error-container">
        <p class="error-message">{{ errorMessage }}</p>
        <button @click="retryLoading" class="retry-btn">
          {{ translate("retryLoading", "Retry") }}
        </button>
      </div>

      <!-- Profile Content -->
      <div v-else class="profile-content">
        <!-- Profile Icon Section -->
        <div class="profile-icon-section">
          <div class="current-icon" @click="openIconSelector">
            <img
              v-if="profileIcon"
              :src="profileIcon"
              alt="Profile icon"
            />
            <div v-else class="icon-placeholder">
              {{ getInitials(userData.name) }}
            </div>
            <div class="icon-overlay">
              <span>{{ translate("change", "Change") }}</span>
            </div>
          </div>
        </div>

        <!-- User Info Fields (read-only, managed by Keycloak) -->
        <div class="user-info-section">
          <div class="info-field">
            <label>{{ translate("fields.fullName", "Full Name") }}</label>
            <div class="info-value">{{ userData.name || "—" }}</div>
          </div>

          <div class="info-field">
            <label>{{ translate("fields.email", "Email") }}</label>
            <div class="info-value">{{ userData.email || "—" }}</div>
          </div>

          <div class="info-field">
            <label>{{ translate("fields.role", "Role") }}</label>
            <div class="info-value">{{ userData.role || "—" }}</div>
          </div>

          <div class="info-field" v-if="userData.username">
            <label>{{ translate("fields.username", "Username") }}</label>
            <div class="info-value">{{ userData.username }}</div>
          </div>
        </div>

        <p class="managed-notice">
          {{ translate("managedByIdpPrefix", "Account information is managed by your") }}
          <a href="https://user.itu.int" target="_blank" rel="noopener noreferrer" class="idp-link">{{ translate("managedByIdpLink", "identity provider") }}</a>.
        </p>

        <!-- Icon Selection Modal -->
        <div
          v-if="showIconSelector"
          class="icon-selector-overlay"
          @click="closeIconSelector"
        >
          <div class="icon-selector-modal" @click.stop>
            <h4>{{ translate("chooseProfileIcon", "Choose Profile Icon") }}</h4>

            <div class="icon-tabs">
              <button
                :class="{ active: iconTab === 'preset' }"
                @click="iconTab = 'preset'"
              >
                {{ translate("presetIcons", "Preset") }}
              </button>
              <button
                :class="{ active: iconTab === 'upload' }"
                @click="iconTab = 'upload'"
              >
                {{ translate("upload", "Upload") }}
              </button>
              <button
                :class="{ active: iconTab === 'initials' }"
                @click="iconTab = 'initials'"
              >
                {{ translate("initials", "Initials") }}
              </button>
            </div>

            <div class="icon-content">
              <!-- Preset Icons -->
              <div v-if="iconTab === 'preset'" class="preset-icons">
                <div
                  v-for="(icon, index) in presetIcons"
                  :key="index"
                  class="preset-icon"
                  :class="{ selected: profileIcon === icon }"
                  @click="selectPresetIcon(icon)"
                >
                  <img :src="icon" alt="Preset icon" />
                </div>
              </div>

              <!-- Upload Option -->
              <div v-if="iconTab === 'upload'" class="upload-icon">
                <div class="upload-zone" @click="triggerFileUpload">
                  <span v-if="!uploadedImage">{{ translate("clickToUpload", "Click to upload") }}</span>
                  <img v-else :src="uploadedImage" alt="Uploaded icon" />
                </div>
                <input
                  type="file"
                  ref="fileInput"
                  style="display: none"
                  accept="image/*"
                  @change="handleFileUpload"
                />
                <button
                  v-if="uploadedImage"
                  class="btn-confirm"
                  @click="confirmUpload"
                >
                  {{ translate("useThisImage", "Use this image") }}
                </button>
              </div>

              <!-- Initials Option -->
              <div v-if="iconTab === 'initials'" class="initials-selector">
                <div class="initials-preview">
                  <div
                    class="initials-icon"
                    :style="{ backgroundColor: initialsColor }"
                  >
                    {{ getInitials(userData.name) }}
                  </div>
                </div>
                <div class="color-selector">
                  <div
                    v-for="(color, index) in colorOptions"
                    :key="index"
                    class="color-option"
                    :style="{ backgroundColor: color }"
                    :class="{ selected: initialsColor === color }"
                    @click="initialsColor = color"
                  ></div>
                </div>
                <button class="btn-confirm" @click="useInitials">
                  {{ translate("useInitials", "Use Initials") }}
                </button>
              </div>
            </div>

            <div class="icon-selector-footer">
              <button class="btn-cancel" @click="closeIconSelector">
                {{ translate("actions.cancel", "Cancel") }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import userService from "@/services/userService";
import notificationService from "@/services/notificationService";

export default {
  name: "UserProfileComponent",
  data() {
    return {
      isThemeReady: false,
      isLoading: false,
      errorMessage: null,
      userData: {
        name: "",
        email: "",
        role: "",
        username: "",
      },
      profileIcon: "",
      showIconSelector: false,
      iconTab: "preset",
      presetIcons: [
        "/icons/profile1.png",
        "/icons/profile2.png",
        "/icons/profile3.png",
        "/icons/profile4.png",
        "/icons/profile5.png",
        "/icons/profile6.png",
        "/icons/profile7.png",
        "/icons/profile8.png",
      ],
      uploadedImage: null,
      initialsColor: "#4E97D1",
      colorOptions: [
        "#4E97D1",
        "#2ECC71",
        "#E74C3C",
        "#F39C12",
        "#9B59B6",
        "#1ABC9C",
        "#34495E",
        "#D35400",
      ],
    };
  },
  computed: {
    isDarkMode() {
      return (
        document.documentElement.getAttribute("data-theme") === "dark" ||
        document.body.getAttribute("data-theme") === "dark"
      );
    },
    dialogThemeStyles() {
      const isDark = this.isDarkMode;
      return {
        "--dialog-background": isDark ? "#2a2a2a" : "#ffffff",
        "--dialog-title-color": isDark ? "#ffffff" : "#333333",
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
  methods: {
    translate(key, fallback = "") {
      const fullKey = key.startsWith("userProfile.")
        ? key
        : `userProfile.${key}`;
      if (this.$te(fullKey)) {
        return this.$t(fullKey);
      }
      return fallback || key;
    },
    close() {
      this.$emit("cancel");
    },
    updateTheme() {
      this.isThemeReady = false;
      this.$nextTick(() => {
        this.isThemeReady = true;
      });
    },
    async loadUserData() {
      this.isLoading = true;
      this.errorMessage = null;
      try {
        const userData = await userService.getCurrentUserInfo();

        if (userData) {
          this.userData = {
            name: userData.fullName || userData.loginName || userData.username || "",
            email: userData.email || "",
            role: userData.role || userData.accountType || "",
            username: userData.username || userData.loginName || "",
          };

          if (userData.avatarUrl) {
            this.profileIcon = userData.avatarUrl;
          }
        }

        // Load saved profile icon from localStorage
        const savedIcon = localStorage.getItem("user_profile_icon");
        if (savedIcon) {
          this.profileIcon = savedIcon;
        }
      } catch (error) {
        console.error("[PROFILE] Error loading user data:", error);
        this.errorMessage = this.translate(
          "errors.loadingFailed",
          "Failed to load profile data"
        );
      } finally {
        this.isLoading = false;
      }
    },
    retryLoading() {
      this.loadUserData();
    },
    getInitials(name) {
      if (!name) return "?";
      return name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .substring(0, 2);
    },
    openIconSelector() {
      this.showIconSelector = true;
    },
    closeIconSelector() {
      this.showIconSelector = false;
      this.uploadedImage = null;
    },
    selectPresetIcon(icon) {
      this.profileIcon = icon;
      this.saveProfileIcon(icon);
      this.closeIconSelector();
    },
    triggerFileUpload() {
      this.$refs.fileInput.click();
    },
    handleFileUpload(event) {
      const file = event.target.files[0];
      if (!file) return;

      const validTypes = ["image/jpeg", "image/png", "image/gif"];
      if (!validTypes.includes(file.type)) {
        notificationService.error(
          this.translate("errors.invalidFileType", "Please upload a valid image (JPEG, PNG, GIF)")
        );
        return;
      }

      if (file.size > 2 * 1024 * 1024) {
        notificationService.error(
          this.translate("errors.fileTooLarge", "Image size must be less than 2MB")
        );
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        this.uploadedImage = e.target.result;
      };
      reader.readAsDataURL(file);
    },
    confirmUpload() {
      this.profileIcon = this.uploadedImage;
      this.saveProfileIcon(this.uploadedImage);
      this.closeIconSelector();
    },
    useInitials() {
      const canvas = document.createElement("canvas");
      const size = 200;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");

      ctx.fillStyle = this.initialsColor;
      ctx.fillRect(0, 0, size, size);

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 80px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(this.getInitials(this.userData.name), size / 2, size / 2);

      const dataUrl = canvas.toDataURL("image/png");
      this.profileIcon = dataUrl;
      this.saveProfileIcon(dataUrl);
      this.closeIconSelector();
    },
    saveProfileIcon(icon) {
      try {
        localStorage.setItem("user_profile_icon", icon);
      } catch (e) {
        console.warn("[PROFILE] Could not save profile icon to localStorage:", e);
      }
    },
  },
  mounted() {
    window.addEventListener("themeChange", this.updateTheme);
    this.$nextTick(() => {
      this.isThemeReady = true;
    });
    this.loadUserData();
  },
  beforeDestroy() {
    window.removeEventListener("themeChange", this.updateTheme);
  },
};
</script>

<style scoped>
/* Base Modal Styling */
.user-profile-modal {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 9999;
  color: #333333;
}

.user-profile-modal[data-themed="true"] {
  color: var(--dialog-text-color, #333333);
}

.overlay {
  position: absolute;
  width: 100%;
  height: 100%;
  background-color: var(--dialog-overlay-background, rgba(0, 0, 0, 0.5));
}

.modal-content {
  position: relative;
  background-color: var(--dialog-background, #ffffff);
  width: 500px;
  max-width: 90%;
  margin: 80px auto;
  padding: 24px;
  border-radius: 8px;
  overflow-y: auto;
  max-height: 80vh;
  box-shadow: var(--dialog-box-shadow, 0 4px 12px rgba(0, 0, 0, 0.15));
  border: 1px solid var(--dialog-border-color, #dcdfe4);
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--dialog-border-color, #dcdfe4);
}

.header-title {
  color: #333333;
  margin: 0;
  font-size: 1.5rem;
}

.header-title[data-themed="true"] {
  color: var(--dialog-title-color, #333333);
}

.header-actions {
  display: flex;
  gap: 0.5rem;
}

.btn-close {
  padding: 0.5rem 1rem;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 500;
  border: none;
  transition: all 0.2s;
  background-color: var(--bg-button-secondary, #d1d5db);
  color: var(--text-button-secondary, #333333);
}

/* Profile Content */
.profile-content {
  display: flex;
  flex-direction: column;
  align-items: center;
}

/* Profile Icon */
.profile-icon-section {
  margin-bottom: 24px;
}

.current-icon {
  width: 96px;
  height: 96px;
  border-radius: 50%;
  overflow: hidden;
  position: relative;
  cursor: pointer;
  background-color: var(--bg-button-primary, #4e97d1);
}

.current-icon img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.icon-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 36px;
  font-weight: bold;
  color: white;
}

.icon-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.5);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s;
  font-size: 0.85rem;
}

.current-icon:hover .icon-overlay {
  opacity: 1;
}

/* User Info Section */
.user-info-section {
  width: 100%;
  margin-bottom: 16px;
}

.info-field {
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(125, 125, 125, 0.1);
}

.info-field:last-child {
  border-bottom: none;
}

.info-field label {
  display: block;
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--dialog-text-color, #666666);
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.info-value {
  font-size: 1.05rem;
  color: var(--dialog-title-color, #333333);
  font-weight: 400;
}

.managed-notice {
  font-size: 0.85rem;
  color: var(--dialog-text-color, #888888);
  text-align: center;
  margin-top: 8px;
  font-style: italic;
}

.idp-link {
  color: var(--bg-button-primary, #4e97d1);
  text-decoration: none;
}

.idp-link:hover {
  text-decoration: underline;
}

/* Loading spinner */
.loading-overlay {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  min-height: 200px;
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
  color: #dc3545;
  margin-bottom: 1rem;
}

.retry-btn {
  padding: 0.5rem 1.5rem;
  background-color: var(--bg-button-secondary, #cccccc);
  color: var(--text-button-secondary, #333333);
  border: 1px solid var(--dialog-border-color, #cccccc);
  border-radius: 4px;
  cursor: pointer;
}

.retry-btn:hover {
  background-color: var(--bg-button-secondary-hover, #bbbbbb);
}

/* Icon Selector Modal */
.icon-selector-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 11000;
}

.icon-selector-modal {
  background-color: var(--dialog-background, #ffffff);
  border-radius: 8px;
  width: 90%;
  max-width: 450px;
  max-height: 90vh;
  overflow-y: auto;
  padding: 20px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.icon-selector-modal h4 {
  margin-top: 0;
  margin-bottom: 15px;
  color: var(--dialog-title-color, #333333);
}

.icon-tabs {
  display: flex;
  border-bottom: 1px solid var(--dialog-border-color, #eaeaea);
  margin-bottom: 15px;
}

.icon-tabs button {
  padding: 8px 16px;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 14px;
  color: var(--dialog-text-color, #333333);
}

.icon-tabs button.active {
  border-bottom: 2px solid var(--bg-button-primary, #4e97d1);
  color: var(--bg-button-primary, #4e97d1);
}

.icon-content {
  min-height: 200px;
}

/* Preset Icons */
.preset-icons {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 15px;
  margin-bottom: 15px;
}

.preset-icon {
  width: 70px;
  height: 70px;
  border-radius: 50%;
  overflow: hidden;
  cursor: pointer;
  border: 2px solid transparent;
  transition: border-color 0.2s;
}

.preset-icon img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.preset-icon.selected,
.preset-icon:hover {
  border-color: var(--bg-button-primary, #4e97d1);
}

/* Upload Zone */
.upload-zone {
  border: 2px dashed var(--dialog-border-color, #ddd);
  border-radius: 8px;
  height: 150px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  margin-bottom: 15px;
  color: var(--dialog-text-color, #666666);
}

.upload-zone img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

/* Initials Selector */
.initials-selector {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 15px;
}

.initials-preview {
  margin-bottom: 10px;
}

.initials-icon {
  width: 100px;
  height: 100px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40px;
  font-weight: bold;
  color: white;
}

.color-selector {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: center;
  margin-bottom: 15px;
}

.color-option {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  cursor: pointer;
  border: 2px solid transparent;
  transition: transform 0.2s;
}

.color-option:hover {
  transform: scale(1.1);
}

.color-option.selected {
  border-color: #ddd;
  transform: scale(1.1);
}

.icon-selector-footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 20px;
}

.btn-confirm {
  background-color: var(--bg-button-primary, #4e97d1);
  color: var(--text-button-primary, #ffffff);
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
}

.btn-cancel {
  background-color: var(--bg-button-secondary, #cccccc);
  color: var(--text-button-secondary, #333333);
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
}

/* Dark Mode */
[data-theme="dark"] .user-profile-modal,
.dark-mode .user-profile-modal {
  color: var(--dialog-text-color, #f0f0f0);
}

[data-theme="dark"] .header-title,
.dark-mode .header-title {
  color: #ffffff !important;
}

[data-theme="dark"] .btn-close {
  background-color: #444444 !important;
  color: #f0f0f0 !important;
}

[data-theme="dark"] .icon-selector-modal h4,
[data-theme="dark"] .icon-tabs button {
  color: var(--dialog-text-color, #ffffff);
}

[data-theme="dark"] .icon-tabs button.active {
  color: var(--bg-button-primary, #4e97d1);
}

[data-theme="dark"] .upload-zone {
  border-color: #444;
  color: #ccc;
}

[data-theme="dark"] .color-option.selected {
  border-color: #555;
}

/* Responsive */
@media (max-width: 600px) {
  .modal-content {
    width: 95%;
    margin: 40px auto;
    padding: 16px;
  }
}
</style>
