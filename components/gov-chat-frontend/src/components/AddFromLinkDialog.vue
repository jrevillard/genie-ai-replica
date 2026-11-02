<template>
  <Teleport to="body">
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

        <template v-if="crawlMode === 'full_site'">
          <div class="form-group">
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
              {{
                translate("link.depthHint", "Depth of links to follow (1-20).")
              }}
            </p>
          </div>

          <div class="advanced-toggle">
            <button class="btn-link" @click="showAdvanced = !showAdvanced">
              {{ showAdvanced ? "Hide" : "Show" }}
              {{ translate("link.advancedOptions", "Advanced Configuration") }}
              <span class="toggle-icon">{{ showAdvanced ? "▲" : "▼" }}</span>
            </button>
            <span v-if="detectedPreset" class="preset-badge">
              Matched Preset: {{ detectedPreset }}
            </span>
          </div>

          <div v-if="showAdvanced" class="advanced-panel">
            <div class="form-group checkbox-group">
              <input
                type="checkbox"
                id="ext-links"
                v-model="config.followExternalLinks"
              />
              <label for="ext-links">{{
                translate("link.config.followExternal", "Follow External Links")
              }}</label>
            </div>
            <p class="form-hint small-hint" v-if="config.followExternalLinks">
              Useful for "Awesome Lists". Will crawl pages linked to from this
              domain.
            </p>

            <div class="form-group" v-if="config.followExternalLinks">
              <label for="ext-depth">{{
                translate("link.config.extDepth", "Max External Depth")
              }}</label>
              <input
                id="ext-depth"
                type="number"
                class="form-input"
                v-model.number="config.maxExternalDepth"
                min="0"
                max="5"
              />
              <p class="form-hint small-hint">
                0 = Save specific external page only. 1-5 = Depth of links to
                follow on external domains.
              </p>
            </div>

            <div class="form-group">
              <div class="label-with-tooltip">
                <label for="content-selector">{{
                  translate("link.config.selector", "Content CSS Selector")
                }}</label>
                <div class="tooltip-container">
                  <span class="help-icon">?</span>
                  <div class="tooltip-text">
                    Tells the crawler which HTML element contains the main text
                    (e.g. 'main', 'article', '.content'). Leave empty to let the
                    system auto-detect the best content area.
                  </div>
                </div>
              </div>
              <input
                id="content-selector"
                type="text"
                class="form-input"
                v-model="config.contentSelector"
                placeholder="Default: Auto-detect (main, article, body)"
              />
              <p class="form-hint small-hint">
                Specific container to extract content from (reduces noise).
              </p>
            </div>

            <div class="form-group">
              <label for="exclude-patterns">{{
                translate(
                  "link.config.exclude",
                  "Exclude Patterns (comma separated)"
                )
              }}</label>
              <textarea
                id="exclude-patterns"
                class="form-input"
                v-model="excludePatternsInput"
                rows="3"
                placeholder="/commits/, /issues/, /login"
              ></textarea>
            </div>
          </div>
        </template>

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
  </Teleport>
</template>

<script>
import documentFileService from "../services/documentFileService.js";
import { eventBus } from "../eventBus.js";

