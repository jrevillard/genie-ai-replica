<template>
  <div class="dialog-backdrop" @click="$emit('close')"></div>
  <div class="dialog-container">
    <div class="dialog-header">
      <h2 class="dialog-title">
        {{ translate("admin.documents.addLink", "Add from Link") }}
      </h2>
      <button
        class="dialog-close-btn"
        @click="$emit('close')"
        :aria-label="translate('common.close', 'Close')"
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
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>

    <div class="dialog-body">
      <div class="form-group">
        <label for="url-input">{{
          translate("link.label", "Website URL")
        }}</label>
        <input
          id="url-input"
          type="text"
          class="form-input"
          v-model="url"
          :placeholder="
            translate('link.placeholder', 'https://example.com/article')
          "
          @keyup.enter="handleSubmit"
        />
        <p class="form-hint" v-if="crawlMode === 'single_page'">
          {{
            translate(
              "link.hint",
              "The content of the webpage will be crawled and saved as an HTML file."
            )
          }}
        </p>
        <p class="form-hint" v-else>
          {{
            translate(
              "link.hintAsync",
              "The full site will be crawled in the background and saved as a Markdown file."
            )
          }}
        </p>
      </div>

      <div class="form-group">
        <label>{{ translate("link.crawlMode", "Crawl Mode") }}</label>
        <div class="radio-group">
          <label class="radio-label">
            <input type="radio" v-model="crawlMode" value="single_page" />
            {{ translate("link.mode.single", "Single Page") }}
          </label>
          <label class="radio-label">
            <input type="radio" v-model="crawlMode" value="full_site" />
            {{ translate("link.mode.fullSite", "Full Site (Async)") }}
          </label>
        </div>
      </div>

      <div class="form-group" v-if="crawlMode === 'full_site'">
        <label for="depth-input">{{
          translate("link.crawlDepth", "Crawl Depth")
        }}</label>
        <input
          id="depth-input"
          type="number"
          class="form-input"
          v-model.number="crawlDepth"
          min="1"
          max="20"
        />
        <p class="form-hint">
          {{ translate("link.depthHint", "Depth of links to follow (1-20).") }}
        </p>
      </div>

      <div v-if="errorMessage" class="error-message">{{ errorMessage }}</div>
    </div>

    <div class="dialog-footer">
      <button class="btn btn-outline" @click="$emit('close')">
        {{ translate("common.cancel", "Cancel") }}
      </button>
      <button
        class="btn btn-primary"
        @click="handleSubmit"
        :disabled="!isValidUrl || isLoading"
      >
        <span v-if="isLoading">{{
          crawlMode === "full_site"
            ? translate("link.scheduling", "Scheduling...")
            : translate("link.crawling", "Crawling...")
        }}</span>
        <span v-else>{{
          crawlMode === "full_site"
            ? translate("link.submitAsync", "Start Crawl")
            : translate("link.submit", "Crawl & Save")
        }}</span>
      </button>
    </div>
  </div>
</template>

<script>
import documentFileService from "../services/documentFileService.js";
import { eventBus } from "../eventBus.js";

