<template>
  <Teleport to="body">
    <div class="dialog-backdrop" @click="$emit('close')"></div>
    <div class="dialog-container">
      <div class="dialog-header">
        <h2 class="dialog-title">
          {{ translate('admin.documents.addLink', 'Add from Link') }}
        </h2>
        <DsButton
          variant="ghost"
          class="dialog-close-btn"
          :aria-label="translate('common.close', 'Close')"
          @click="$emit('close')"
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
        </DsButton>
      </div>

      <div class="dialog-body">
        <div class="form-group">
          <label for="url-input">{{ translate('link.label', 'Website URL') }}</label>
          <DsInput
            id="url-input"
            v-model="url"
            type="text"
            class="form-input"
            :placeholder="translate('link.placeholder', 'https://example.com/article')"
            @enter="handleSubmit"
          />
          <p v-if="crawlMode === 'single_page'" class="form-hint">
            {{ translate('link.hint', 'The content of the webpage will be crawled and saved as an HTML file.') }}
          </p>
          <p v-else class="form-hint">
            {{
              translate(
                'link.hintAsync',
                'The full site will be crawled in the background and saved as a Markdown file.'
              )
            }}
          </p>
          <p class="form-hint">
            {{
              translate(
                'okf.crawl.postCrawlHint',
                "After the crawl finishes, you can turn it into an OKF repository from the file's Dashboard tab."
              )
            }}
          </p>
        </div>

        <div class="form-group">
          <label>{{ translate('link.crawlMode', 'Crawl Mode') }}</label>
          <div class="radio-group">
            <label class="radio-label">
              <input v-model="crawlMode" type="radio" value="single_page" />
              {{ translate('link.mode.single', 'Single Page') }}
            </label>
            <label class="radio-label">
              <input v-model="crawlMode" type="radio" value="full_site" />
              {{ translate('link.mode.fullSite', 'Full Site (Async)') }}
            </label>
          </div>
        </div>

        <template v-if="crawlMode === 'full_site'">
          <div class="form-group">
            <label for="depth-input">{{ translate('link.crawlDepth', 'Crawl Depth') }}</label>
            <DsInput id="depth-input" v-model.number="crawlDepth" type="number" class="form-input" min="1" max="20" />
            <p class="form-hint">
              {{ translate('link.depthHint', 'Depth of links to follow (1-20).') }}
            </p>
          </div>

          <div class="advanced-toggle">
            <DsButton variant="ghost" class="btn-link" @click="showAdvanced = !showAdvanced">
              {{ showAdvanced ? 'Hide' : 'Show' }}
              {{ translate('link.advancedOptions', 'Advanced Configuration') }}
              <span class="toggle-icon">{{ showAdvanced ? '▲' : '▼' }}</span>
            </DsButton>
            <span v-if="detectedPreset" class="preset-badge"> Matched Preset: {{ detectedPreset }} </span>
          </div>

          <div v-if="showAdvanced" class="advanced-panel">
            <div class="form-group checkbox-group">
              <input id="ext-links" v-model="config.followExternalLinks" type="checkbox" />
              <label for="ext-links">{{ translate('link.config.followExternal', 'Follow External Links') }}</label>
            </div>
            <p v-if="config.followExternalLinks" class="form-hint small-hint">
              Useful for "Awesome Lists". Will crawl pages linked to from this domain.
            </p>

            <div v-if="config.followExternalLinks" class="form-group">
              <label for="ext-depth">{{ translate('link.config.extDepth', 'Max External Depth') }}</label>
              <DsInput
                id="ext-depth"
                v-model.number="config.maxExternalDepth"
                type="number"
                class="form-input"
                min="0"
                max="5"
              />
              <p class="form-hint small-hint">
                0 = Save specific external page only. 1-5 = Depth of links to follow on external domains.
              </p>
            </div>

            <div class="form-group">
              <div class="label-with-tooltip">
                <label for="content-selector">{{ translate('link.config.selector', 'Content CSS Selector') }}</label>
                <div class="tooltip-container">
                  <span class="help-icon">?</span>
                  <div class="tooltip-text">
                    Tells the crawler which HTML element contains the main text (e.g. 'main', 'article', '.content').
                    Leave empty to let the system auto-detect the best content area.
                  </div>
                </div>
              </div>
              <DsInput
                id="content-selector"
                v-model="config.contentSelector"
                type="text"
                class="form-input"
                placeholder="Default: Auto-detect (main, article, body)"
              />
              <p class="form-hint small-hint">Specific container to extract content from (reduces noise).</p>
            </div>

            <div class="form-group">
              <label for="exclude-patterns">{{
                translate('link.config.exclude', 'Exclude Patterns (comma separated)')
              }}</label>
              <DsInput
                id="exclude-patterns"
                v-model="excludePatternsInput"
                type="textarea"
                class="form-input"
                rows="3"
                placeholder="/commits/, /issues/, /login"
              />
            </div>
          </div>
        </template>

        <div v-if="errorMessage" class="error-message">{{ errorMessage }}</div>
      </div>

      <div class="dialog-footer">
        <DsButton variant="secondary" @click="$emit('close')">
          {{ translate('common.cancel', 'Cancel') }}
        </DsButton>
        <DsButton variant="primary" :disabled="!isValidUrl || isLoading" @click="handleSubmit">
          <span v-if="isLoading">{{
            crawlMode === 'full_site'
              ? translate('link.scheduling', 'Scheduling...')
              : translate('link.crawling', 'Crawling...')
          }}</span>
          <span v-else>{{
            crawlMode === 'full_site'
              ? translate('link.submitAsync', 'Start Crawl')
              : translate('link.submit', 'Crawl & Save')
          }}</span>
        </DsButton>
      </div>
    </div>
  </Teleport>
