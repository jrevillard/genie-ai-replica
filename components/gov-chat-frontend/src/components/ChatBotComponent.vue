<template>
  <div class="app-container">
    <!-- Main chatbot container -->
    <div class="chatbot-container">
      <!-- New Chat Confirmation Dialog -->
      <ConfirmDialog
        :visible="showNewChatConfirm"
        :title="newChatDialog.title"
        :message="newChatDialog.message"
        :confirm-text="newChatDialog.confirmText"
        :cancel-text="newChatDialog.cancelText"
        :secondary-text="newChatDialog.secondaryText"
        :theme="getCurrentTheme()"
        :parent-styles="{ maxWidth: '450px' }"
        @confirm="saveAndStartNewChat"
        @cancel="startNewChatConfirmed"
        @secondary="cancelNewChat"
      />

      <!-- Unsaved Changes Load Confirmation Dialog -->
      <ConfirmDialog
        :visible="showLoadConfirm"
        :title="loadConfirmDialog.title"
        :message="loadConfirmDialog.message"
        :confirm-text="loadConfirmDialog.confirmText"
        :cancel-text="loadConfirmDialog.cancelText"
        :secondary-text="loadConfirmDialog.secondaryText"
        :theme="getCurrentTheme()"
        :parent-styles="{ maxWidth: '450px' }"
        @confirm="loadConversationConfirmed"
        @cancel="cancelLoadConversation"
        @secondary="saveAndLoadConversation"
      />

      <!-- Export PDF Dialog -->
      <modal-dialog v-if="exportDialog.visible" @close="exportDialog.visible = false">
        <template #header>
          <h3>{{ translate('chatbot.exportChat') }}</h3>
        </template>
        <template #body>
          <div class="form-group">
            <label for="exportFilename">{{ translate('chatbot.exportFilename') }}</label>
            <input
              id="exportFilename"
              v-model="exportDialog.filename"
              type="text"
              :placeholder="translate('chatbot.exportFilenamePlaceholder')"
            />
          </div>
        </template>
        <template #footer>
          <button class="cancel-btn" @click="exportDialog.visible = false">
            {{ translate('common.cancel') }}
          </button>
          <button class="primary-btn" :disabled="!exportDialog.filename.trim()" @click="exportChatToPDF">
            {{ translate('chatbot.exportButton') }}
          </button>
        </template>
      </modal-dialog>

      <!-- System Status Panel -->
      <div v-if="!systemStatus.online || systemStatus.lastResponseTime !== null" class="system-status-panel">
        <div class="status-left">
          <div class="status-indicator" :class="{ online: systemStatus.online }">
            <div class="status-dot"></div>
            <span>{{
              systemStatus.online ? translate('status.online', 'Online') : translate('status.offline', 'Offline')
            }}</span>
          </div>
          <div v-if="!systemStatus.online && systemStatus.errorMessage" class="status-error-message">
            {{ systemStatus.errorMessage }}
          </div>
        </div>
        <div v-if="systemStatus.lastResponseTime !== null" class="status-metric">
          <span class="metric-label">{{ translate('status.lastResponseTime', 'Last response') }}</span>
          <span class="metric-value">{{ systemStatus.lastResponseTime }}ms</span>
        </div>
      </div>
      <!-- Context Panel for selected tree nodes -->
      <div v-if="selectedContextItems.length > 0" class="context-panel">
        <div class="context-header">
          <span class="context-title">{{ translate('chatbot.queryContext') }}</span>
        </div>
        <div class="context-items">
          <div v-for="(item, index) in selectedContextItems" :key="index" class="context-item">
            <span class="context-text">{{ item.service }}</span>
            <button
              class="context-remove-btn"
              :aria-label="translate('chatbot.removeItem')"
              @click="removeContextItem(index)"
            >
              ✕
            </button>
          </div>
        </div>
      </div>
      <!-- The scrollable chat window -->
      <div ref="chatWindow" class="chat-window" aria-live="polite">
        <div v-for="(msg, index) in chatMessages" :key="index" class="chat-message" :class="msg.sender">
          <div class="message-bubble">
            <!-- Render bot messages as sanitized HTML for Markdown, user messages as plain text -->
            <span v-if="msg.sender === 'user'">{{ msg.content }}</span>
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div v-else v-html="renderMarkdown(msg.content)"></div>
          </div>
          <!-- Feedback and confidence score for bot messages -->
          <div v-if="msg.sender === 'bot'" class="bot-message-meta">
            <div v-if="messageConfidence(msg) != null" class="confidence-score">
              <i class="fas fa-brain"></i>
              <span>Confidence: {{ Math.min(99, Math.round((messageConfidence(msg) || 0) * 100)) }}%</span>
            </div>
            <div v-if="msg.queryId" class="feedback-trigger">
              <button @click="openFeedbackDialog(index)">
                {{ translate('feedback.button') }}
              </button>
            </div>
          </div>
        </div>
        <!-- Auto-scroll anchor element -->
        <div ref="messagesEnd"></div>
      </div>
      <!-- Loading spinner with "Thinking..." text -->
      <div v-if="isLoading" class="loading-spinner" aria-label="Processing your request">
        <i class="fas fa-spinner fa-spin"></i>
        <span class="loading-text">Thinking...</span>
      </div>
      <!-- Quick Help Overlay -->
      <div v-if="quickHelpVisible" class="quick-help-overlay">
        <div class="quick-help-content">
          <h2 class="quick-help-heading">
            {{ translate('chatbot.whatCanIHelp') }}
          </h2>

          <div class="quick-help-grid">
            <div
              v-for="button in quickHelpButtons"
              :key="button.id"
              class="quick-help-item"
              :class="{ 'just-chat': !button.category }"
              @click="selectQuickHelpOption(button)"
            >
              <img class="quick-help-icon" :src="button.icon" alt="Quick Help Icon" />
              <div class="quick-help-text">{{ $t(button.textKey) }}</div>
            </div>
          </div>
        </div>
      </div>
      <!-- Input Area -->
      <div class="chat-input">
        <textarea
          v-model="newMessage"
          class="prompt-textarea"
          rows="4"
          :placeholder="translate('chatbot.placeholder')"
          @keyup.enter.exact.prevent="sendMessage"
          @focus="handleTextareaFocus"
        ></textarea>
        <div class="input-actions">
          <button class="new-chat-btn" :title="translate('chatbot.newChat')" @click="startNewChat">
            <i class="fas fa-plus"></i>
          </button>
          <button
            v-if="chatMessages.length > 0"
            class="save-chat-btn"
            :title="translate('chatbot.saveChat')"
            :disabled="isSaving"
            @click="saveChatToHistory"
          >
            <i v-if="!isSaving" class="fas fa-save"></i>
            <i v-else class="fas fa-spinner fa-spin"></i>
          </button>
          <button
            v-if="chatMessages.length > 0"
            class="export-chat-btn"
            :title="translate('chatbot.exportChat')"
            @click="openExportDialog"
          >
            <i class="fas fa-file-pdf"></i>
          </button>
          <button class="send-btn" @click="sendMessage">
            {{ translate('chatbot.sendButton') }}
          </button>
        </div>
      </div>
      <!-- Feedback Dialog -->
      <chat-response-feedback-dialog
        v-if="feedbackDialog.visible"
        :visible="feedbackDialog.visible"
        :message="feedbackDialog.message"
        @close="closeFeedbackDialog"
        @submit="handleFeedbackSubmit"
      />
      <!-- Save Chat Dialog -->
      <modal-dialog
        v-if="saveChatDialog.visible"
        :close-on-click-modal="!isSaving"
        :close-on-press-escape="!isSaving"
        @close="isSaving ? null : (saveChatDialog.visible = false)"
      >
        <template #header>
          <h3>{{ translate('chatbot.saveChat') }}</h3>
        </template>
        <template #body>
          <div class="form-group">
            <label for="chatTitle">{{ translate('chatbot.chatTitle') }}</label>
            <input
              id="chatTitle"
              v-model="saveChatDialog.title"
              type="text"
              :placeholder="translate('chatbot.chatTitlePlaceholder')"
              :disabled="isSaving"
            />
          </div>
          <div class="form-group">
            <label for="chatFolder">{{ translate('chatbot.selectFolder') }}</label>
            <select id="chatFolder" v-model="saveChatDialog.folderId" :disabled="isSaving">
              <option v-for="folder in folders" :key="folder.id" :value="folder.id">
                {{ folder.name }}
              </option>
            </select>
          </div>
          <!-- Loading Indicator -->
          <div v-if="isSaving" class="saving-indicator">
            <i class="fas fa-spinner fa-spin"></i>
            <span>{{ translate('chatbot.savingConversation') }}</span>
          </div>
        </template>
        <template #footer>
          <button class="cancel-btn" :disabled="isSaving" @click="saveChatDialog.visible = false">
            {{ translate('common.cancel') }}
          </button>
          <button class="primary-btn" :disabled="isSaving || !saveChatDialog.title.trim()" @click="handleSaveChat">
            <span v-if="isSaving">
              <i class="fas fa-spinner fa-spin"></i>
              {{ translate('chatbot.saving') }}
            </span>
            <span v-else>{{ translate('common.save') }}</span>
          </button>
        </template>
      </modal-dialog>
    </div>
    <!-- Right Sidebar - Now using the dedicated component -->
    <right-side-bar-component
      :current-chat-id="currentChatId"
      :current-locale="currentLocale"
      :translations="translations"
      :related-documents="relatedDocuments"
      @load-chat="loadChatFromHistory"
      @open-document="handleOpenDocument"
      @sidebar-toggle="handleSidebarToggle"
    />
  </div>
</template>