// --- TOP 20 SITE PRESETS ---
const SITE_PRESETS = {
  "github.com": {
    name: "GitHub",
    selector: ".markdown-body",
    exclude:
      "/commits/, /issues, /pulls, /actions, /projects, /security, /pulse, /find, /search, /stargazers, /watchers, /network, /branches, /tags, /blob/, /tree/, /releases",
    followExternal: true,
  },
  "gitlab.com": {
    name: "GitLab",
    selector: ".file-content, .wiki-content, .md",
    exclude:
      "/-/commits, /-/tree, /-/blob, /-/blame, /-/issues, /-/merge_requests, /-/pipelines, /-/jobs, /-/tags, /-/network",
    followExternal: true,
  },
  "wikipedia.org": {
    name: "Wikipedia",
    selector: "#bodyContent",
    exclude:
      "Talk:, User:, User_talk:, Wikipedia:, File:, MediaWiki:, Template:, Help:, Category:, Portal:, Special:, /w/index.php",
    followExternal: false,
  },
  "medium.com": {
    name: "Medium",
    selector: "article, section",
    exclude: "/signin, /m/signin, /search, /tag/, /@",
    followExternal: false,
  },
  "stackoverflow.com": {
    name: "Stack Overflow",
    selector: "#mainbar, .post-text",
    exclude: "/users/, /posts/, /revisions, /search, /feeds, /timeline, /admin",
    followExternal: false,
  },
  "reddit.com": {
    name: "Reddit",
    // Targets new UI shadow-dom content (shreddit-post) and old/mobile content
    selector: "shreddit-post, .Post, .post-content, .entry",
    exclude: "/user/, /u/, /search, /message/compose, /submit",
    followExternal: false,
  },
  "atlassian.net": {
    // Confluence Cloud
    name: "Confluence",
    selector: "#main-content, .wiki-content, #content",
    exclude: "/display/, /pages/viewpage.action, /history, /diffpages",
    followExternal: false,
  },
  "notion.site": {
    // Notion Public
    name: "Notion",
    selector: ".notion-page-content",
    exclude: "login, pricing, /signup",
    followExternal: false,
  },
  "readthedocs.io": {
    name: "Read the Docs",
    selector: '.rst-content, div[role="main"]',
    exclude: "_static, _images, genindex, search.html, py-modindex.html",
    followExternal: false,
  },
  "gitbook.io": {
    name: "GitBook",
    selector: "main, .gitbook-root",
    exclude: "/s/, /search",
    followExternal: false,
  },
  docusaurus: {
    // Generic check for docusaurus sites often works by meta tag, but by domain is hard. We'll add common ones.
    name: "Docusaurus Site",
    selector: "article, .theme-doc-markdown, .markdown",
    exclude: "/blog/tags, /search",
    followExternal: false,
  },
  "wordpress.com": {
    name: "WordPress",
    selector: ".entry-content, .post-content, article",
    exclude:
      "/wp-admin/, /wp-includes/, /feed/, /comments/, /page/, /xmlrpc.php",
    followExternal: false,
  },
  "substack.com": {
    name: "Substack",
    selector: ".available-content, .post",
    exclude: "/sign-in, /subscribe, /people/, /archive",
    followExternal: false,
  },
  "dev.to": {
    name: "Dev.to",
    selector: "#article-body, .crayons-article__body",
    exclude: "/search, /tag/, /top/, /latest, /videos",
    followExternal: false,
  },
  "arxiv.org": {
    name: "ArXiv",
    selector: "blockquote.abstract, .abstract",
    exclude: "/pdf/, /ps/, /format/, /list/, /find/",
    followExternal: false,
  },
  "huggingface.co": {
    name: "Hugging Face",
    selector: "section#readme, .readme",
    exclude: "/tree/, /blob/, /resolve/, /discussions, /settings",
    followExternal: true,
  },
  "developer.mozilla.org": {
    name: "MDN Web Docs",
    selector: "article.main-page-content",
    exclude: "/history, /edit, /users/, /docs/Web/HTML/Global_attributes", // common massive lists
    followExternal: false,
  },
  "youtube.com": {
    name: "YouTube",
    selector: "#description, ytd-video-secondary-info-renderer",
    exclude: "/watch, /channel/, /results, /feed/",
    followExternal: false,
  },
  "quora.com": {
    name: "Quora",
    selector: ".q-box, .q-text",
    exclude: "/profile/, /topic/, /log_in, /unanswered",
    followExternal: false,
  },
  "linkedin.com": {
    name: "LinkedIn Article",
    selector: ".article-main, .pulse-main-content",
    exclude: "/feed, /mynetwork, /jobs, /messaging",
    followExternal: false,
  },
};

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
      // Advanced Config State
      showAdvanced: false,
      excludePatternsInput: "",
      detectedPreset: null,
      config: {
        followExternalLinks: false,
        maxExternalDepth: 0,
        contentSelector: "",
      },
    };
  },
  computed: {
    isValidUrl() {
      try {
        const newUrl = new URL(this.url);
        return newUrl.protocol === "http:" || newUrl.protocol === "https:";
      } catch (_) {
        return false;
      }
    },
  },
  watch: {
    // Automatically apply presets when URL changes
    url(newUrl) {
      if (!newUrl) {
        this.detectedPreset = null;
        return;
      }
      try {
        const hostname = new URL(newUrl).hostname
          .replace("www.", "")
          .toLowerCase();

        // Find matching preset (checking for partial matches like 'github.com' inside 'github.com/user/repo')
        const presetKey = Object.keys(SITE_PRESETS).find((key) =>
          hostname.includes(key)
        );

        if (presetKey) {
          const preset = SITE_PRESETS[presetKey];
          this.detectedPreset = preset.name;

          // Only auto-fill if the user hasn't typed anything yet (prevent overwriting custom config)
          if (!this.config.contentSelector) {
            this.config.contentSelector = preset.selector;
          }
          if (!this.excludePatternsInput) {
            this.excludePatternsInput = preset.exclude;
          }
          // For repos/wikis/hub sites, we often want to follow links, but respect user choice if they toggled it
          if (
            this.config.followExternalLinks === false &&
            preset.followExternal
          ) {
            this.config.followExternalLinks = true;
          }
        } else {
          this.detectedPreset = null;
        }
      } catch (e) {
        // Ignore invalid URLs while typing
        this.detectedPreset = null;
      }
    },
  },
  methods: {
    translate(key, fallback) {
      if (this.$i18n && this.$i18n.t) {
        const translation = this.$i18n.t(key);
        if (translation === key) {
          return fallback || key;
        }
        return translation;
      }
      return fallback || key;
    },
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
          response = await documentFileService.uploadLink(this.url);
        } else {
          // --- FIX START: Construct Clean Configuration Object ---
          const cleanConfig = {
            followExternalLinks: this.config.followExternalLinks,
            maxExternalDepth: this.config.maxExternalDepth,
          };

          // Only attach selector if valid string exists
          if (
            this.config.contentSelector &&
            this.config.contentSelector.trim() !== ""
          ) {
            cleanConfig.contentSelector = this.config.contentSelector.trim();
          }

          // Only attach patterns if array has items
          const excludeArray = this.excludePatternsInput
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0);

          if (excludeArray.length > 0) {
            cleanConfig.excludePatterns = excludeArray;
          }

          // Call scheduleSiteCrawl with sanitized config
          response = await documentFileService.scheduleSiteCrawl({
            url: this.url,
            depth: this.crawlDepth,
            config: cleanConfig,
          });
          // --- FIX END ---
        }

        const fileName = response.data?.file_name || "the file";

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
        this.$emit("link-submitted", response.data);
        this.$emit("close");
      } catch (error) {
        const backendMessage =
          error.response?.data?.message ||
          (typeof error.response?.data === "string"
            ? error.response.data
            : null) ||
          error.message ||
          this.translate(
            "link.errors.generic",
            "Failed to crawl the URL. Please check the link and try again."
          );

        this.errorMessage = backendMessage;
        this.showNotification(backendMessage, "error");
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
  z-index: 9998; /* Updated Z-Index for Teleport */
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
  z-index: 9999; /* Updated Z-Index for Teleport */
  max-height: 90vh;
  overflow-y: auto;
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

/* Advanced Toggle */
.advanced-toggle {
  margin-bottom: 1rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.btn-link {
  background: none;
  border: none;
  color: var(--primary, #3b82f6);
  cursor: pointer;
  font-size: 0.9rem;
  padding: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.preset-badge {
  font-size: 0.75rem;
  background-color: rgba(16, 185, 129, 0.1);
  color: #10b981;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid rgba(16, 185, 129, 0.2);
}
.toggle-icon {
  font-size: 0.7rem;
}
.advanced-panel {
  background-color: var(--bg-section, #f9fafb);
  padding: 1rem;
  border-radius: 4px;
  border: 1px solid var(--border-color, #e5e7eb);
  margin-bottom: 1rem;
}
.checkbox-group {
  flex-direction: row;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}
.checkbox-group input {
  width: 1rem;
  height: 1rem;
  cursor: pointer;
}
.checkbox-group label {
  margin-bottom: 0;
  cursor: pointer;
}
.small-hint {
  margin-top: 0.25rem;
  font-size: 0.75rem;
}

/* Tooltip Styles */
.label-with-tooltip {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.label-with-tooltip label {
  margin-bottom: 0; /* Override default margin */
}

.tooltip-container {
  position: relative;
  display: inline-block;
  cursor: help;
}

.help-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background-color: var(--text-secondary);
  color: var(--bg-dialog);
  font-size: 11px;
  font-weight: bold;
}

.tooltip-text {
  visibility: hidden;
  width: 220px;
  background-color: #333;
  color: #fff;
  text-align: center;
  border-radius: 6px;
  padding: 8px;
  position: absolute;
  z-index: 1;
  bottom: 125%; /* Position above */
  left: 50%;
  margin-left: -110px; /* Center the tooltip */
  opacity: 0;
  transition: opacity 0.3s;
  font-size: 0.8rem;
  line-height: 1.4;
  pointer-events: none;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
}

.tooltip-text::after {
  content: "";
  position: absolute;
  top: 100%;
  left: 50%;
  margin-left: -5px;
  border-width: 5px;
  border-style: solid;
  border-color: #333 transparent transparent transparent;
}

.tooltip-container:hover .tooltip-text {
  visibility: visible;
  opacity: 1;
}
</style>