export default {
  name: "AddFromLinkDialog",
  emits: ["close", "link-submitted"],
  data() {
    return {
      url: "",
      crawlMode: "single_page",
      crawlDepth: 5,
      isLoading: false,
      errorMessage: "",
    };
  },
  computed: {
    /**
     * Uses a more robust regex to validate the URL format.
     */
    isValidUrl() {
      try {
        const newUrl = new URL(this.url);
        return newUrl.protocol === "http:" || newUrl.protocol === "https:";
      } catch (_) {
        return false;
      }
    },
  },
  methods: {
    // --- UPDATED: Swapped to full i18n-safe translate method ---
    translate(key, fallback) {
      if (this.$i18n && this.$i18n.t) {
        const translation = this.$i18n.t(key);
        // Fallback if key is not found
        if (translation === key) {
          return fallback || key;
        }
        return translation;
      }
      return fallback || key;
    },
    /**
     * Handles the submission of the URL to the backend service.
     */
    async handleSubmit() {
      if (!this.isValidUrl) {
        this.errorMessage = this.translate(
          "link.validation.invalidUrl",
          "Please enter a valid URL, including http:// or https://"
        );
        return;
      }

      if (
        this.crawlMode === "full_site" &&
        (this.crawlDepth < 1 || this.crawlDepth > 20)
      ) {
        this.errorMessage = this.translate(
          "link.validation.invalidDepth",
          "Depth must be between 1 and 20."
        );
        return;
      }

      this.isLoading = true;
      this.errorMessage = "";

      try {
        let response;

        if (this.crawlMode === "single_page") {
          // Call the uploadLink method from the service
          response = await documentFileService.uploadLink(this.url);
        } else {
          // Call the scheduleSiteCrawl method
          response = await documentFileService.scheduleSiteCrawl({
            url: this.url,
            depth: this.crawlDepth,
          });
        }

        const fileName = response.data?.file_name || "the file";
        
        // Show different success messages based on mode
        const successMsg =
          this.crawlMode === "single_page"
            ? this.translate(
                "admin.documents.linkSubmitSuccess",
                'Successfully crawled and saved "{fileName}".'
              ).replace("{fileName}", fileName)
            : this.translate(
                "admin.documents.crawlScheduled",
                'Site crawl scheduled for "{fileName}". Check status in dashboard.'
              ).replace("{fileName}", fileName);

        this.showNotification(successMsg, "success");

        // Emit the new file data back to the parent component
        // response.data from documentFileService is the response.data from axios,
        // which the controller wraps in { success, message, data }
        this.$emit("link-submitted", response.data);
        this.$emit("close");
      } catch (error) {
        // --- Robust Error Extraction ---
        // Robustly extract the specific error message from the backend.
        // We check multiple locations, as the format can vary.
        const backendMessage =
          error.response?.data?.message || // 1. Check for { message: "..." } in data
          (typeof error.response?.data === "string"
            ? error.response.data
            : null) || // 2. Check if data *is* the message string
          error.message || // 3. Check the top-level error message
          this.translate(
            "link.errors.generic",
            "Failed to crawl the URL. Please check the link and try again."
          );

        this.errorMessage = backendMessage; // Show in the dialog
        this.showNotification(backendMessage, "error"); // Show in the toast

        // --- UPDATED CONSOLE LOG ---
        // Log the specific message being shown and the full error for debugging
        console.error("Error processing link. Displayed message:", backendMessage);
        console.error("Full error object for debugging:", error);
        if (error.response) {
          console.error("Error response data:", error.response.data);
        }
        // --- END FIX ---
      } finally {
        this.isLoading = false;
      }
    },
    showNotification(message, type = "success") {
      eventBus.$emit("notification:show", { message, type });
    },
  },
};
</script>

<style scoped>
/* Using a consistent dialog style */
.dialog-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  z-index: 1050;
}
.dialog-container {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 90%;
  max-width: 500px;
  background-color: var(--bg-dialog, #fff);
  border-radius: 8px;
  box-shadow: var(--shadow-lg);
  z-index: 1051;
}
.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--border-color, #e2e8f0);
}
.dialog-title {
  font-size: 1.25rem;
  color: var(--text-primary, #333);
}
.dialog-close-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-secondary);
}
.dialog-body {
  padding: 1.5rem;
}
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--border-color, #e2e8f0);
}
.btn {
  padding: 0.6rem 1rem;
  border-radius: 0.375rem;
  border: none;
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.2s;
}
.btn-primary {
  background-color: #3b82f6;
  color: white;
}
.btn-primary:hover {
  background-color: #2563eb;
}
.btn-primary:disabled {
  background-color: #9ca3af;
  cursor: not-allowed;
}
.btn-outline {
  background-color: transparent;
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
}
.btn-outline:hover {
  background-color: var(--bg-section);
}

/* Component-specific styles */
.form-group {
  display: flex;
  flex-direction: column;
  margin-bottom: 1rem;
}
.form-group label {
  margin-bottom: 0.5rem;
  font-weight: 500;
  color: var(--text-secondary);
}
.form-input {
  padding: 0.75rem;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-size: 1rem;
  background-color: var(--bg-input, #fff);
  color: var(--text-primary, #333);
}
.form-hint {
  font-size: 0.8rem;
  color: var(--text-tertiary);
  margin-top: 0.5rem;
}
.error-message {
  margin-top: 1rem;
  color: var(--danger, #ef4444);
  background-color: rgba(239, 68, 68, 0.1);
  padding: 0.75rem;
  border-radius: 4px;
}

/* Radio group styles */
.radio-group {
  display: flex;
  gap: 1.5rem;
  margin-top: 0.25rem;
}
.radio-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  font-size: 0.95rem;
  color: var(--text-primary, #333);
  user-select: none;
}
.radio-label input[type="radio"] {
  cursor: pointer;
  width: 1.1rem;
  height: 1.1rem;
}
</style>