<script>
import { eventBus } from '../eventBus.js';
import notificationService from '../services/notificationService';
import { mapGetters, mapActions } from 'vuex';
import { getUserId } from '../utils/userUtils';
import ChatResponseFeedbackDialog from './ChatResponseFeedbackDialog.vue';
import ModalDialog from './ModalDialog.vue';
import RightSideBarComponent from './RightSideBarComponent.vue';
import chatbotService from '../services/chatbotService';
import serviceTreeService, { DOCUMENT_METATAGS_CAT_KEY } from '../services/serviceTreeService'; // *** NEW: Import serviceTreeService
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import chatHistoryService from '../services/chatHistoryService';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import jsPDF from 'jspdf';

export default {
  name: 'ChatBotComponent',
  components: {
    ChatResponseFeedbackDialog,
    ModalDialog,
    RightSideBarComponent,
    ConfirmDialog
  },

  data() {
    return {
      conversationId: null,
      messages: [],
      chatMessages: [],
      newMessage: '',
      selectedContextItems: [],
      feedbackDialog: {
        visible: false,
        message: null
      },
      saveChatDialog: {
        visible: false,
        title: '',
        folderId: 'default'
      },
      exportDialog: {
        visible: false,
        filename: ''
      },
      currentChatId: null,
      currentChatTitle: '',
      currentLocale: 'en',
      showQuickHelp: true,
      currentCategoryId: null,
      serviceCategories: [], // This will now hold the transformed tree data
      chatHistoryService: chatHistoryService,
      systemStatus: {
        online: true,
        lastResponseTime: null, // Replaced avgResponseTime
        errorMessage: '', // Added for error messages
        lastUpdated: new Date()
      },
      quickHelpButtons: [],
      showNewChatConfirm: false,
      newChatDialog: {
        title: '',
        message: '',
        confirmText: '',
        cancelText: ''
      },
      lastSavedState: {
        messages: [],
        contextItems: []
      },
      showLoadConfirm: false,
      loadConfirmDialog: {
        title: '',
        message: '',
        confirmText: '',
        cancelText: '',
        secondaryText: ''
      },
      pendingConversationId: null,
      isLoading: false, // Loading state for spinner
      isSaving: false, // Loading state for save operation to prevent double-save
      relatedDocuments: [], // Holds documents for the right sidebar
      hiddenPromptForNextMessage: null // Stores hidden prompt for dual-prompt mechanism
    };
  },

  computed: {
    ...mapGetters('chatHistory', ['getAllFolders', 'getChatById']),

    folders() {
      return this.getAllFolders;
    },

    chatPreview() {
      const userMessage = this.chatMessages.find((msg) => msg.sender === 'user');
      if (userMessage) {
        return userMessage.content.length > 50 ? userMessage.content.substring(0, 47) + '...' : userMessage.content;
      }
      return 'New conversation';
    },

    quickHelpVisible() {
      return this.showQuickHelp && !this.chatMessages.some((m) => m.sender === 'user');
    }
  },

  watch: {
    currentLocale: function () {
      this.updateDialogTexts();
    }
  },

  created() {
    marked.use({
      gfm: true,
      breaks: true
    });

    eventBus.$on('chat-deleted', (deletedChatId) => {
      if (this.conversationId === deletedChatId) {
        this.conversationId = null;
        this.currentChatId = null;
        this.chatMessages = [
          {
            sender: 'bot',
            content: this.translate('chatbot.welcomeMessage'),
            timestamp: new Date().toISOString(),
            isSaved: true
          }
        ];
        this.newMessage = '';
        this.selectedContextItems = [];
        this.relatedDocuments = [];
        this.lastSavedState = {
          messages: JSON.parse(JSON.stringify(this.chatMessages)),
          contextItems: []
        };
        console.log(`Reset conversation ID after deletion of chat ${deletedChatId}`);
      }
    });

    eventBus.$on('load-conversation', (conversationId) => {
      if (conversationId === this.conversationId) {
        // Same conversation, no need to load
        return;
      }
      if (this.hasUnsavedChanges()) {
        this.pendingConversationId = conversationId;
        this.showLoadConfirm = true;
      } else {
        this.chatMessages = []; // Clear previous messages
        this.selectedContextItems = [];
        this.relatedDocuments = [];
        this.lastSavedState = { messages: [], contextItems: [] }; // Reset state
        this.loadExistingConversation(conversationId);
      }
    });
  },

  mounted() {
    if (this.chatMessages.length === 0) {
      this.chatMessages.push({
        sender: 'bot',
        content: this.translate('chatbot.welcomeMessage')
      });
    }

    if (this.$root.$i18n) {
      this.currentLocale = this.$root.$i18n.locale;
      this.$watch(
        () => this.$root.$i18n.locale,
        (newLocale) => {
          this.currentLocale = newLocale;
          // Update context labels when locale changes
          this.selectedContextItems = this.selectedContextItems.map((item) => ({
            ...item,
            service: this.safeTranslate(item.serviceKey || item.service)
          }));
          this.loadServiceCategories().then(() => this.loadQuickHelpButtons());
        }
      );
    }

    eventBus.$on('treeNodeSelected', this.handleTreeNodeSelected);
    eventBus.$on('open-chat', this.loadChatFromHistory);
    this.scrollToBottom();
    this.loadServiceCategories()
      .then(() => this.loadQuickHelpButtons())
      .catch((err) => {
        console.error('[ChatBotComponent] Failed to load categories or quick help:', err);
      });

    // Removed the statusUpdateInterval
    this.updateDialogTexts();
  },

  beforeUnmount() {
    eventBus.$off('treeNodeSelected', this.handleTreeNodeSelected);
    eventBus.$off('open-chat', this.loadChatFromHistory);
    eventBus.$off('chat-deleted'); // Clean up the chat-deleted listener
    // Removed clearInterval
    eventBus.$off('load-conversation');
  },

  methods: {
    ...mapActions('chatHistory', ['createChat', 'updateChat']),

    /** Bot message confidence for display; 0 is valid. Checks top-level and saved metadata. */
    messageConfidence(msg) {
      if (!msg || msg.sender !== 'bot') return null;
      if (typeof msg.confidenceScore === 'number' && Number.isFinite(msg.confidenceScore)) {
        return msg.confidenceScore;
      }
      const cs = msg.metadata && msg.metadata.confidence_score;
      if (typeof cs === 'number' && Number.isFinite(cs)) return cs;
      return null;
    },

    // *** UPDATED: Use serviceTreeService to load and transform categories ***
    async loadServiceCategories() {
      try {
        // Use the service which handles transformation and localization
        this.serviceCategories = await serviceTreeService.getAllCategories(this.currentLocale);
        console.log(
          '[ChatBotComponent] Service categories loaded for lookup via serviceTreeService:',
          this.serviceCategories
        );
      } catch (error) {
        console.error('[ChatBotComponent] Failed to load service categories:', error);
        notificationService.error('Could not load service categories.');
      }
    },

    // *** UPDATED: Find category label by its key in the transformed tree data ***
    getCategoryLabelById(id) {
      if (id === null || id === undefined || id === '') {
        const selectedServices = this.selectedContextItems.map((item) => item.serviceKey);
        if (selectedServices.includes('quickhelp.justChat')) {
          return 'General';
        }
        return null;
      }

      const idStr = String(id);
      const category = this.serviceCategories.find((cat) => cat.catKey === idStr || cat.catKey == idStr);
      if (category) {
        return category.name || category.nameEN || `Category ${id}`;
      }

      const qh = (this.quickHelpButtons || []).find((b) => b.category != null && String(b.category) === idStr);
      if (qh && qh.service) {
        return qh.service;
      }

      console.warn(`[ChatBotComponent] Category label for ID "${id}" not found.`);
      return `Category ${id}`; // Fallback
    },

    checkContextConfig(context) {
      const user = this.$store.getters.currentUser;
      if (!user || !(user.roles || []).map((r) => r.toLowerCase()).includes('admin')) return;

      if (!context || (!context.categoryLabel && !(context.serviceLabels && context.serviceLabels.length))) {
        return;
      }

      const warnings = [];
      if (context.categoryLabel && /^Category \d+$/.test(context.categoryLabel)) {
        warnings.push(`Category "${context.categoryLabel}" not found in knowledge hierarchy`);
      }
      if (context.serviceLabels?.length > 0) {
        for (const label of context.serviceLabels) {
          const item = this.selectedContextItems.find((i) => i.service === label);
          if (!item?.serviceKey?.startsWith('quickhelp.') || item.serviceKey === 'quickhelp.justChat') {
            continue;
          }
          const configured = (this.quickHelpButtons || []).some((b) => b.textKey === item.serviceKey);
          if (!configured) {
            warnings.push(`Service "${label}" uses Quick Help but no matching entry was found in genie-ai-config.json`);
          }
        }
      }
      if (warnings.length > 0) {
        notificationService.warning(
          `Configuration mismatch: ${warnings.join('; ')}. Please check the Quick Help and knowledge hierarchy configuration.`,
          8000
        );
      }
    },

    // Safely translate a key, with mapping for static strings
    safeTranslate(key) {
      try {
        const serviceKeyMap = {
          'Layanan Pelanggan': 'context.customerService',
          Pembayaran: 'context.payment',
          Pengiriman: 'context.shipping',
          'Layanan Kesehatan': 'context.healthService',
          Perumahan: 'context.housing',
          Imigrasi: 'context.immigration',
          Pendidikan: 'context.education',
          Pajak: 'context.tax',
          Pensiun: 'context.retirement',
          'Lainnya - Pribadi': 'context.personalOther'
        };
        const translationKey = serviceKeyMap[key] || key;
        if (typeof translationKey === 'string' && translationKey.trim()) {
          const translated = this.$t(translationKey);
          return translated !== translationKey ? translated : key;
        }
        console.warn(`Invalid translation key: ${key}`);
        return this.$t('context.fallback') || key || 'Unknown';
      } catch (error) {
        console.error(`Translation error for key ${key}:`, error);
        return this.$t('context.fallback') || key || 'Unknown';
      }
    },

    // Render Markdown safely
    renderMarkdown(content) {
      try {
        const html = marked.parse(content);
        return DOMPurify.sanitize(html);
      } catch (error) {
        console.error('Error rendering Markdown:', error);
        return DOMPurify.sanitize(content);
      }
    },

    async loadQuickHelpButtons() {
      console.log('[ChatBotComponent] Loading Quick Help buttons from config');
      try {
        if (!this.serviceCategories || this.serviceCategories.length === 0) {
          await this.loadServiceCategories();
        }
        const allCategories = this.serviceCategories || [];

        const { loadConfig } = await import('../main.js');
        const config = await loadConfig();
        const buttons = config?.features?.chat?.quickHelp?.buttons || [];
        const unresolvedQuickHelp = [];
        this.quickHelpButtons = buttons.map((button) => {
          if (this.$t(button.title) === button.title) {
            console.warn(`[ChatBotComponent] Missing i18n key: ${button.title}`);
          }
          const resolvedCategory = this.resolveQuickHelpCategoryFromConfig(button, allCategories);
          if (
            resolvedCategory == null &&
            (button.categoryNameEN || button.categoryName) &&
            String(button.categoryNameEN || button.categoryName).trim()
          ) {
            unresolvedQuickHelp.push(button.id);
          }
          return {
            service: this.$t(button.title),
            textKey: button.title,
            visibleTextKey: button.action.visibleText,
            hiddenPromptKey: button.action.hiddenPrompt,
            icon: button.icon.value,
            category: resolvedCategory,
            id: button.id
          };
        });
        if (unresolvedQuickHelp.length > 0) {
          console.debug(
            `[ChatBotComponent] Quick Help: no category/service match for ids: ${unresolvedQuickHelp.join(
              ', '
            )}. Align categoryNameEN with a category nameEN, a service label under a category, document metatag, or set category to a valid catKey. Rebuild the frontend after config/code changes.`
          );
        }
        console.log(
          `[ChatBotComponent] Loaded ${buttons.length} Quick Help buttons:`,
          buttons.map((b) => ({
            id: b.id,
            title: b.title,
            category: b.category,
            categoryNameEN: b.categoryNameEN
          }))
        );
      } catch (error) {
        console.error('[ChatBotComponent] Failed to load Quick Help config:', error);
        this.quickHelpButtons = [];
      }
    },

    /**
     * Normalize English category labels for matching config to DB nameEN.
     * @param {string} s
     * @returns {string}
     */
    normalizeCategoryMatchName(s) {
      return String(s || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
    },

    /**
     * Normalize for fuzzy match (punctuation, ampersand).
     * @param {string} s
     * @returns {string}
     */
    normalizeCategoryMatchLoose(s) {
      return String(s || '')
        .trim()
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9\s]+/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    },

    /**
     * Map Quick Help config to serviceCategories._key (catKey).
     * Prefer categoryNameEN (matches Arango nameEN or a service label under a category).
     * @param {object} button - Raw button from genie-ai-config.json
     * @param {Array<{ catKey: string, nameEN?: string, name?: string, children?: string[] }>} hierarchyCategories
     * @returns {string|null}
     */
    _flattenCategoryComparableStrings(categoryRow) {
      const out = [];
      if (!categoryRow || !categoryRow.catKey) {
        return out;
      }
      const push = (s) => {
        const t = String(s || '').trim();
        if (t) {
          out.push(t);
        }
      };
      push(categoryRow.nameEN);
      push(categoryRow.name);
      if (Array.isArray(categoryRow.children)) {
        categoryRow.children.forEach((ch) => push(ch));
      }
      if (categoryRow.catKey === DOCUMENT_METATAGS_CAT_KEY && Array.isArray(categoryRow.metatagGroups)) {
        categoryRow.metatagGroups.forEach((g) => {
          (g.entries || []).forEach((e) => {
            if (e && e.text) {
              push(e.text);
            }
          });
        });
      }
      return out;
    },

    resolveQuickHelpCategoryFromConfig(button, hierarchyCategories) {
      const rows = Array.isArray(hierarchyCategories) ? hierarchyCategories : [];
      const nameLookup = button.categoryNameEN || button.categoryName;

      if (rows.length === 0) {
        return null;
      }

      const tryMatchWant = (wantStrict, wantLoose, idSlugLoose) => {
        let hit = null;
        if (wantStrict) {
          hit = rows.find((c) => this.normalizeCategoryMatchName(c.nameEN) === wantStrict);
          if (!hit) {
            hit = rows.find((c) => this.normalizeCategoryMatchName(c.name) === wantStrict);
          }
        }
        if (!hit && wantLoose) {
          hit = rows.find((c) => this.normalizeCategoryMatchLoose(c.nameEN || '') === wantLoose);
        }
        if (!hit && wantLoose) {
          hit = rows.find((c) => this.normalizeCategoryMatchLoose(c.name || '') === wantLoose);
        }
        if (!hit && wantLoose) {
          for (const c of rows) {
            if (!c || !c.catKey) {
              continue;
            }
            const flat = this._flattenCategoryComparableStrings(c);
            for (const raw of flat) {
              const childLoose = this.normalizeCategoryMatchLoose(raw);
              if (!childLoose) {
                continue;
              }
              if (childLoose === wantLoose) {
                hit = c;
                break;
              }
              if (wantLoose.length >= 4 && (childLoose.includes(wantLoose) || wantLoose.includes(childLoose))) {
                hit = c;
                break;
              }
            }
            if (hit) {
              break;
            }
          }
        }
        if (!hit && idSlugLoose) {
          hit = rows.find((c) => {
            const flat = this._flattenCategoryComparableStrings(c);
            return flat.some((raw) => this.normalizeCategoryMatchLoose(raw) === idSlugLoose);
          });
        }
        if (!hit && button.id) {
          const bid = String(button.id).trim().toLowerCase();
          hit = rows.find((c) => String(c.catKey || '').toLowerCase() === bid);
        }
        return hit || null;
      };

      if (nameLookup && String(nameLookup).trim()) {
        const wantStrict = this.normalizeCategoryMatchName(nameLookup);
        const wantLoose = this.normalizeCategoryMatchLoose(nameLookup);
        const idSlugLoose = button.id ? this.normalizeCategoryMatchLoose(String(button.id).replace(/-/g, ' ')) : '';
        const hit = tryMatchWant(wantStrict, wantLoose, idSlugLoose);
        if (hit) {
          return hit.catKey;
        }
      } else if (button.id) {
        const idSlugLoose = this.normalizeCategoryMatchLoose(String(button.id).replace(/-/g, ' '));
        const hit = tryMatchWant('', idSlugLoose, idSlugLoose);
        if (hit) {
          return hit.catKey;
        }
      }

      const explicit = button.category;
      if (explicit === null || explicit === undefined || explicit === '') {
        return null;
      }
      const ex = String(explicit).trim();
      if (rows.some((c) => String(c.catKey) === ex)) {
        return ex;
      }
      console.warn(
        `[ChatBotComponent] Quick Help "${button.id}": category "${ex}" is not a serviceCategories _key in this deployment. Prefer categoryNameEN aligned with nameEN.`
      );
      return null;
    },

    getCurrentTheme() {
      const documentTheme = document.documentElement.getAttribute('data-theme');
      const bodyTheme = document.body.getAttribute('data-theme');
      return documentTheme || bodyTheme || 'light';
    },

    // formatUptime method removed

    handleSidebarToggle(collapsed) {
      console.log('Sidebar collapsed state:', collapsed);
    },

    handleOpenDocument(doc) {
      console.log('Document opened:', doc);
    },

    translate(key) {
      return this.$t(key);
    },

    /**
     * Build Related Documents from POST /queries metadata. ChatQnA uses source_documents (snake_case);
     * tolerate camelCase or alternate keys. Dedupes by file id. Replaces sidebar each turn — only chunks used for the answer.
     */
    mapMetadataToRelatedDocuments(metadata) {
      if (!metadata || typeof metadata !== 'object') {
        return [];
      }
      const raw =
        metadata.source_documents ||
        metadata.sourceDocuments ||
        metadata.sources ||
        metadata.retrieved_documents ||
        metadata.retrievedDocuments ||
        [];
      if (!Array.isArray(raw)) {
        return [];
      }
      const out = [];
      const seen = new Set();
      for (const doc of raw) {
        if (!doc || typeof doc !== 'object') continue;
        const id =
          doc.document_id ||
          doc.file_id ||
          doc.id ||
          doc.documentId ||
          (doc.metadata && (doc.metadata.file_id || doc.metadata.fileId));
        if (!id || String(id) === 'error') continue;
        const sid = String(id);
        if (seen.has(sid)) continue;
        seen.add(sid);
        const fileName = doc.file_name || doc.fileName || '';
        const documentName = doc.document_name || doc.documentName || '';
        const title =
          documentName ||
          fileName ||
          doc.title ||
          (typeof doc.text === 'string' ? `${doc.text.slice(0, 72).trim()}…` : '') ||
          `Source ${sid.slice(0, 8)}`;
        const url = doc.url || '';
        const ext = url && url.includes('.') ? url.split('.').pop().split('?')[0].toUpperCase() : 'DOC';
        out.push({
          id: sid,
          title,
          documentName: documentName || null,
          fileName: fileName || null,
          type: ext.length <= 8 ? ext : 'DOC',
          size: 0,
          url,
          score: typeof doc.score === 'number' ? doc.score : null,
          categoryLabel: doc.categoryLabel,
          serviceLabels: Array.isArray(doc.serviceLabels) ? doc.serviceLabels : []
        });
      }
      return out;
    },

    selectQuickHelpOption(option) {
      console.log(`[ChatBotComponent] Quick Help button clicked: id=${option.id}, textKey=${option.textKey}`);
      const rawOption = option && option.__v_isReactive ? { ...option } : option || {};
      if (!rawOption.service) {
        console.error('Invalid quick help option, missing service:', rawOption);
        return;
      }

      const isJustChat = rawOption.textKey === 'quickhelp.justChat' || rawOption.id === 'just-chat';

      if (isJustChat) {
        this.currentCategoryId = null;
        this.selectedContextItems = this.selectedContextItems.filter(
          (item) =>
            !item.serviceKey ||
            !String(item.serviceKey).startsWith('quickhelp.') ||
            item.serviceKey === 'quickhelp.justChat'
        );
      }

      const categoryId = rawOption.category != null && rawOption.category !== '' ? rawOption.category : null;

      const contextExists = this.selectedContextItems.some(
        (item) => item.service === rawOption.service && item.category === categoryId
      );

      if (!contextExists) {
        this.selectedContextItems.push({
          service: rawOption.service,
          serviceKey: rawOption.textKey,
          category: categoryId,
          selected: true
        });
        console.log(`Added new context item: ${rawOption.service} with category ID ${categoryId}`);
      } else {
        console.log(`Context item ${rawOption.service} with category ID ${categoryId} already exists`);
      }

      if (rawOption.service !== this.$t('quickhelp.justChat')) {
        this.currentCategoryId = categoryId;
        console.log(`Set current category ID to ${this.currentCategoryId} from quick help option.`);
      }

      // "Just chat" uses the same dual-prompt path as other chips (visible user line + hidden routing in
      // context.topicFocusInstructions) so the assistant always replies with helpful Lesotho-farming guidance.

      if (rawOption.hiddenPromptKey) {
        // Display the visible text in the chat (what user sees)
        const visibleMessage = this.$t(rawOption.visibleTextKey);
        this.newMessage = visibleMessage;

        // Store the hidden prompt to send to backend (what LLM sees)
        this.hiddenPromptForNextMessage = this.$t(rawOption.hiddenPromptKey);
        this.sendMessage();
      }
    },

    handleTextareaFocus() {
      // No-op: quick-help visibility is now driven by whether a user message has been sent.
    },

    handleTreeNodeSelected(item) {
      if (!item || typeof item !== 'object' || !item.service) {
        console.warn('Invalid tree node selected:', item);
        return;
      }

      if (item.selected) {
        const exists = this.selectedContextItems.some(
          (existing) => existing.service === this.safeTranslate(item.service) && existing.category === item.category
        );
        if (!exists) {
          this.selectedContextItems.push({
            service: this.safeTranslate(item.service),
            serviceKey: item.service,
            category: item.category || 'general',
            selected: true
          });
          console.log(
            `Added sidebar context item: ${this.safeTranslate(
              item.service
            )} with category ID ${item.category || 'general'}`
          );
          notificationService.info(this.translate('chatbot.contextAdded'), 1500);
          if (!this.currentCategoryId) {
            this.currentCategoryId = item.category || null;
            console.log(`Set current category ID to ${this.currentCategoryId} from sidebar node.`);
          }
        } else {
          console.log(
            `Context item ${this.safeTranslate(item.service)} with category ID ${item.category} already exists`
          );
        }
      } else {
        const index = this.selectedContextItems.findIndex(
          (existing) => existing.service === this.safeTranslate(item.service) && existing.category === item.category
        );
        if (index !== -1) {
          const removedItem = this.selectedContextItems.splice(index, 1)[0];
          console.log(`Removed sidebar context item: ${removedItem.service} with category ID ${removedItem.category}`);
          notificationService.info(this.translate('chatbot.contextRemoved'), 1500);
          eventBus.$emit('contextItemRemoved', removedItem);
          if (this.selectedContextItems.length === 0) {
            this.currentCategoryId = null;
            console.log('Cleared current category ID as no context items remain.');
          }
        }
      }
    },

    removeContextItem(index) {
      if (this.selectedContextItems.length > index) {
        const removedItem = this.selectedContextItems.splice(index, 1)[0];
        console.log(`Removed context item: ${removedItem.service} at index ${index}`);
      }
      if (this.selectedContextItems.length === 0 && this.currentCategoryId) {
        const quickHelpOption = this.quickHelpButtons.find((option) => option.category === this.currentCategoryId);
        if (quickHelpOption) {
          this.selectedContextItems = [
            {
              service: this.safeTranslate(quickHelpOption.textKey),
              serviceKey: quickHelpOption.textKey,
              category: this.currentCategoryId,
              selected: true
            }
          ];
          console.log(
            `Restored context item for category ID ${
              this.currentCategoryId
            }: ${this.safeTranslate(quickHelpOption.textKey)}`
          );
        } else {
          this.currentCategoryId = null;
        }
      }
    },

    async sendMessage() {
      const content = this.newMessage.trim();
      if (!content) return;

      // Dual-prompt: visible text stays in `messages` for retrieval; hidden routing rules go in context.topicFocusInstructions.
      const messageForBackend = this.hiddenPromptForNextMessage || content;
      const messageForDisplay = content;
      const hasDualPrompt = messageForBackend !== messageForDisplay;

      this.chatMessages.push({
        sender: 'user',
        content: messageForDisplay,
        timestamp: new Date().toISOString(),
        isSaved: false
      });
      this.newMessage = '';
      this.showQuickHelp = false;
      this.isLoading = true;
      // Clear hidden prompt after use
      this.hiddenPromptForNextMessage = null;
      // Do NOT clear relatedDocuments here. We want to keep previous docs visible.

      const startTime = performance.now(); // Start timing

      try {
        const useConversationContext = this.selectedContextItems.length > 0;
        const HISTORY_LIMIT = 10;
        let categoryLabel = this.getCategoryLabelById(this.currentCategoryId);
        if ((!categoryLabel || /^Category \d+$/.test(String(categoryLabel))) && useConversationContext) {
          const qhItem = this.selectedContextItems.find(
            (i) =>
              i.serviceKey && String(i.serviceKey).startsWith('quickhelp.') && i.serviceKey !== 'quickhelp.justChat'
          );
          if (qhItem && qhItem.service) {
            categoryLabel = qhItem.service;
          }
        }
        console.log(`[ChatBotComponent] Resolved Category ID "${this.currentCategoryId}" to Label "${categoryLabel}"`);

        // Always carry the last N chat turns to the backend so follow-ups inherit prior context.
        const messagesForQuery = this.chatMessages.slice(-HISTORY_LIMIT).map((msg) => ({
          role: msg.sender === 'user' ? 'user' : 'assistant',
          content: msg.content
        }));

        const serviceLabels = useConversationContext
          ? this.selectedContextItems
              .filter((item) => item.serviceKey !== 'quickhelp.justChat')
              .map((item) => item.service)
          : [];

        const queryData = {
          conversationId: this.conversationId,
          sessionId: this.currentSessionId || 'new-session',
          messages: messagesForQuery,
          context: {
            categoryLabel: useConversationContext ? categoryLabel : undefined,
            serviceLabels: serviceLabels,
            language: this.currentLocale.toUpperCase(),
            ...(hasDualPrompt ? { topicFocusInstructions: messageForBackend } : {})
          },
          contextOption: useConversationContext ? 'conversation-with-context-labels' : 'conversation',
          timestamp: new Date().toISOString()
        };
        console.log('Submitting query with data:', JSON.stringify(queryData, null, 2));

        this.checkContextConfig(queryData.context);

        const result = await chatbotService.submitQuery(queryData);

        // --- Success State Update ---
        const endTime = performance.now();
        this.systemStatus.lastResponseTime = Math.round(endTime - startTime);
        this.systemStatus.online = true;
        this.systemStatus.errorMessage = '';
        this.systemStatus.lastUpdated = new Date();
        // --------------------------

        console.log('Query result:', result);
        const botMessage = {
          sender: 'bot',
          content: result.response || this.translate('chatbot.processingError'),
          queryId: result.queryId,
          timestamp: new Date().toISOString(),
          isSaved: false,
          // CRITICAL FIX: Attach the full metadata object so it can be saved later
          metadata: result.metadata || {}
        };

        if (result.metadata) {
          const cs = result.metadata.confidence_score;
          if (typeof cs === 'number' && Number.isFinite(cs)) {
            botMessage.confidenceScore = cs;
          }
          // Show only sources retrieved for this answer (RAG), not accumulated history
          this.relatedDocuments = this.mapMetadataToRelatedDocuments(result.metadata);
        } else {
          this.relatedDocuments = [];
        }
        this.chatMessages.push(botMessage);
        if (result.sessionId) {
          this.currentSessionId = result.sessionId;
        }
      } catch (error) {
        // --- Error State Update ---
        this.systemStatus.lastResponseTime = null; // No successful response time
        this.systemStatus.online = false;
        this.systemStatus.errorMessage = error.message || this.translate('chatbot.processingError');
        this.systemStatus.lastUpdated = new Date();
        // ------------------------

        console.error('Error sending query:', error);
        this.chatMessages.push({
          sender: 'bot',
          content: this.translate('chatbot.processingError'),
          timestamp: new Date().toISOString(),
          queryId: null,
          isSaved: false
        });
        notificationService.error(this.translate('chatbot.processingError'));
      } finally {
        this.isLoading = false;
      }
      this.scrollToBottom();
      if (this.currentChatId) {
        this.updateChatInHistory();
      }
    },

    openFeedbackDialog(index) {
      this.feedbackDialog = {
        visible: true,
        message: this.chatMessages[index]
      };
    },

    closeFeedbackDialog() {
      this.feedbackDialog.visible = false;
    },

    async handleFeedbackSubmit(feedback) {
      const queryId = feedback.message.queryId;
      if (!queryId) {
        console.error('Cannot submit feedback: No queryId found for message');
        notificationService.error(this.translate('chatbot.feedbackMissingQueryId'));
        this.closeFeedbackDialog();
        return;
      }
      try {
        await chatbotService.submitFeedback(queryId, {
          rating: feedback.rating || (feedback.thumbFeedback === 'up' ? 4 : 2),
          comment: feedback.text || '',
          thumbFeedback: feedback.thumbFeedback || null,
          providedAt: new Date().toISOString()
        });
        console.log('Feedback submitted successfully for queryId:', queryId);
        notificationService.success(this.translate('chatbot.feedbackSubmitted'));
      } catch (error) {
        console.error('Error submitting feedback for queryId:', queryId, error);
        notificationService.error(this.translate('chatbot.feedbackError'));
      }
      this.closeFeedbackDialog();
    },

    scrollToBottom() {
      this.$nextTick(() => {
        const container = this.$refs.chatWindow;
        if (container) {
          container.scrollTop = container.scrollHeight;
        }
      });
    },

    async loadExistingConversation(conversationId) {
      try {
        console.log(`[DEBUG] Loading conversation ${conversationId} - Starting request...`);
        const conversation = await this.chatHistoryService.getConversation(conversationId);

        if (!conversation) {
          throw new Error('Conversation not found');
        }

        // DEBUG: Log the full response from backend
        console.log('[DEBUG] Conversation loaded successfully:', conversation);
        console.log('[DEBUG] conversation.files raw data:', conversation.files);

        this.conversationId = conversation._key;
        this.currentChatId = conversation._key;
        this.currentChatTitle = conversation.title || this.generateChatTitle();
        this.currentCategoryId = conversation.categoryId || null;

        // NEW: Populate related documents from history (files property from backend)
        if (conversation.files && Array.isArray(conversation.files)) {
          console.log(`[DEBUG] Found ${conversation.files.length} files. Mapping to relatedDocuments...`);

          this.relatedDocuments = conversation.files.map((file) => {
            // Debug individual file mapping
            const mapped = {
              id: file.id,
              title: file.documentName || file.fileName || `Source ${file.id}`,
              documentName: file.documentName,
              fileName: file.fileName,
              type: file.url?.split('.').pop().toUpperCase() || 'LINK',
              size: 0,
              url: file.url,
              score: file.score,
              categoryLabel: file.categoryLabel,
              serviceLabels: file.labels || []
            };
            return mapped;
          });

          console.log('[DEBUG] Final mapped relatedDocuments:', this.relatedDocuments);
        } else {
          console.warn("[DEBUG] No 'files' array found in conversation response or it is empty.");
          this.relatedDocuments = [];
        }

        this.chatMessages = [];
        const messages = conversation.messages || [];
        messages.forEach((msg) => {
          this.chatMessages.push({
            sender: msg.sender === 'user' ? 'user' : 'bot',
            content: msg.content,
            timestamp: msg.timestamp || new Date().toISOString(),
            queryId: msg.queryId || null,
            isSaved: true
          });
        });

        if (this.chatMessages.length === 0) {
          this.chatMessages.push({
            sender: 'bot',
            content: this.translate('chatbot.welcomeMessage'),
            timestamp: new Date().toISOString(),
            queryId: null,
            isSaved: true
          });
        }

        this.selectedContextItems = [];
        if (conversation.tags && Array.isArray(conversation.tags)) {
          console.log(`Conversation tags:`, conversation.tags);
          conversation.tags.forEach((tag) => {
            this.selectedContextItems.push({
              service: this.safeTranslate(tag || `category.${this.currentCategoryId || 'general'}`),
              serviceKey: tag || `category.${this.currentCategoryId || 'general'}`,
              category: this.currentCategoryId || 'general',
              selected: true
            });
          });
        } else if (this.currentCategoryId) {
          this.selectedContextItems.push({
            service: this.getCategoryLabelById(this.currentCategoryId),
            serviceKey: `category.${this.currentCategoryId}`,
            category: this.currentCategoryId,
            selected: true
          });
          console.log(`No tags, using fallback category ID: ${this.currentCategoryId}`);
        }

        this.lastSavedState = {
          messages: JSON.parse(JSON.stringify(this.chatMessages)),
          contextItems: JSON.parse(JSON.stringify(this.selectedContextItems))
        };

        this.newMessage = '';
        this.showQuickHelp = false;
        this.scrollToBottom();

        this.updateChatInHistory();

        notificationService.success(this.translate('chatbot.conversationLoaded'));
      } catch (error) {
        console.error('Error loading conversation:', error);
        notificationService.error(this.translate('chatbot.loadError'));
      }
    },

    hasUnsavedChanges() {
      if (!this.conversationId && !this.currentChatId) {
        const hasUserMessages = this.chatMessages.some((msg) => msg.sender === 'user');
        const hasContextItems = this.selectedContextItems.length > 0;
        return hasUserMessages || hasContextItems;
      }

      const hasNewMessages = this.chatMessages.some(
        (msg) => !msg.isSaved && (msg.sender === 'user' || (msg.sender === 'bot' && msg.queryId))
      );
      if (hasNewMessages) {
        return true;
      }

      if (this.selectedContextItems.length !== this.lastSavedState.contextItems.length) {
        return true;
      }
      for (let i = 0; i < this.selectedContextItems.length; i++) {
        if (
          this.selectedContextItems[i].service !== this.lastSavedState.contextItems[i]?.service ||
          this.selectedContextItems[i].category !== this.lastSavedState.contextItems[i]?.category
        ) {
          return true;
        }
      }

      return false;
    },

    async loadConversationConfirmed() {
      this.showLoadConfirm = false;
      if (this.pendingConversationId) {
        await this.loadExistingConversation(this.pendingConversationId);
        this.pendingConversationId = null;
      }
    },

    cancelLoadConversation() {
      this.showLoadConfirm = false;
      this.pendingConversationId = null;
    },

    async saveAndLoadConversation() {
      this.showLoadConfirm = false;
      if (this.conversationId || this.currentChatId) {
        await this.updateExistingChat();
      } else {
        this.saveChatDialog = {
          visible: true,
          title: this.generateChatTitle(),
          folderId: 'default'
        };
        await new Promise((resolve) => {
          const unwatch = this.$watch('saveChatDialog.visible', (newVal) => {
            if (!newVal) {
              unwatch();
              resolve();
            }
          });
        });
      }
      if (this.pendingConversationId) {
        await this.loadExistingConversation(this.pendingConversationId);
        this.pendingConversationId = null;
      }
    },

    saveChatToHistory() {
      if (this.conversationId || this.currentChatId) {
        this.updateExistingChat();
      } else {
        this.saveChatDialog = {
          visible: true,
          title: this.generateChatTitle(),
          folderId: 'default'
        };
      }
    },

    getContextTags() {
      return this.selectedContextItems.map((item) => item.serviceKey || item.service).filter((tag) => tag);
    },

    async handleSaveChat() {
      // Prevent double-save
      if (this.isSaving) {
        console.log('Save already in progress, ignoring duplicate click');
        return;
      }

      console.log('handleSaveChat called');
      this.isSaving = true;

      try {
        console.log('Saving chat with data:', {
          title: this.saveChatDialog.title,
          folderId: this.saveChatDialog.folderId,
          messages: this.chatMessages
        });

        const currentUser = this.$store.getters.currentUser;
        if (!currentUser || !getUserId(currentUser)) {
          throw new Error('User not authenticated');
        }

        const firstUserMessage = this.chatMessages.find((msg) => msg.sender === 'user')?.content || '';

        const conversationData = {
          title: this.saveChatDialog.title || this.generateChatTitle(),
          initialMessage: firstUserMessage,
          categoryId: this.currentCategoryId || null,
          tags: this.getContextTags()
        };

        if (this.conversationId) {
          throw new Error('handleSaveChat should not be called for existing conversations');
        }

        console.log('chatHistoryService.createConversation called with:', conversationData);
        const conversation = await this.chatHistoryService.createConversation(conversationData);
        console.log('Conversation created:', conversation);
        this.conversationId = conversation._key;

        for (const message of this.chatMessages) {
          if (
            (message.sender === 'bot' && !message.queryId) ||
            (message.sender === 'user' && message.content === firstUserMessage && !message.isSaved)
          ) {
            console.log(`Skipping message: ${message.content}`);
            message.isSaved = true;
            continue;
          }

          if (message.sender === 'user' || (message.sender === 'bot' && message.queryId)) {
            const messageData = {
              conversationId: conversation._key,
              content: message.content,
              sender: message.sender === 'user' ? 'user' : 'assistant',
              queryId: message.queryId || null,
              metadata: message.metadata || {}
            };
            console.log('Adding message with data:', messageData);
            console.log('chatHistoryService.addMessage called with:', messageData);
            await this.chatHistoryService.addMessage(messageData);
            message.isSaved = true;
          }
        }

        const chatData = {
          id: conversation._key,
          title: conversationData.title,
          preview: this.chatPreview,
          folderId: this.saveChatDialog.folderId || 'default',
          messageCount: this.chatMessages.filter(
            (msg) => msg.sender === 'user' || (msg.sender === 'bot' && msg.queryId)
          ).length
        };
        console.log('Dispatching createChat with:', chatData);
        await this.$store.dispatch('chatHistory/createChat', chatData);
        console.log('Vuex chats state after createChat:', this.$store.state.chatHistory.chats);

        if (this.saveChatDialog.folderId && this.saveChatDialog.folderId !== 'default') {
          console.log('chatHistoryService.addConversationToFolder called with:', {
            folderId: this.saveChatDialog.folderId,
            conversationId: conversation._key
          });
          await this.chatHistoryService.addConversationToFolder(this.saveChatDialog.folderId, conversation._key);
          console.log(`Conversation ${conversation._key} added to folder ${this.saveChatDialog.folderId}`);
          console.log('Dispatching addChatToFolder with:', {
            chatId: conversation._key,
            folderId: this.saveChatDialog.folderId
          });
          await this.$store.dispatch('chatHistory/addChatToFolder', {
            chatId: conversation._key,
            folderId: this.saveChatDialog.folderId
          });
          console.log(
            'Vuex folderChats state after addChatToFolder:',
            this.$store.state.chatHistory.folderChats[this.saveChatDialog.folderId]
          );
        }

        this.currentChatId = conversation._key;
        this.currentChatTitle = conversationData.title;
        this.lastSavedState.messages = [...this.chatMessages];
        this.lastSavedState.contextItems = [...this.selectedContextItems];
        this.updateChatInHistory();

        notificationService.success(this.translate('chatbot.chatSaved'));
        this.saveChatDialog.visible = false;

        console.log(`Emitting conversation-saved event for conversation ${conversation._key}`);
        eventBus.$emit('conversation-saved', conversation._key);
      } catch (error) {
        console.error('Error saving chat:', error);
        notificationService.error('Failed to save chat. Please try again.');
        throw error;
      } finally {
        this.isSaving = false;
      }
    },

    async updateExistingChat() {
      console.log('updateExistingChat called');
      try {
        const currentUser = this.$store.getters.currentUser;
        if (!currentUser || !getUserId(currentUser)) {
          throw new Error('User not authenticated');
        }

        if (!this.conversationId) {
          throw new Error('Conversation ID is required for updating an existing chat');
        }

        const updateData = {
          title: this.currentChatTitle || this.generateChatTitle(),
          categoryId: this.currentCategoryId || null,
          tags: this.getContextTags(),
          isStarred: false,
          isArchived: false
        };
        console.log('chatHistoryService.updateConversation called with:', {
          conversationId: this.conversationId,
          updateData
        });
        const conversation = await this.chatHistoryService.updateConversation(this.conversationId, updateData);
        console.log('Conversation updated:', conversation);

        for (const message of this.chatMessages) {
          if (message.isSaved) {
            console.log(`Skipping already saved message: ${message.content}`);
            continue;
          }
          if (message.sender === 'user' || (message.sender === 'bot' && message.queryId)) {
            const messageData = {
              conversationId: this.conversationId,
              content: message.content,
              sender: message.sender === 'user' ? 'user' : 'assistant',
              queryId: message.queryId || null,
              metadata: message.metadata || {}
            };
            console.log('Adding message with data:', messageData);
            console.log('chatHistoryService.addMessage called with:', messageData);
            await this.chatHistoryService.addMessage(messageData);
            message.isSaved = true;
          }
        }

        this.currentChatId = this.conversationId;
        this.lastSavedState.messages = [...this.chatMessages];
        this.lastSavedState.contextItems = [...this.selectedContextItems];
        this.updateChatInHistory();

        notificationService.success(this.translate('chatbot.chatUpdated'));
      } catch (error) {
        console.error('Error updating chat:', error);
        notificationService.error('Failed to update chat. Please try again.');
        throw error;
      }
    },

    updateChatInHistory() {
      if (this.currentChatId) {
        this.updateChat({
          chatId: this.currentChatId,
          preview: this.chatPreview,
          fullChatData: JSON.stringify(this.chatMessages)
        });
      }
    },

    loadChatFromHistory(chatId) {
      const chat = this.getChatById(chatId);
      if (!chat) return;
      try {
        const storedChatData = localStorage.getItem(`chat_data_${chatId}`);
        if (storedChatData) {
          const parsed = JSON.parse(storedChatData);
          this.chatMessages = parsed.map((msg) => {
            if (msg.sender !== 'bot') return msg;
            if (typeof msg.confidenceScore === 'number' && Number.isFinite(msg.confidenceScore)) {
              return msg;
            }
            const fromMeta = msg.metadata && msg.metadata.confidence_score;
            if (typeof fromMeta === 'number' && Number.isFinite(fromMeta)) {
              return { ...msg, confidenceScore: fromMeta };
            }
            return msg;
          });
        } else {
          this.chatMessages = [
            {
              sender: 'bot',
              content: this.translate('chatbot.welcomeMessage')
            }
          ];
        }
        this.currentChatId = chatId;
        this.showQuickHelp = false;
        this.scrollToBottom();
      } catch (error) {
        console.error('Error loading chat:', error);
        notificationService.error(this.translate('chatbot.loadError'));
      }
    },

    generateChatTitle() {
      const userMessage = this.chatMessages.find((msg) => msg.sender === 'user');
      if (userMessage) {
        return userMessage.content.length > 20 ? userMessage.content.substring(0, 17) + '...' : userMessage.content;
      }
      const now = new Date();
      return `Chat - ${now.toLocaleDateString()}`;
    },

    startNewChat() {
      if (this.hasUnsavedChanges()) {
        this.showNewChatConfirm = true;
        this.newChatDialog = {
          title: this.translate('chatbot.newChatTitle'),
          message: this.translate('chatbot.unsavedChanges'),
          confirmText: this.translate('chatbot.saveAndStartNew'),
          cancelText: this.translate('chatbot.discardAndStartNew'),
          secondaryText: this.translate('common.cancel')
        };
      } else {
        this.startNewChatConfirmed();
      }
    },

    async saveAndStartNewChat() {
      this.showNewChatConfirm = false;
      try {
        if (this.conversationId || this.currentChatId) {
          await this.updateExistingChat();
        } else {
          this.saveChatDialog = {
            visible: true,
            title: this.generateChatTitle(),
            folderId: 'default'
          };
          await new Promise((resolve) => {
            const unwatch = this.$watch('saveChatDialog.visible', (newVal) => {
              if (!newVal) {
                unwatch();
                resolve();
              }
            });
          });
        }
        this.startNewChatConfirmed();
      } catch (error) {
        console.error('Error saving before starting new chat:', error);
        notificationService.error('Failed to save changes. Please try again.');
      }
    },

    startNewChatConfirmed() {
      this.showNewChatConfirm = false;
      this.chatMessages = [
        {
          sender: 'bot',
          content: this.translate('chatbot.welcomeMessage'),
          timestamp: new Date().toISOString(),
          isSaved: true
        }
      ];
      this.currentChatId = null;
      this.conversationId = null;
      this.selectedContextItems = [];
      this.newMessage = '';
      this.currentCategoryId = null;
      this.currentChatTitle = '';
      this.showQuickHelp = true;
      this.relatedDocuments = [];
      this.lastSavedState = {
        messages: JSON.parse(JSON.stringify(this.chatMessages)),
        contextItems: []
      };
      this.scrollToBottom();
      notificationService.info(this.translate('chatbot.newChatStarted'), 1500);
    },

    cancelNewChat() {
      this.showNewChatConfirm = false;
    },

    openExportDialog() {
      this.exportDialog = {
        visible: true,
        filename: this.generateChatTitle()
      };
    },

    _processInlineTokens(tokens) {
      const parts = [];
      if (!tokens) {
        return parts;
      }

      tokens.forEach((token) => {
        switch (token.type) {
          case 'strong': {
            const boldParts = this._processInlineTokens(token.tokens);
            boldParts.forEach((p) => (p.style = 'bold'));
            parts.push(...boldParts);
            break;
          }
          case 'em': {
            const italicParts = this._processInlineTokens(token.tokens);
            italicParts.forEach((p) => (p.style = 'italic'));
            parts.push(...italicParts);
            break;
          }
          case 'codespan':
            parts.push({ text: token.text, style: 'code' });
            break;
          case 'link': {
            const linkParts = this._processInlineTokens(token.tokens);
            linkParts.forEach((p) => (p.style = 'link'));
            parts.push(...linkParts);
            break;
          }
          case 'text':
            parts.push({ text: token.text, style: 'normal' });
            break;
          default:
            if (token.text) {
              parts.push({ text: token.text, style: 'normal' });
            }
            break;
        }
      });
      return parts;
    },

    parseMarkdownForPDF(markdown) {
      try {
        const tokens = marked.lexer(markdown);
        const result = [];
        let listCounter = 0;
        let listOrdered = false;

        tokens.forEach((token) => {
          switch (token.type) {
            case 'space':
              result.push({ type: 'space' });
              break;
            case 'hr':
              result.push({ type: 'hr' });
              break;
            case 'heading': {
              const headingParts = this._processInlineTokens(token.tokens);
              headingParts.forEach((p) => (p.style = `h${token.depth}`));
              result.push({ type: 'line', indent: 0, content: headingParts });
              break;
            }
            case 'paragraph':
              result.push({
                type: 'line',
                indent: 0,
                content: this._processInlineTokens(token.tokens)
              });
              break;
            case 'list':
              listOrdered = token.ordered;
              listCounter = token.start ? token.start - 1 : 0;
              token.items.forEach((item) => {
                listCounter++;
                const prefix = listOrdered ? `${listCounter}. ` : '- ';
                const itemContent = this._processInlineTokens(item.tokens[0].tokens);
                itemContent.unshift({ text: prefix, style: 'normal' });
                result.push({ type: 'line', indent: 15, content: itemContent });
              });
              break;
            case 'code': {
              const codeLines = token.text.split('\n');
              codeLines.forEach((line) => {
                result.push({
                  type: 'line',
                  indent: 10,
                  content: [{ text: line, style: 'code' }]
                });
              });
              break;
            }
            case 'blockquote': {
              const quoteContent = token.tokens.map((tok) => this._processInlineTokens(tok.tokens));
              quoteContent.forEach((lineContent) => {
                result.push({
                  type: 'line',
                  indent: 20,
                  isQuote: true,
                  content: lineContent
                });
              });
              break;
            }
          }
        });

        return result;
      } catch (error) {
        console.error('Error parsing markdown for PDF:', error);
        return [
          {
            type: 'line',
            indent: 0,
            content: [{ text: markdown, style: 'normal' }]
          }
        ];
      }
    },

    exportChatToPDF() {
      try {
        const doc = new jsPDF();
        let yOffset = 20;
        const pageHeight = doc.internal.pageSize.height;
        const topMargin = 20;
        const bottomMargin = 20;
        const leftMargin = 15;
        const rightMargin = doc.internal.pageSize.width - 15;

        const checkPageBreak = (neededHeight = 10) => {
          if (yOffset + neededHeight > pageHeight - bottomMargin) {
            doc.addPage();
            yOffset = topMargin;
          }
        };

        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text(this.currentChatTitle || this.generateChatTitle(), leftMargin, yOffset);
        yOffset += 15;

        this.chatMessages.forEach((msg) => {
          checkPageBreak(20);
          yOffset += 5;

          doc.setFontSize(10);
          doc.setFont('helvetica', 'bold');
          const sender = msg.sender === 'user' ? 'User' : 'Bot';
          const timestamp = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : new Date().toLocaleString();
          doc.text(`${sender} (${timestamp}):`, leftMargin, yOffset);
          yOffset += 6;

          const parsedContent =
            msg.sender === 'bot' && msg.content
              ? this.parseMarkdownForPDF(msg.content)
              : [
                  {
                    type: 'line',
                    content: [{ text: msg.content || '', style: 'normal' }],
                    indent: 0
                  }
                ];

          parsedContent.forEach((block) => {
            checkPageBreak();

            if (block.type === 'space') {
              yOffset += 5;
              return;
            }
            if (block.type === 'hr') {
              doc.setDrawColor(150);
              doc.line(leftMargin, yOffset + 2, rightMargin, yOffset + 2);
              yOffset += 6;
              return;
            }
            if (!block.content || block.content.length === 0) {
              yOffset += 3;
              return;
            }

            let xOffset = leftMargin + (block.indent || 0);

            if (block.isQuote) {
              doc.setFillColor(230, 230, 230);
              doc.rect(leftMargin, yOffset - 4, 3, 6, 'F');
            }

            const linePartsQueue = [...block.content];

            while (linePartsQueue.length > 0) {
              const part = linePartsQueue.shift();
              const availableWidth = rightMargin - xOffset;

              doc.setFontSize(12);
              let fontStyle = 'normal';
              if (part.style === 'bold') fontStyle = 'bold';
              if (part.style === 'italic') fontStyle = 'italic';
              doc.setFont('helvetica', fontStyle);

              if (part.style && part.style.startsWith('h')) {
                const level = parseInt(part.style.replace('h', '')) || 1;
                doc.setFontSize(12 + (6 - level) * 2);
                doc.setFont('helvetica', 'bold');
              } else if (part.style === 'code') {
                doc.setFont('courier', 'normal');
                doc.setFontSize(10);
              }

              const splitText = doc.splitTextToSize(part.text, availableWidth);

              doc.text(splitText[0], xOffset, yOffset);
              xOffset += (doc.getStringUnitWidth(splitText[0]) * doc.getFontSize()) / doc.internal.scaleFactor;

              if (splitText.length > 1) {
                const remainingText = splitText.slice(1).join(' ');
                linePartsQueue.unshift({
                  text: remainingText,
                  style: part.style
                });

                yOffset += 6;
                checkPageBreak();
                xOffset = leftMargin + (block.indent || 0);
                if (block.isQuote) {
                  doc.setFillColor(230, 230, 230);
                  doc.rect(leftMargin, yOffset - 4, 3, 6, 'F');
                }
              }
            }
            yOffset += 6;
          });
        });

        let filename = this.exportDialog.filename.trim();
        if (!filename.toLowerCase().endsWith('.pdf')) {
          filename += '.pdf';
        }
        filename = filename.replace(/[^a-zA-Z0-9\-_.]/g, '_');

        doc.save(filename);
        notificationService.success(this.translate('chatbot.exportSuccess'));
        this.exportDialog.visible = false;
      } catch (error) {
        console.error('Error exporting chat to PDF:', error);
        notificationService.error(this.translate('chatbot.exportError'));
      }
    },

    updateDialogTexts() {
      this.newChatDialog = {
        title: this.translate('chatbot.newChatTitle'),
        message: this.translate('chatbot.unsavedChanges'),
        confirmText: this.translate('chatbot.saveAndStartNew'),
        cancelText: this.translate('chatbot.discardAndStartNew'),
        secondaryText: this.translate('common.cancel')
      };
      this.loadConfirmDialog = {
        title: this.translate('chatbot.loadConfirmTitle'),
        message: this.translate('chatbot.loadConfirmMessage'),
        confirmText: this.translate('chatbot.loadAndDiscard'),
        cancelText: this.translate('common.cancel'),
        secondaryText: this.translate('chatbot.saveAndLoad')
      };
    }
  }
};
</script>