</template>

<script>
import documentFileService from '../services/documentFileService.js';
import { eventBus } from '../eventBus.js';
import DsButton from './ds/Button.vue';
import DsInput from './ds/Input.vue';

// --- TOP 20 SITE PRESETS ---
const SITE_PRESETS = {
  'github.com': {
    name: 'GitHub',
    selector: '.markdown-body',
    exclude:
      '/commits/, /issues, /pulls, /actions, /projects, /security, /pulse, /find, /search, /stargazers, /watchers, /network, /branches, /tags, /blob/, /tree/, /releases',
    followExternal: true
  },
  'gitlab.com': {
    name: 'GitLab',
    selector: '.file-content, .wiki-content, .md',
    exclude:
      '/-/commits, /-/tree, /-/blob, /-/blame, /-/issues, /-/merge_requests, /-/pipelines, /-/jobs, /-/tags, /-/network',
    followExternal: true
  },
  'wikipedia.org': {
    name: 'Wikipedia',
    selector: '#bodyContent',
    exclude:
      'Talk:, User:, User_talk:, Wikipedia:, File:, MediaWiki:, Template:, Help:, Category:, Portal:, Special:, /w/index.php',
    followExternal: false
  },
  'medium.com': {
    name: 'Medium',
    selector: 'article, section',
    exclude: '/signin, /m/signin, /search, /tag/, /@',
    followExternal: false
  },
  'stackoverflow.com': {
    name: 'Stack Overflow',
    selector: '#mainbar, .post-text',
    exclude: '/users/, /posts/, /revisions, /search, /feeds, /timeline, /admin',
    followExternal: false
  },
  'reddit.com': {
    name: 'Reddit',
    // Targets new UI shadow-dom content (shreddit-post) and old/mobile content
    selector: 'shreddit-post, .Post, .post-content, .entry',
    exclude: '/user/, /u/, /search, /message/compose, /submit',
    followExternal: false
  },
  'atlassian.net': {
    // Confluence Cloud
    name: 'Confluence',
    selector: '#main-content, .wiki-content, #content',
    exclude: '/display/, /pages/viewpage.action, /history, /diffpages',
    followExternal: false
  },
  'notion.site': {
    // Notion Public
    name: 'Notion',
    selector: '.notion-page-content',
    exclude: 'login, pricing, /signup',
    followExternal: false
  },
  'readthedocs.io': {
    name: 'Read the Docs',
    selector: '.rst-content, div[role="main"]',
    exclude: '_static, _images, genindex, search.html, py-modindex.html',
    followExternal: false
  },
  'gitbook.io': {
    name: 'GitBook',
    selector: 'main, .gitbook-root',
    exclude: '/s/, /search',
    followExternal: false
  },
  docusaurus: {
    // Generic check for docusaurus sites often works by meta tag, but by domain is hard. We'll add common ones.
    name: 'Docusaurus Site',
    selector: 'article, .theme-doc-markdown, .markdown',
    exclude: '/blog/tags, /search',
    followExternal: false
  },
  'wordpress.com': {
    name: 'WordPress',
    selector: '.entry-content, .post-content, article',
    exclude: '/wp-admin/, /wp-includes/, /feed/, /comments/, /page/, /xmlrpc.php',
    followExternal: false
  },
  'substack.com': {
    name: 'Substack',
    selector: '.available-content, .post',
    exclude: '/sign-in, /subscribe, /people/, /archive',
    followExternal: false
  },
  'dev.to': {
    name: 'Dev.to',
    selector: '#article-body, .crayons-article__body',
    exclude: '/search, /tag/, /top/, /latest, /videos',
    followExternal: false
  },
  'arxiv.org': {
    name: 'ArXiv',
    selector: 'blockquote.abstract, .abstract',
    exclude: '/pdf/, /ps/, /format/, /list/, /find/',
    followExternal: false
  },
  'huggingface.co': {
    name: 'Hugging Face',
    selector: 'section#readme, .readme',
    exclude: '/tree/, /blob/, /resolve/, /discussions, /settings',
    followExternal: true
  },
  'developer.mozilla.org': {
    name: 'MDN Web Docs',
    selector: 'article.main-page-content',
    exclude: '/history, /edit, /users/, /docs/Web/HTML/Global_attributes', // common massive lists
    followExternal: false
  },
  'youtube.com': {
    name: 'YouTube',
    selector: '#description, ytd-video-secondary-info-renderer',
    exclude: '/watch, /channel/, /results, /feed/',
    followExternal: false
  },
  'quora.com': {
    name: 'Quora',
    selector: '.q-box, .q-text',
    exclude: '/profile/, /topic/, /log_in, /unanswered',
    followExternal: false
  },
  'linkedin.com': {
    name: 'LinkedIn Article',
    selector: '.article-main, .pulse-main-content',
    exclude: '/feed, /mynetwork, /jobs, /messaging',
    followExternal: false
  }
};

