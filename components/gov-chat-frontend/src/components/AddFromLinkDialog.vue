<template>
  <div class="dialog-backdrop" @click="$emit('close')"></div>
  <div class="dialog-container">
    <div class="dialog-header">
      <h2 class="dialog-title">
        {{ translate("link.title", "Add from Link") }}
      </h2>
      <button
        class="dialog-close-btn"
        @click="$emit('close')"
        :aria-label="translate('link.close', 'Close')"
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
        />
        <p class="form-hint">
          {{
            translate(
              "link.hint",
              "The content of the webpage will be crawled and saved as an HTML file."
            )
          }}
        </p>
      </div>
      <div v-if="errorMessage" class="error-message">{{ errorMessage }}</div>
    </div>

    <div class="dialog-footer">
      <button class="btn btn-outline" @click="$emit('close')">
        {{ translate("buttons.cancel", "Cancel") }}
      </button>
      <button
        class="btn btn-primary"
        @click="handleSubmit"
        :disabled="!isValidUrl || isLoading"
      >
        <span v-if="isLoading">{{
          translate("link.crawling", "Crawling...")
        }}</span>
        <span v-else>{{ translate("link.submit", "Crawl & Save") }}</span>
      </button>
    </div>
  </div>
</template>
  
  <script>
export default {
  name: "AddFromLinkDialog",
  emits: ["close", "link-submitted"],
  data() {
    return {
      url: "",
      isLoading: false,
      errorMessage: "",
    };
  },
  computed: {
    isValidUrl() {
      // Simple URL validation
      return this.url.startsWith("http://") || this.url.startsWith("https://");
    },
  },
  methods: {
    translate(key, fallback) {
      // In a real app, this would use your i18n library
      return fallback || key;
    },
    async handleSubmit() {
      if (!this.isValidUrl) return;
      this.isLoading = true;
      this.errorMessage = "";

      // In a real app, this would make a POST request to /api/files/upload-link
      // with the { url: this.url } payload.
      console.log(`Simulating crawling for URL: ${this.url}`);

      // Simulate API call
      setTimeout(() => {
        // Simulate a success response based on README.md
        const success = Math.random() > 0.2; // 80% success rate
        if (success) {
          const mockResponse = {
            success: true,
            message: "URL crawled and html file saved successfully",
            data: {
              file_id: Date.now().toString(),
              file_name: "Crawled Page.html" /* ... other metadata */,
            },
          };
          this.$emit("link-submitted", mockResponse.data);
          this.$emit("close");
        } else {
          this.errorMessage =
            "Failed to crawl the URL. Please check the link and try again.";
        }
        this.isLoading = false;
      }, 2000);
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
</style>