<style scoped>
.app-container {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

.chatbot-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  position: relative;
  flex: 1;
  overflow: hidden;
}

/* System Status Panel */
.system-status-panel {
  background: var(--bg-tertiary, #f8fafc);
  border-bottom: 1px solid var(--border-light, #e2e8f0);
  padding: 6px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.8rem;
  gap: 12px;
}

.status-left {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  flex: 1;
  overflow: hidden;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
  color: var(--text-tertiary, #64748b);
}

.status-indicator.online {
  color: var(--status-operational, #10b981);
}

.status-indicator:not(.online) {
  color: var(--status-error, #ef4444); /* Red color for offline */
}

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background-color: var(--text-muted, #cbd5e1);
}

.status-indicator.online .status-dot {
  background-color: var(--status-operational, #10b981);
}

.status-indicator:not(.online) .status-dot {
  background-color: var(--status-error, #ef4444); /* Red color for offline */
}

.status-error-message {
  font-size: 0.75rem;
  color: var(--status-error, #ef4444);
  font-weight: 500;
  margin-left: 18px; /* Align with status text */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.status-metric {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  white-space: nowrap;
}

.metric-label {
  font-size: 0.75rem;
  color: var(--text-tertiary, #64748b);
  text-transform: none;
  letter-spacing: 0;
}

.metric-value {
  font-weight: 600;
  color: var(--text-primary, #334155);
  font-variant-numeric: tabular-nums;
}

/* Context Panel Styles */
.context-panel {
  background: var(--bg-tertiary, #f5f9ff);
  border-bottom: 1px solid var(--border-light, #e0e0e0);
  padding: 8px 10px;
  font-size: 0.9rem;
}

.context-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 6px;
}

.context-title {
  font-weight: 600;
  color: var(--text-primary, #4a4a4a);
}

.context-items {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.context-item {
  display: flex;
  align-items: center;
  background: var(--bg-card, #fff);
  border: 1px solid var(--border-color, #ddd);
  border-radius: 16px;
  padding: 4px 8px 4px 10px;
  font-size: 0.85rem;
  max-width: 200px;
  overflow: hidden;
}

.context-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  margin-right: 4px;
  color: var(--text-primary, #333);
}

.context-remove-btn {
  background: none;
  border: none;
  color: var(--text-tertiary, #888);
  font-size: 0.8rem;
  cursor: pointer;
  padding: 0;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
}

.context-remove-btn:hover {
  color: var(--text-secondary, #555);
  background: var(--bg-tertiary, #f0f0f0);
}

/* Chat Window Styles */
.chat-window {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
  background: var(--bg-primary, #fafafa);
  position: relative;
}

.chat-message {
  margin-bottom: 12px;
  display: flex;
  align-items: flex-start;
}

.chat-message.user {
  justify-content: flex-end;
}

.chat-message.bot {
  justify-content: flex-start;
}

.message-bubble {
  background: var(--bg-card, #ffffff);
  color: var(--text-primary, #1f2937);
  padding: 10px 14px;
  border-radius: 14px;
  max-width: 60%;
  line-height: 1.5;
  white-space: pre-wrap;
  word-wrap: break-word;
  border: 1px solid var(--border-light, #e5e7eb);
  box-shadow: none;
}

.chat-message.bot .message-bubble {
  border-top-left-radius: 4px;
}

.chat-message.user .message-bubble {
  background: var(--accent-color, #4e97d1);
  color: var(--text-button-primary, #fff);
  border-color: transparent;
  border-top-right-radius: 4px;
}

/* Markdown Styles within Message Bubble */
.message-bubble :deep(h1),
.message-bubble :deep(h2),
.message-bubble :deep(h3),
.message-bubble :deep(h4),
.message-bubble :deep(h5),
.message-bubble :deep(h6) {
  font-weight: 600;
  margin: 0.5em 0;
  color: var(--text-primary, #000);
}

.message-bubble :deep(h1) {
  font-size: 1.5em;
}
.message-bubble :deep(h2) {
  font-size: 1.3em;
}
.message-bubble :deep(h3) {
  font-size: 1.2em;
}
.message-bubble :deep(h4) {
  font-size: 1.1em;
}
.message-bubble :deep(h5) {
  font-size: 1em;
}
.message-bubble :deep(h6) {
  font-size: 0.9em;
}

.message-bubble :deep(p) {
  margin: 0.5em 0;
  color: var(--text-primary, #000);
}

.message-bubble :deep(ul),
.message-bubble :deep(ol) {
  margin: 0.5em 0;
  padding-left: 1.5em;
}

.message-bubble :deep(ul ul),
.message-bubble :deep(ol ol),
.message-bubble :deep(ul ol),
.message-bubble :deep(ol ul) {
  margin: 0.25em 0 0.35em;
  padding-left: 1.25em;
}

.message-bubble :deep(li) {
  margin-bottom: 0.3em;
  color: var(--text-primary, #000);
}

.message-bubble :deep(a) {
  color: var(--accent-color, #4e97d1);
  text-decoration: underline;
}

.message-bubble :deep(a:hover) {
  color: var(--accent-hover, #3a7da0);
}

.message-bubble :deep(code) {
  background: var(--bg-tertiary, #f5f5f5);
  padding: 0.2em 0.4em;
  border-radius: 3px;
  font-family: monospace;
  color: var(--text-primary, #000);
}

.message-bubble :deep(pre) {
  background: var(--bg-tertiary, #f5f5f5);
  padding: 0.8em;
  border-radius: 4px;
  overflow-x: auto;
  font-family: monospace;
  color: var(--text-primary, #000);
}

.message-bubble :deep(blockquote) {
  border-left: 3px solid var(--border-color, #ddd);
  padding-left: 0.8em;
  margin: 0.5em 0;
  color: var(--text-secondary, #666);
}

.message-bubble :deep(table) {
  border-collapse: collapse;
  margin: 0.5em 0;
  width: 100%;
}

.message-bubble :deep(th),
.message-bubble :deep(td) {
  border: 1px solid var(--border-color, #ddd);
  padding: 0.4em 0.8em;
  color: var(--text-primary, #000);
}

.message-bubble :deep(th) {
  background: var(--bg-tertiary, #f5f5f5);
  font-weight: 600;
}

.message-bubble :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
}

/* Dark Theme Adjustments for Markdown */
[data-theme='dark'] .message-bubble :deep(h1),
[data-theme='dark'] .message-bubble :deep(h2),
[data-theme='dark'] .message-bubble :deep(h3),
[data-theme='dark'] .message-bubble :deep(h4),
[data-theme='dark'] .message-bubble :deep(h5),
[data-theme='dark'] .message-bubble :deep(h6),
[data-theme='dark'] .message-bubble :deep(p),
[data-theme='dark'] .message-bubble :deep(li),
[data-theme='dark'] .message-bubble :deep(th),
[data-theme='dark'] .message-bubble :deep(td),
[data-theme='dark'] .message-bubble :deep(code),
[data-theme='dark'] .message-bubble :deep(pre) {
  color: var(--text-primary, #ffffff);
}

[data-theme='dark'] .message-bubble :deep(code),
[data-theme='dark'] .message-bubble :deep(pre),
[data-theme='dark'] .message-bubble :deep(th) {
  background: var(--bg-tertiary, #2d2d2d);
}

[data-theme='dark'] .message-bubble :deep(blockquote) {
  color: var(--text-secondary, #cccccc);
  border-left-color: var(--border-color, #555);
}

[data-theme='dark'] .message-bubble :deep(a) {
  color: var(--accent-color, #4e97d1);
}

[data-theme='dark'] .message-bubble :deep(a:hover) {
  color: var(--accent-hover, #3a7da0);
}

/* Loading Spinner Styles */
.loading-spinner {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.8); /* Semi-transparent background for visibility */
  padding: 10px 20px;
  border-radius: 8px;
  z-index: 100; /* Ensure it overlays other content */
}

.loading-spinner i {
  font-size: 1.2rem;
  color: var(--accent-color, #4e97d1); /* Match button colors */
}

.loading-spinner .loading-text {
  font-size: 0.95rem;
  color: var(--text-primary, #333);
  font-weight: 500;
}

/* Dark Theme Adjustments for Spinner */
[data-theme='dark'] .loading-spinner,
html[data-theme='dark'] .loading-spinner {
  background: rgba(30, 30, 30, 0.8); /* Darker background for dark mode */
}

[data-theme='dark'] .loading-spinner i,
html[data-theme='dark'] .loading-spinner i {
  color: var(--accent-color, #4e97d1);
}

[data-theme='dark'] .loading-spinner .loading-text,
html[data-theme='dark'] .loading-spinner .loading-text {
  color: var(--text-primary, #ffffff);
}

.bot-message-meta {
  margin-left: 8px;
  align-self: center;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
}

.confidence-score {
  font-size: 0.75rem;
  color: var(--text-tertiary, #64748b);
  background: var(--bg-tertiary, #f8fafc);
  padding: 3px 6px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.feedback-trigger {
  margin-left: 0;
}

.feedback-trigger button {
  background: var(--bg-button-secondary, #f0f0f0);
  border: none;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.8rem;
  color: var(--text-button-secondary, #555);
}

.feedback-trigger button:hover {
  background: var(--bg-tertiary, #e0e0e0);
}

/* Quick Help Overlay */
.quick-help-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--bg-secondary, rgba(250, 250, 250, 0.97));
  z-index: 10;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
  overflow-y: auto;
}

.quick-help-content {
  max-width: 600px;
  width: 100%;
}

.quick-help-heading {
  text-align: center;
  font-size: 1.6rem;
  font-weight: 600;
  margin-bottom: 24px;
  color: var(--text-primary, #333);
}

.quick-help-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 12px;
}

.quick-help-item {
  display: flex;
  align-items: center;
  padding: 10px 14px;
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: 10px;
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    background 0.18s ease;
  box-shadow: none;
}

.quick-help-item:hover {
  background: var(--bg-card);
  border-color: var(--accent-color);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-color) 18%, transparent);
}

.quick-help-item.just-chat {
  background: var(--bg-card);
  border-color: var(--accent-color);
}

.quick-help-item.just-chat:hover {
  border-color: var(--accent-hover);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-hover) 22%, transparent);
}

.quick-help-icon {
  margin-right: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  flex-shrink: 0;
}

.quick-help-icon img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.quick-help-text {
  font-size: 0.95rem;
  color: var(--text-primary);
  font-weight: 500;
}

/* Chat Input Styles */
.chat-input {
  display: flex;
  flex-direction: column;
  background: var(--bg-card, #fff);
  border-top: 1px solid var(--border-color, #ddd);
  padding: 8px;
}

.prompt-textarea {
  resize: vertical;
  border: 1px solid var(--border-input, #ddd);
  border-radius: 4px;
  padding: 10px;
  font-size: 1rem;
  margin-bottom: 8px;
  max-height: 120px;
  background-color: var(--bg-input, #fff);
  color: var(--text-primary, #333);
}

.input-actions {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
}

.new-chat-btn,
.save-chat-btn,
.export-chat-btn {
  background: var(--bg-card, #ffffff);
  color: var(--text-secondary, #6b7280);
  border: 1px solid var(--border-light, #e5e7eb);
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease,
    border-color 0.15s ease;
}

.new-chat-btn {
  margin-right: auto;
}

.new-chat-btn:hover,
.save-chat-btn:hover,
.export-chat-btn:hover {
  background: var(--bg-tertiary, #f3f4f6);
  color: var(--accent-color, #4e97d1);
  border-color: var(--accent-color, #4e97d1);
}

.send-btn {
  background: var(--accent-color, #4e97d1);
  color: var(--text-button-primary, #fff);
  border: 1px solid transparent;
  padding: 0 16px;
  height: 36px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 500;
  transition: background 0.15s ease;
}

.send-btn:hover {
  background: var(--accent-hover, #3a7da0);
}

/* Form Styles for Save Dialog */
.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
  color: var(--text-primary, #333);
}

.form-group input,
.form-group select {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border-input, #ddd);
  border-radius: 4px;
  font-size: 1rem;
  background-color: var(--bg-input, #fff);
  color: var(--text-primary, #333);
}

.cancel-btn,
.primary-btn {
  padding: 8px 16px;
  border-radius: 4px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color, 0.2s;
}

.cancel-btn {
  background: var(--bg-button-secondary, #f5f5f5);
  border: 1px solid var(--border-color, #ddd);
  color: var(--text-button-secondary, #666);
}

.cancel-btn:hover {
  background-color: var(--bg-tertiary, #f5f5f5);
}

.primary-btn {
  background-color: var(--accent-color, #4e97d1);
  border: none;
  color: var(--text-button-primary, white);
}

.primary-btn:hover {
  background-color: var(--accent-hover, #3a7cb5);
}

.primary-btn:disabled {
  background-color: var(--bg-button-secondary, #a9cae8);
  cursor: not-allowed;
}

/* Responsive Adjustments */
@media (min-width: 768px) {
  .chat-input {
    flex-direction: row;
    align-items: flex-end;
  }

  .prompt-textarea {
    margin-bottom: 0;
    margin-right: 8px;
    flex: 1;
  }

  .quick-help-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (min-width: 1024px) {
  .quick-help-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}

@media (max-width: 768px) {
  .system-status-panel {
    flex-direction: row;
    align-items: center;
    gap: 8px;
  }

  .status-metric {
    margin-left: auto;
  }
}

@media (max-width: 480px) {
  .quick-help-grid {
    grid-template-columns: 1fr;
  }

  .quick-help-heading {
    font-size: 1.4rem;
  }
}

/* Additional fixes for dark theme visibility */
[data-theme='dark'] .metric-label,
[data-theme='dark'] .status-metric,
html[data-theme='dark'] .metric-label,
html[data-theme='dark'] .metric-value {
  color: rgba(255, 255, 255, 0.8) !important;
}

[data-theme='dark'] .quick-help-heading,
html[data-theme='dark'] .quick-help-heading {
  color: white !important;
}

[data-theme='dark'] .quick-help-overlay,
html[data-theme='dark'] .quick-help-overlay {
  background: var(--bg-primary, #1e1e1e) !important;
}

[data-theme='dark'] .confidence-score {
  color: var(--text-tertiary, #a0aec0);
  background: var(--bg-tertiary, #2d3748);
}

[data-theme='dark'] .feedback-trigger button {
  background: var(--bg-button-secondary, #2d3748);
  color: var(--text-button-secondary, #e2e8f0);
}

/* Saving Indicator Styles */
.saving-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 16px;
  padding: 12px;
  background-color: var(--bg-tertiary, #f5f7fa);
  border-radius: 4px;
  color: var(--text-secondary, #606266);
  font-size: 0.95rem;
}

.saving-indicator i {
  font-size: 16px;
  color: var(--accent-color, #409eff);
}

.save-chat-btn:disabled,
.save-chat-btn[disabled] {
  opacity: 0.6;
  cursor: not-allowed;
}

[data-theme='dark'] .saving-indicator {
  background-color: var(--bg-tertiary, #2d3748);
  color: var(--text-secondary, #e2e8f0);
}

[data-theme='dark'] .saving-indicator i {
  color: var(--accent-color, #4e97d1);
}
</style>