export default {
  name: 'AddFromLinkDialog',
  components: {
    DsButton,
    DsInput
  },
  emits: ['close', 'link-submitted'],
  data() {
    return {
      url: '',
      crawlMode: 'single_page',
      crawlDepth: 5,
      isLoading: false,
      errorMessage: '',
      // Advanced Config State
      showAdvanced: false,
      excludePatternsInput: '',
      detectedPreset: null,
      config: {
        followExternalLinks: false,
        maxExternalDepth: 0,
        contentSelector: ''
      }
    };
  },
  computed: {
    isValidUrl() {
      try {
        const newUrl = new URL(this.url);
        return newUrl.protocol === 'http:' || newUrl.protocol === 'https:';
      } catch {
        return false;
      }
    }
  },
  watch: {
    // Automatically apply presets when URL changes
    url(newUrl) {
      if (!newUrl) {
        this.detectedPreset = null;
        return;
      }
      try {
        const hostname = new URL(newUrl).hostname.replace('www.', '').toLowerCase();

        // Find matching preset (checking for partial matches like 'github.com' inside 'github.com/user/repo')
        const presetKey = Object.keys(SITE_PRESETS).find((key) => hostname.includes(key));

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
          if (this.config.followExternalLinks === false && preset.followExternal) {
            this.config.followExternalLinks = true;
          }
        } else {
          this.detectedPreset = null;
        }
      } catch {
        // Ignore invalid URLs while typing
        this.detectedPreset = null;
      }
    }
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
          'link.validation.invalidUrl',
          'Please enter a valid URL, including http:// or https://'
        );
        return;
      }

      if (this.crawlMode === 'full_site' && (this.crawlDepth < 1 || this.crawlDepth > 20)) {
        this.errorMessage = this.translate('link.validation.invalidDepth', 'Depth must be between 1 and 20.');
        return;
      }

      this.isLoading = true;
      this.errorMessage = '';

      try {
        let response;

        if (this.crawlMode === 'single_page') {
          response = await documentFileService.uploadLink(this.url);
        } else {
          // --- FIX START: Construct Clean Configuration Object ---
          const cleanConfig = {
            followExternalLinks: this.config.followExternalLinks,
            maxExternalDepth: this.config.maxExternalDepth
          };

          // Only attach selector if valid string exists
          if (this.config.contentSelector && this.config.contentSelector.trim() !== '') {
            cleanConfig.contentSelector = this.config.contentSelector.trim();
          }

          // Only attach patterns if array has items
          const excludeArray = this.excludePatternsInput
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);

          if (excludeArray.length > 0) {
            cleanConfig.excludePatterns = excludeArray;
          }

          // Call scheduleSiteCrawl with sanitized config
          response = await documentFileService.scheduleSiteCrawl({
            url: this.url,
            depth: this.crawlDepth,
            config: cleanConfig
          });
          // --- FIX END ---
        }

        const fileName = response.data?.file_name || 'the file';

        const successMsg =
          this.crawlMode === 'single_page'
            ? this.translate(
                'admin.documents.linkSubmitSuccess',
                'Successfully crawled and saved "{fileName}".'
              ).replace('{fileName}', fileName)
            : this.translate(
                'admin.documents.crawlScheduled',
                'Site crawl scheduled for "{fileName}". Check status in dashboard.'
              ).replace('{fileName}', fileName);

        this.showNotification(successMsg, 'success');
        // UX simplification (David, 2026-09-01): the crawl dialog no longer
        // offers an OKF target or split mode — EVERY crawl is saved as the
        // same combined markdown, and the conversion happens on the file's
        // Dashboard tab ("Create OKF repository from this crawl"), where all
        // split options live in one place, after the file exists. The legacy
        // seed event is kept only for the async path so an already-open
        // Studio wizard can pre-fill the URL (harmless no-op otherwise).
        if (this.crawlMode !== 'single_page') {
          await this.$store.dispatch('okf/setSelection', { crawlSeeds: [this.url.trim()] });
          window.dispatchEvent(
            new CustomEvent('okf:create-from-crawl', {
              detail: { url: this.url.trim(), crawlMode: this.crawlMode, crawlDepth: this.crawlDepth }
            })
          );
        }
        this.$emit('link-submitted', response.data);
        this.$emit('close');
      } catch (error) {
        const backendMessage =
          error.response?.data?.message ||
          (typeof error.response?.data === 'string' ? error.response.data : null) ||
          error.message ||
          this.translate('link.errors.generic', 'Failed to crawl the URL. Please check the link and try again.');

        this.errorMessage = backendMessage;
        this.showNotification(backendMessage, 'error');
      } finally {
        this.isLoading = false;
      }
    },
    showNotification(message, type = 'success') {
      eventBus.$emit('notification:show', { message, type });
    }
  }
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
  background-color: var(--overlay-bg);
  z-index: 9998; /* Updated Z-Index for Teleport */
}
.dialog-container {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 90%;
  max-width: 500px;
  background-color: var(--surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  z-index: 9999; /* Updated Z-Index for Teleport */
  max-height: 90vh;
  overflow-y: auto;
}
.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--border);
}
.dialog-title {
  font-size: var(--text-lg);
  color: var(--fg);
}
.dialog-close-btn {
  /* Layout only - styling handled by DsButton */
}
.dialog-body {
  padding: var(--space-lg);
}
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-md);
  padding: var(--space-md) var(--space-lg);
  border-top: 1px solid var(--border);
}
/* Component-specific styles */
.form-group {
  display: flex;
  flex-direction: column;
  margin-bottom: var(--space-md);
}
.form-group label {
  margin-bottom: var(--space-sm);
  font-weight: 500;
  color: var(--muted);
}
.form-hint {
  font-size: var(--text-base);
  color: var(--muted-soft);
  margin-top: var(--space-sm);
}
.error-message {
  margin-top: var(--space-md);
  color: var(--danger, #ef4444);
  background-color: var(--danger-bg);
  padding: var(--space-md);
  border-radius: var(--radius-sm);
}

/* Radio group styles */
.radio-group {
  display: flex;
  gap: var(--space-lg);
  margin-top: var(--space-xs);
}
.radio-label {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  cursor: pointer;
  font-size: var(--text-base);
  color: var(--fg);
  user-select: none;
}
.radio-label input[type='radio'] {
  cursor: pointer;
  width: 1.1rem;
  height: 1.1rem;
}

/* Advanced Toggle */
.advanced-toggle {
  margin-bottom: var(--space-md);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.btn-link {
  /* Layout only - styling handled by DsButton ghost */
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
.preset-badge {
  font-size: var(--text-sm);
  background-color: var(--success-bg);
  color: var(--success);
  padding: 2px var(--space-sm);
  border-radius: var(--radius-sm);
  border: 1px solid var(--success-bg);
}
.toggle-icon {
  font-size: var(--text-xs);
}
.advanced-panel {
  background-color: var(--bg-tertiary);
  padding: var(--space-md);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  margin-bottom: var(--space-md);
}
.checkbox-group {
  flex-direction: row;
  align-items: center;
  gap: var(--space-sm);
  margin-bottom: var(--space-sm);
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
  margin-top: var(--space-xs);
  font-size: var(--text-sm);
}

/* Tooltip Styles */
.label-with-tooltip {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin-bottom: var(--space-sm);
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
  background-color: var(--muted);
  color: var(--surface);
  font-size: var(--text-xs);
  font-weight: bold;
}

.tooltip-text {
  visibility: hidden;
  width: 220px;
  background: var(--tooltip-bg);
  color: var(--tooltip-fg);
  text-align: center;
  border-radius: var(--radius-md);
  padding: var(--space-sm);
  position: absolute;
  z-index: 1;
  bottom: 125%; /* Position above */
  left: 50%;
  margin-left: -110px; /* Center the tooltip */
  opacity: 0;
  transition: opacity 0.3s;
  font-size: var(--text-base);
  line-height: 1.4;
  pointer-events: none;
  box-shadow: var(--shadow-md);
}

.tooltip-text::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  margin-left: -var(--space-xs);
  border-width: 5px;
  border-style: solid;
  border-color: var(--tooltip-bg) transparent transparent transparent;
}

.tooltip-container:hover .tooltip-text {
  visibility: visible;
  opacity: 1;
}
</style>
