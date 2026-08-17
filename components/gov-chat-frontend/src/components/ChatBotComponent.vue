<template>
  <div class="app-container">
    <!-- Main chatbot container -->
    <div class="chatbot-container" data-test-id="chatbot-container">
      <!-- New Chat Confirmation Dialog -->
      <ConfirmDialog
        :visible="showNewChatConfirm"
        :title="newChatDialog.title"
        :message="newChatDialog.message"
        :confirm-text="newChatDialog.confirmText"
        :cancel-text="newChatDialog.cancelText"
        :secondary-text="newChatDialog.secondaryText"
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
            <DsInput
              id="exportFilename"
              v-model="exportDialog.filename"
              type="text"
              :placeholder="translate('chatbot.exportFilenamePlaceholder')"
            />
          </div>
        </template>
        <template #footer>
          <DsButton variant="secondary" @click="exportDialog.visible = false">
            {{ translate('common.cancel') }}
          </DsButton>
          <DsButton variant="primary" :disabled="!exportDialog.filename.trim()" @click="exportChatToPDF">
            {{ translate('chatbot.exportButton') }}
          </DsButton>
        </template>
      </modal-dialog>

      <!-- System Status Panel -->
      <div class="system-status-panel">
        <div class="status-left">
          <DsPill :variant="systemStatus.online ? 'success' : 'danger'">{{
            systemStatus.online ? translate('analytics.status.online') : translate('analytics.status.offline')
          }}</DsPill>
          <div v-if="!systemStatus.online && systemStatus.errorMessage" class="status-error-message">
            {{ systemStatus.errorMessage }}
          </div>
        </div>
        <div class="status-metrics">
          <div class="metric">
            <span class="metric-label">{{ translate('analytics.status.responseTime') }}</span>
            <span class="metric-value">
              {{ systemStatus.lastResponseTime !== null ? systemStatus.lastResponseTime + 'ms' : 'N/A' }}
            </span>
          </div>
        </div>
      </div>
      <!-- Context Panel for selected tree nodes -->
      <div v-if="selectedContextItems.length > 0" class="context-panel">
        <div class="context-header">
          <span class="context-title">{{ translate('chatbot.queryContext') }}</span>
        </div>
        <div class="context-items">
          <DsPill v-for="(item, index) in selectedContextItems" :key="index">
            <span>{{ item.service }}</span>
            <DsButton
              variant="ghost"
              :small="true"
              :aria-label="translate('chatbot.removeItem')"
              @click="removeContextItem(index)"
            >
              ✕
            </DsButton>
          </DsPill>
        </div>
      </div>
      <!-- The scrollable chat window -->
      <div ref="chatWindow" class="chat-window" aria-live="polite">
        <div
          v-for="(msg, index) in chatMessages"
          :key="`${msg.sender}-${msg.timestamp || ''}-${index}`"
          class="chat-message"
          :class="msg.sender"
        >
          <div class="message-wrapper">
            <div class="message-bubble">
              <!-- Render bot messages as sanitized HTML for Markdown, user messages as plain text -->
              <span v-if="msg.sender === 'user'">{{ msg.content }}</span>
              <template v-else>
                <div v-if="msg.isStreaming && !msg.content" class="streaming-indicator">
                  <DsSpinner size="sm" />
                  <span>{{ translate('chatbot.thinking', 'Thinking...') }}</span>
                </div>
                <!-- eslint-disable-next-line vue/no-v-html -->
                <div v-else v-html="renderMarkdown(msg.content)"></div>
              </template>
            </div>
            <span class="message-time">{{ formatMessageTime(msg.timestamp) }}</span>
          </div>
          <!-- Feedback and confidence score for bot messages -->
          <div v-if="msg.sender === 'bot'" class="bot-message-meta">
            <div v-if="msg.confidenceScore != null && msg.isGrounded !== false" class="confidence-score">
              <Brain :size="16" />
              <span>Confidence: {{ (msg.confidenceScore * 100).toFixed(0) }}%</span>
            </div>
            <!-- Not grounded: the answer came from the LLM's own knowledge, not library documents -->
            <div v-else-if="msg.isGrounded === false" class="grounding-flag">
              <Sparkles :size="16" />
              <span>{{ translate('chatbot.aiGeneratedNoDocs', 'AI-generated — not based on library documents') }}</span>
            </div>
            <div class="feedback-trigger">
              <DsPill>
                <DsButton variant="ghost" :small="true" @click="openFeedbackDialog(index)">
                  {{ translate('feedback.button') }}
                </DsButton>
              </DsPill>
            </div>
          </div>
        </div>
        <!-- Auto-scroll anchor element -->
        <div ref="messagesEnd"></div>
      </div>
      <!-- Quick Help Overlay -->
      <div v-if="showQuickHelp && selectedContextItems.length === 0" class="quick-help-overlay">
        <div class="quick-help-content">
          <h2 class="quick-help-heading">
            {{ translate('chatbot.whatCanIHelp') }}
          </h2>

          <div class="quick-help-grid">
            <DsCard
              v-for="button in quickHelpButtons"
              :key="button.id"
              variant="flat"
              padding="md"
              :hoverable="true"
              class="quick-help-item"
              :class="{ 'just-chat': !button.category }"
              @click="selectQuickHelpOption(button)"
            >
              <img class="quick-help-icon" :src="button.icon" alt="Quick Help Icon" />
              <div class="quick-help-text">{{ button.service }}</div>
            </DsCard>
          </div>
        </div>
      </div>
      <!-- Input Area -->
      <div class="chat-input">
        <DsInput
          v-model="newMessage"
          type="textarea"
          class="prompt-textarea"
          :rows="4"
          :placeholder="translate('chatbot.placeholder')"
          @enter="sendMessage"
          @focus="handleTextareaFocus"
        />
        <div class="input-actions">
          <DsButton variant="ghost" :title="translate('chatbot.newChat')" @click="startNewChat">
            <Plus :size="16" />
          </DsButton>
          <DsButton
            v-if="chatMessages.length > 0"
            variant="ghost"
            :title="translate('chatbot.saveChat')"
            data-testid="save-chat-btn"
            :disabled="isSaving"
            @click="saveChatToHistory"
          >
            <Save v-if="!isSaving" :size="16" />
            <Loader2 v-else :size="16" class="animate-spin" />
          </DsButton>
          <DsButton
            v-if="chatMessages.length > 0"
            variant="ghost"
            :title="translate('chatbot.exportChat')"
            @click="openExportDialog"
          >
            <FileText :size="16" />
          </DsButton>
          <DsButton variant="primary" @click="sendMessage">
            {{ translate('chatbot.sendButton') }}
          </DsButton>
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
            <DsInput
              id="chatTitle"
              v-model="saveChatDialog.title"
              type="text"
              :placeholder="translate('chatbot.chatTitlePlaceholder')"
              :disabled="isSaving"
            />
          </div>
          <div class="form-group">
            <label for="chatFolder">{{ translate('chatbot.selectFolder') }}</label>
            <DsSelect id="chatFolder" v-model="saveChatDialog.folderId" :disabled="isSaving">
              <option v-for="folder in folders" :key="folder.id" :value="folder.id">
                {{ folder.name }}
              </option>
            </DsSelect>
          </div>
          <!-- Loading Indicator -->
          <div v-if="isSaving" class="saving-indicator">
            <Loader2 :size="16" class="animate-spin" />
            <span>{{ translate('chatbot.savingConversation') }}</span>
          </div>
        </template>
        <template #footer>
          <DsButton variant="secondary" :disabled="isSaving" @click="saveChatDialog.visible = false">
            {{ translate('common.cancel') }}
          </DsButton>
          <DsButton variant="primary" :disabled="isSaving || !saveChatDialog.title.trim()" @click="handleSaveChat">
            <span v-if="isSaving">
              <Loader2 :size="16" class="animate-spin" />
              {{ translate('chatbot.saving') }}
            </span>
            <span v-else>{{ translate('common.save') }}</span>
          </DsButton>
        </template>
      </modal-dialog>
    </div>
    <!-- Right Sidebar - Now using the dedicated component -->
    <right-side-bar-component
      :current-chat-id="currentChatId"
      :current-locale="currentLocale"
      :related-documents="relatedDocuments"
      @load-chat="loadChatFromHistory"
      @open-document="handleOpenDocument"
      @sidebar-toggle="handleSidebarToggle"
    />
  </div>
</template>

<script>
import { Brain, Loader2, Plus, Save, FileText, Sparkles } from '@lucide/vue';
import { eventBus } from '../eventBus.js';
import notificationService from '../services/notificationService';
import { mapGetters, mapActions } from 'vuex';
import { getUserId } from '../utils/userUtils';
import ChatResponseFeedbackDialog from './ChatResponseFeedbackDialog.vue';
import ModalDialog from './ModalDialog.vue';
import RightSideBarComponent from './RightSideBarComponent.vue';
import chatbotService from '../services/chatbotService';
import serviceTreeService from '../services/serviceTreeService'; // *** NEW: Import serviceTreeService
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import chatHistoryService from '../services/chatHistoryService';
import DsSpinner from './ds/Spinner.vue';
import DsPill from './ds/Pill.vue';
import DsButton from './ds/Button.vue';
import DsCard from './ds/Card.vue';
import DsInput from './ds/Input.vue';
import DsSelect from './ds/Select.vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import jsPDF from 'jspdf';
import { resolveConfigText } from '../utils/configResolver';

export default {
  name: 'ChatBotComponent',
  components: {
    Brain,
    Loader2,
    Plus,
    Save,
    FileText,
    Sparkles,
    ChatResponseFeedbackDialog,
    ModalDialog,
    RightSideBarComponent,
    ConfirmDialog,
    DsPill,
    DsSpinner,
    DsButton,
    DsCard,
    DsInput,
    DsSelect
  },

  data() {
    return {
      conversationId: null,
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
      cachedConfig: null,
      currentLocale: (navigator.language || 'en').split('-')[0],
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
      isStreaming: false, // SSE streaming state
      streamingQueryId: null, // Query ID of the current streaming response
      streamController: null, // AbortController for cancelling active streams
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
    }
  },

  watch: {
    currentLocale: function () {
      this.updateDialogTexts();
    },
    '$i18n.locale'(newLocale) {
      this.currentLocale = newLocale;
      this.loadQuickHelpButtons();
    }
  },

  created() {
    eventBus.$on('chat-deleted', (deletedChatId) => {
      if (this.conversationId === deletedChatId) {
        this.conversationId = null;
        this.currentChatId = null;
        this.chatMessages = [
          {
            sender: 'bot',
            content: this.getWelcomeMessage(),
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
        content: this.getWelcomeMessage()
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
          this.loadServiceCategories(); // Reload categories for the new locale
        }
      );
    }

    eventBus.$on('treeNodeSelected', this.handleTreeNodeSelected);
    eventBus.$on('open-chat', this.loadChatFromHistory);
    this.scrollToBottom();
    this.loadQuickHelpButtons();
    this.loadServiceCategories(); // Fetch categories on mount

    // Removed the statusUpdateInterval
    this.updateDialogTexts();
  },

  beforeUnmount() {
    eventBus.$off('treeNodeSelected', this.handleTreeNodeSelected);
    eventBus.$off('open-chat', this.loadChatFromHistory);
    eventBus.$off('chat-deleted'); // Clean up the chat-deleted listener
    // Removed clearInterval
    eventBus.$off('load-conversation');
    // Abort active SSE stream on component unmount
    if (this.streamController) {
      this.streamController.abort();
    }
  },

  methods: {
    ...mapActions('chatHistory', ['createChat', 'updateChat']),

    formatMessageTime(timestamp) {
      if (!timestamp) return '';
      const date = new Date(timestamp);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    },

    // *** UPDATED: Use serviceTreeService to load and transform categories ***
    async loadServiceCategories() {
      try {
        // Use the service which handles transformation and localization
        this.serviceCategories = await serviceTreeService.getAllCategories(this.currentLocale);
      } catch (error) {
        console.error('[ChatBotComponent] Failed to load service categories:', error);
        notificationService.error('Could not load service categories.');
      }
    },

    // *** UPDATED: Find category label by its key in the transformed tree data ***
    getCategoryLabelById(id) {
      if (id === null || id === undefined) {
        // Just-Chat and other no-category selections: no category filter.
        // Returning null (not 'General') keeps it consistent with the backend,
        // which now preserves null instead of defaulting to 'General'. 'General'
        // is not a real KB label and would match no chunk under the retriever filter.
        return null;
      }

      // The service returns `catKey` which corresponds to the numeric ID
      const category = this.serviceCategories.find((cat) => cat.catKey == id.toString());
      if (category) {
        // The service already provides the localized name in the `name` property
        return category.name || null;
      }

      return null; // Unknown category — null means "no category filter" (do NOT send a `Category NN` string to the retriever)
    },

    checkContextConfig(context) {
      // Returns false when the query MUST be blocked (applies to ALL users).
      // Emits an informational warning to admins only.
      const user = this.$store.getters.currentUser;
      const isAdmin = !!(user && (user.roles || []).map((r) => r.toLowerCase()).includes('admin'));

      const warnings = [];

      // Block conditions (all users):
      // 1. categoryLabel is a raw unresolved `Category NN` string — would filter to zero
      //    (a prior bug sent the fallback id string as a label; this guards against regressions)
      // 2. user has context items selected but they resolved to NO labels — a misconfig
      //    symptom (button clicked, but its serviceLabels/category are empty). A genuinely
      //    empty context (Just Chat, no items selected) is NOT blocked — it's an unfiltered query.
      let blocked = false;
      if (context.categoryLabel && /^Category \d+$/.test(context.categoryLabel)) {
        blocked = true;
        warnings.push(this.translate('chatbot.categoryNotFound', '').replace('{label}', context.categoryLabel));
      }
      const hasServiceFilter = Array.isArray(context.serviceLabels) && context.serviceLabels.length > 0;
      const isJustChat = this.selectedContextItems.some((item) => item.id === 'just-chat');
      if (this.selectedContextItems.length > 0 && !hasServiceFilter && !context.categoryLabel && !isJustChat) {
        blocked = true;
        warnings.push(this.translate('chatbot.noFilterWarning', 'No context filter active.'));
      }

      // Mismatch check: each service label must be a known KB label (in some item's
      // serviceLabels array OR equal to an item's serviceKey). Catches misconfigured
      // buttons whose title leaks into the filter. Uses array membership, not service===.
      if (hasServiceFilter) {
        for (const label of context.serviceLabels) {
          const matched = this.selectedContextItems.some(
            (item) => (item.serviceLabels || []).includes(label) || item.serviceKey === label
          );
          if (!matched) {
            warnings.push(this.translate('chatbot.serviceLabelMismatch', '').replace('{label}', label));
          }
        }
      }

      if (warnings.length > 0 && isAdmin) {
        notificationService.warning(
          this.translate('chatbot.configMismatchWarning', '').replace('{warnings}', warnings.join('; ')),
          8000
        );
      }
      return !blocked;
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
        const mappedKey = serviceKeyMap[key];
        if (mappedKey) {
          return this.$t(mappedKey);
        }
        if (typeof key === 'string' && key.includes('.')) {
          return this.$t(key);
        }
        return key || '';
      } catch {
        return key || '';
      }
    },

    // Render Markdown safely
    renderMarkdown(content) {
      try {
        const html = marked.parse(content);
        let sanitized = DOMPurify.sanitize(html);
        
        // Render inline citations e.g. [1] or [1, 2]
        sanitized = sanitized.replace(/\[((?:\d+)(?:,\s*(?:\d+))*)\]/g, (match, p1) => {
          const numbers = p1.split(',').map(n => n.trim());
          const links = numbers.map(n => `<a href="#" class="citation-link" data-citation="${n}" title="Source ${n}">[${n}]</a>`);
          return `<sup class="citation">${links.join(', ')}</sup>`;
        });
        
        return sanitized;
      } catch (error) {
        console.error('Error rendering Markdown:', error);
        return DOMPurify.sanitize(content);
      }
    },

    async loadQuickHelpButtons() {
      try {
        const { loadConfig } = await import('../main.js');
        const config = await loadConfig();
        this.cachedConfig = config;
        const buttons = config?.features?.chat?.quickHelp?.buttons || [];
        const locale = this.currentLocale;

        // Filter hidden buttons (no matching corpus content) and resolve display text.
        // serviceLabels (explicit English KB labels) drives the FILTER only:
        //   - service       = localized display name (title, resolved per locale) — render only
        //   - serviceKey    = stable English KB label (first of serviceLabels, or id/title fallback)
        //   - serviceLabels = full English label array sent as the retriever filter
        // Display (service) and filter (serviceKey/serviceLabels) are DECOUPLED: the button always
        // shows its localized title, while the filter always uses English KB labels.
        // Buttons without serviceLabels fall back to title-based behavior (backward compat).
        this.quickHelpButtons = buttons
          .filter((button) => !button.hidden)
          .map((button) => {
            const title = resolveConfigText(button.title, locale);
            const visibleText = resolveConfigText(button.action?.visibleText, locale);
            const hiddenPrompt = resolveConfigText(button.action?.hiddenPrompt, locale);
            const explicitLabels = Array.isArray(button.serviceLabels) ? button.serviceLabels : null;

            return {
              service: title,
              serviceLabels: explicitLabels,
              serviceKey: explicitLabels ? explicitLabels[0] : button.id || title,
              textKey: button.title,
              visibleText: visibleText,
              hiddenPrompt: hiddenPrompt,
              icon: button.icon?.value,
              category: button.category,
              id: button.id
            };
          });
      } catch (error) {
        console.error('[ChatBotComponent] Failed to load Quick Help config:', error);
        this.quickHelpButtons = [];
      }
    },

    getWelcomeMessage() {
      const configWelcome = this.cachedConfig?.features?.chat?.welcomeMessage;
      if (configWelcome) {
        return resolveConfigText(configWelcome, this.currentLocale);
      }
      return this.translate('chatbot.welcomeMessage');
    },

    // formatUptime method removed

    handleSidebarToggle(_collapsed) {
      // Sidebar toggle state change
    },

    handleOpenDocument(_doc) {
      // Document opened
    },

    translate(key, fallback) {
      const value = this.$t(key);
      return value !== key ? value : fallback || key;
    },

    selectQuickHelpOption(option) {
      const rawOption = option && option.__v_isReactive ? { ...option } : option || {};
      if (!rawOption.service) {
        return;
      }
      const categoryId = rawOption.category || (rawOption.id !== 'just-chat' ? 'general' : null);

      // Quick Help is a mode switch: replace any prior Quick Help selection.
      // Sidebar items (source !== 'quickHelp') are additive and survive.
      // Also dedup: if the same Quick Help option is already selected, keep it as-is.
      const existingIdx = this.selectedContextItems.findIndex(
        (item) => item.source === 'quickHelp' && item.id === rawOption.id
      );
      if (existingIdx >= 0) {
        return; // already selected — no-op (preserves prior dedup behavior)
      }
      if (rawOption.id === 'just-chat') {
        // "Just Chat" clears all label filters so the retriever searches
        // across all documents without restriction. Keeps the Quick Help item
        // in context so conversation history is preserved for follow-up queries.
        this.selectedContextItems = this.selectedContextItems.filter((item) => item.source !== 'quickHelp');
        this.selectedContextItems.push({
          service: rawOption.service,
          serviceLabels: [], // empty — no label filter
          serviceKey: rawOption.serviceKey || rawOption.id || rawOption.service,
          source: 'quickHelp',
          id: rawOption.id,
          category: null,
          selected: true
        });
        this.currentCategoryId = null;
      } else {
        this.selectedContextItems = this.selectedContextItems.filter((item) => item.source !== 'quickHelp');
        this.selectedContextItems.push({
          service: rawOption.service,
          serviceLabels: rawOption.serviceLabels || null,
          serviceKey: rawOption.serviceKey || rawOption.id || rawOption.service,
          source: 'quickHelp',
          id: rawOption.id,
          category: categoryId,
          selected: true
        });
        this.currentCategoryId = categoryId;
      }

      this.showQuickHelp = false;
      if (rawOption.hiddenPromptKey || rawOption.hiddenPrompt) {
        // Display the visible text in the chat (what user sees)
        const visibleMessage = rawOption.visibleText || this.$t(rawOption.visibleTextKey);
        this.newMessage = visibleMessage;

        // Store the hidden prompt to send to backend (what LLM sees)
        this.hiddenPromptForNextMessage = rawOption.hiddenPrompt || this.$t(rawOption.hiddenPromptKey);
        this.sendMessage();
      }
    },

    handleTextareaFocus() {
      this.showQuickHelp = false;
    },

    handleTreeNodeSelected(item) {
      if (!item || typeof item !== 'object' || !item.service) {
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
          notificationService.info(this.translate('chatbot.contextAdded'), 1500);
          if (!this.currentCategoryId) {
            this.currentCategoryId = item.category || null;
          }
        }
      } else {
        const index = this.selectedContextItems.findIndex(
          (existing) => existing.service === this.safeTranslate(item.service) && existing.category === item.category
        );
        if (index !== -1) {
          const removedItem = this.selectedContextItems.splice(index, 1)[0];
          notificationService.info(this.translate('chatbot.contextRemoved'), 1500);
          eventBus.$emit('contextItemRemoved', removedItem);
          if (this.selectedContextItems.length === 0) {
            this.currentCategoryId = null;
          }
        }
      }
    },

    removeContextItem(index) {
      if (this.selectedContextItems.length > index) {
        this.selectedContextItems.splice(index, 1)[0];
      }
      if (this.selectedContextItems.length === 0 && this.currentCategoryId) {
        const quickHelpOption = this.quickHelpButtons.find((option) => option.category === this.currentCategoryId);
        if (quickHelpOption) {
          this.selectedContextItems = [
            {
              service: quickHelpOption.service,
              serviceLabels: quickHelpOption.serviceLabels || null,
              serviceKey: quickHelpOption.serviceKey || quickHelpOption.id || quickHelpOption.service,
              source: 'quickHelp',
              id: quickHelpOption.id,
              category: this.currentCategoryId,
              selected: true
            }
          ];
        } else {
          this.currentCategoryId = null;
        }
      }
    },

    async sendMessage() {
      const content = this.newMessage.trim();
      if (!content) return;

      // For dual-prompt mechanism: use hidden prompt for backend, visible text for display
      const messageForBackend = this.hiddenPromptForNextMessage || content;
      const messageForDisplay = content;

      this.chatMessages.push({
        sender: 'user',
        content: messageForDisplay,
        timestamp: new Date().toISOString(),
        isSaved: false
      });
      this.newMessage = '';
      this.showQuickHelp = false;
      this.isLoading = false;
      this.isStreaming = true;
      // Clear hidden prompt after use
      this.hiddenPromptForNextMessage = null;

      const lastMessageIndex = this.chatMessages.length;

      // Push placeholder bot message for streaming content
      this.chatMessages.push({
        sender: 'bot',
        content: '',
        timestamp: new Date().toISOString(),
        isSaved: false,
        metadata: {},
        isStreaming: true
      });

      try {
        const useConversationContext = this.selectedContextItems.length > 0;
        const contextOption = useConversationContext ? 'conversation-with-labels' : 'single-message';
        let queryData;
        const categoryLabel = this.getCategoryLabelById(this.currentCategoryId);
        if (contextOption === 'conversation-with-labels') {
          // Build the retriever filter from English KB labels:
          //  - Quick Help items: explicit serviceLabels array (English, may be multi-label)
          //  - Sidebar items: serviceKey (stable English key; `service` is localized — never use as filter)
          const serviceLabels = this.selectedContextItems.flatMap(
            (item) =>
              Array.isArray(item.serviceLabels)
                ? item.serviceLabels.length > 0
                  ? item.serviceLabels
                  : [] // explicitly empty (Just Chat) — no filter contribution
                : [item.serviceKey || item.service] // null/undefined — sidebar fallback
          );
          const messagesForQuery = this.chatMessages.map((msg) => ({
            role: msg.sender === 'user' ? 'user' : 'assistant',
            content: msg.content
          }));

          const lastUserMsgIndex = messagesForQuery.map((m) => m.role).lastIndexOf('user');
          if (lastUserMsgIndex !== -1 && messageForBackend !== messageForDisplay) {
            messagesForQuery[lastUserMsgIndex].content = messageForBackend;
          }

          queryData = {
            conversationId: this.conversationId,
            sessionId: this.currentSessionId || 'new-session',
            messages: messagesForQuery,
            context: {
              categoryLabel: categoryLabel,
              serviceLabels: serviceLabels,
              language: this.currentLocale.toUpperCase()
            },
            contextOption: 'conversation-with-context-labels',
            timestamp: new Date().toISOString()
          };
        } else {
          queryData = {
            sessionId: this.currentSessionId || 'new-session',
            text: messageForBackend,
            context: {
              language: this.currentLocale.toUpperCase()
            },
            contextOption: contextOption,
            timestamp: new Date().toISOString()
          };
        }

        // checkContextConfig returns false when the query must be blocked
        // (unresolved category id, or no filter active). Abort before sending.
        if (this.checkContextConfig(queryData.context) === false) {
          return;
        }

        // Cancel any previous stream
        if (this.streamController) {
          this.streamController.abort();
        }

        this.streamController = chatbotService.submitQueryStream(queryData, {
          onChunk: (content) => {
            this.chatMessages[lastMessageIndex].content += content;
            this.scrollToBottom();
          },
          onMetadata: (metadata) => {
            this.chatMessages[lastMessageIndex].metadata = metadata;
            if (metadata.confidence_score != null) {
              this.chatMessages[lastMessageIndex].confidenceScore = metadata.confidence_score;
            }
            // is_grounded: true = answer backed by retrieved document chunks;
            // false = generated from the LLM's own knowledge (no document basis).
            this.chatMessages[lastMessageIndex].isGrounded = metadata.is_grounded;
            if (metadata.responseTime) {
              this.systemStatus.lastResponseTime = metadata.responseTime;
            }
            this.systemStatus.online = true;
            this.systemStatus.errorMessage = '';
            this.systemStatus.lastUpdated = new Date();

            if (metadata.source_documents && Array.isArray(metadata.source_documents)) {
              const newDocs = metadata.source_documents.map((doc) => ({
                id: doc.document_id,
                title: doc.document_name || doc.file_name || `Source ${(doc.document_id || '').slice(0, 4)}`,
                documentName: doc.document_name,
                fileName: doc.file_name,
                type: doc.url?.split('.').pop().toUpperCase() || 'LINK',
                size: 0,
                url: doc.url,
                score: doc.score,
                categoryLabel: doc.categoryLabel,
                serviceLabels: doc.serviceLabels
              }));
              const existingIds = new Set(this.relatedDocuments.map((d) => d.id));
              const uniqueNewDocs = newDocs.filter((d) => !existingIds.has(d.id));
              this.relatedDocuments.unshift(...uniqueNewDocs);
            }
          },
          onTranslation: (translatedContent) => {
            this.chatMessages[lastMessageIndex].content = translatedContent;
            this.scrollToBottom();
          },
          onDone: (data) => {
            this.isStreaming = false;
            this.streamController = null;
            this.streamingQueryId = data.queryId;
            this.chatMessages[lastMessageIndex].isStreaming = false;
            this.chatMessages[lastMessageIndex].isSaved = false;
            if (data.queryId) {
              this.chatMessages[lastMessageIndex].queryId = data.queryId;
            }
            this.scrollToBottom();
            if (this.currentChatId) {
              this.updateChatInHistory();
            }
          },
          onError: (error) => {
            console.error('Stream error:', error);
            this.isStreaming = false;
            this.streamController = null;
            this.chatMessages[lastMessageIndex].isStreaming = false;

            if (!this.chatMessages[lastMessageIndex].content) {
              this.chatMessages[lastMessageIndex].content = this.translate('chatbot.streamingError');
            }

            this.systemStatus.lastResponseTime = null;
            this.systemStatus.online = false;
            this.systemStatus.errorMessage = error.message || this.translate('chatbot.processingError');
            this.systemStatus.lastUpdated = new Date();
            notificationService.error(this.translate('chatbot.streamingError'));
          }
        });
      } catch (error) {
        this.isStreaming = false;
        this.streamController = null;
        this.chatMessages[lastMessageIndex].isStreaming = false;

        console.error('Error sending query:', error);
        if (!this.chatMessages[lastMessageIndex].content) {
          this.chatMessages[lastMessageIndex].content = this.translate('chatbot.processingError');
        }
        this.systemStatus.lastResponseTime = null;
        this.systemStatus.online = false;
        this.systemStatus.errorMessage = error.message || this.translate('chatbot.processingError');
        this.systemStatus.lastUpdated = new Date();
        notificationService.error(this.translate('chatbot.processingError'));
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
        notificationService.error(this.translate('chatbot.feedbackMissingQueryId'));
        this.closeFeedbackDialog();
        return;
      }
      try {
        await chatbotService.submitFeedback(queryId, {
          rating: feedback.rating || (feedback.thumbFeedback === 'up' ? 4 : 2),
          comment: feedback.text || '',
          providedAt: new Date().toISOString()
        });
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
        const conversation = await this.chatHistoryService.getConversation(conversationId);

        if (!conversation) {
          throw new Error('Conversation not found');
        }

        this.conversationId = conversation._key;
        this.currentChatId = conversation._key;
        this.currentChatTitle = conversation.title || this.generateChatTitle();
        this.currentCategoryId = conversation.categoryId || null;

        // NEW: Populate related documents from history (files property from backend)
        if (conversation.files && Array.isArray(conversation.files)) {
          this.relatedDocuments = conversation.files.map((file) => {
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
        } else {
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
            content: this.getWelcomeMessage(),
            timestamp: new Date().toISOString(),
            queryId: null,
            isSaved: true
          });
        }

        this.selectedContextItems = [];
        if (conversation.tags && Array.isArray(conversation.tags)) {
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
        return;
      }

      this.isSaving = true;

      try {
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

        const conversation = await this.chatHistoryService.createConversation(conversationData);
        this.conversationId = conversation._key;

        for (const message of this.chatMessages) {
          if (
            (message.sender === 'bot' && !message.queryId) ||
            (message.sender === 'user' && message.content === firstUserMessage && !message.isSaved)
          ) {
            message.isSaved = true;
            continue;
          }

          if ((message.sender === 'user' || (message.sender === 'bot' && message.queryId)) && message.content) {
            const messageData = {
              conversationId: conversation._key,
              content: message.content,
              sender: message.sender === 'user' ? 'user' : 'assistant',
              queryId: message.queryId || null,
              metadata: message.metadata || {}
            };
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
        await this.$store.dispatch('chatHistory/createChat', chatData);

        if (this.saveChatDialog.folderId && this.saveChatDialog.folderId !== 'default') {
          await this.chatHistoryService.addConversationToFolder(this.saveChatDialog.folderId, conversation._key);
          await this.$store.dispatch('chatHistory/addChatToFolder', {
            chatId: conversation._key,
            folderId: this.saveChatDialog.folderId
          });
        }

        this.currentChatId = conversation._key;
        this.currentChatTitle = conversationData.title;
        this.lastSavedState.messages = [...this.chatMessages];
        this.lastSavedState.contextItems = [...this.selectedContextItems];
        this.updateChatInHistory();

        notificationService.success(this.translate('chatbot.chatSaved'));
        this.saveChatDialog.visible = false;

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
        await this.chatHistoryService.updateConversation(this.conversationId, updateData);

        for (const message of this.chatMessages) {
          if (message.isSaved) {
            continue;
          }
          if ((message.sender === 'user' || (message.sender === 'bot' && message.queryId)) && message.content) {
            const messageData = {
              conversationId: this.conversationId,
              content: message.content,
              sender: message.sender === 'user' ? 'user' : 'assistant',
              queryId: message.queryId || null,
              metadata: message.metadata || {}
            };
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
          this.chatMessages = JSON.parse(storedChatData);
        } else {
          this.chatMessages = [
            {
              sender: 'bot',
              content: this.getWelcomeMessage()
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
      this.chatMessages.splice(0, this.chatMessages.length, {
        sender: 'bot',
        content: this.getWelcomeMessage(),
        timestamp: new Date().toISOString(),
        isSaved: true
      });
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
      this.$nextTick(() => {
        this.scrollToBottom();
      });
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
.animate-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.app-container {
  display: flex;
  height: 100vh;
  overflow: hidden;
  gap: var(--space-sm);
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
  background: var(--surface);
  border-bottom: 1px solid var(--border-light);
  padding: var(--space-sm) var(--space-md);
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--text-base);
  min-height: 45px;
}

.status-left {
  display: flex;
  flex-direction: column; /* Stack status and error */
  align-items: flex-start;
  gap: var(--space-xs); /* Space between status and error */
  flex: 1; /* Allow error message to take space */
  overflow: hidden; /* Prevent long errors from breaking layout */
}

.status-error-message {
  font-size: var(--text-sm);
  color: var(--danger);
  font-weight: 500;
  margin-left: 18px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.status-metrics {
  display: flex;
  gap: var(--space-lg);
  padding-left: var(--space-md); /* Add space between error and metric */
}

.metric {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.metric-label {
  font-size: var(--text-xs);
  color: var(--muted-soft);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.metric-value {
  font-weight: 600;
  color: var(--fg);
}

/* Context Panel Styles */
.context-panel {
  background: var(--surface);
  border-bottom: 1px solid var(--border-light);
  padding: var(--space-sm) var(--space-sm);
  font-size: var(--text-base);
}

.context-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: var(--space-sm);
}

.context-title {
  font-weight: 600;
  color: var(--fg);
}

.context-items {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
}

.context-remove-btn {
}

/* Chat Window Styles */
.chat-window {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-sm);
  background: var(--surface);
  position: relative;
}

.chat-message {
  margin-bottom: var(--space-md);
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
  background: var(--bg);
  color: var(--fg);
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  font-size: var(--text-base);
  line-height: 1.5;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.chat-message.user .message-bubble {
  background: var(--accent);
  color: var(--accent-fg);
  border: none;
  border-bottom-right-radius: var(--radius-sm);
}

.chat-message.bot .message-bubble {
  border-bottom-left-radius: var(--radius-sm);
}

.message-wrapper {
  display: flex;
  align-items: flex-end;
  gap: var(--space-sm);
  max-width: 85%;
}

.chat-message.user .message-wrapper {
  flex-direction: row-reverse;
}

.message-time {
  font-size: var(--text-xs);
  color: var(--muted);
  white-space: nowrap;
  padding-bottom: 2px;
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
  color: var(--fg);
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
  color: var(--fg);
}

.message-bubble :deep(ul),
.message-bubble :deep(ol) {
  margin: 0.5em 0;
  padding-left: 1.5em;
}

.message-bubble :deep(li) {
  margin-bottom: 0.3em;
  color: var(--fg);
}

.message-bubble :deep(a) {
  color: var(--accent);
  text-decoration: underline;
}

.message-bubble :deep(a:hover) {
  color: var(--accent-hover);
}

.message.bot-message-meta {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-top: 0.5rem;
  margin-left: 0.5rem;
}

:deep(.citation) {
  font-size: 0.75em;
  line-height: 0;
  position: relative;
  vertical-align: baseline;
  top: -0.5em;
  margin: 0 0.1em;
}

:deep(.citation-link) {
  color: var(--color-primary);
  text-decoration: none;
  font-weight: 600;
  cursor: pointer;
  transition: color 0.2s ease;
}

:deep(.citation-link:hover) {
  color: var(--color-primary-dark);
  text-decoration: underline;
}

.confidence-score,
.grounding-flag {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.75rem;
  color: var(--color-text-light);
  background-color: var(--color-background-soft);
  padding: 0.25rem 0.5rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
}

.grounding-flag {
  color: var(--color-warning-dark, #b45309);
  background-color: var(--color-warning-light, #fef3c7);
  border-color: var(--color-warning-border, #fcd34d);
}

.feedback-trigger {
  margin-left: auto;
}

.message-bubble :deep(code) {
  background: var(--bg);
  padding: 0.2em 0.4em;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  color: var(--fg);
}

.message-bubble :deep(pre) {
  background: var(--bg);
  padding: 0.8em;
  border-radius: var(--radius-sm);
  overflow-x: auto;
  font-family: var(--font-mono);
  color: var(--fg);
}

.message-bubble :deep(blockquote) {
  border-left: 3px solid var(--border);
  padding-left: 0.8em;
  margin: 0.5em 0;
  color: var(--muted);
}

.message-bubble :deep(table) {
  border-collapse: collapse;
  margin: 0.5em 0;
  width: 100%;
}

.message-bubble :deep(th),
.message-bubble :deep(td) {
  border: 1px solid var(--border);
  padding: 0.4em 0.8em;
  color: var(--fg);
}

.message-bubble :deep(th) {
  background: var(--bg);
  font-weight: 600;
}

.message-bubble :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: var(--radius-sm);
}

/* Streaming Indicator — shown inside bot bubble while waiting for first chunk */
.streaming-indicator {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  color: var(--muted);
  font-size: var(--text-sm);
  padding: var(--space-xs) 0;
}

.bot-message-meta {
  margin-left: var(--space-sm);
  align-self: center;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  align-items: flex-start;
}

.confidence-score {
  font-size: var(--text-sm);
  color: var(--muted-soft);
  background: var(--surface);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

/* Shown when the answer is not backed by retrieved documents (LLM-only). */
.grounding-flag {
  font-size: var(--text-sm);
  color: var(--warning);
  background: var(--warning-bg);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.feedback-trigger {
  margin-left: 0;
}

.feedback-trigger button {
  background: none;
  border: none;
  cursor: pointer;
  font-family: inherit;
  font-size: inherit;
  font-weight: inherit;
  color: inherit;
  padding: 0;
}

/* Quick Help Overlay */
.quick-help-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--surface);
  z-index: 10;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-lg);
  overflow-y: auto;
}

.quick-help-content {
  max-width: 600px;
  width: 100%;
}

.quick-help-heading {
  text-align: center;
  font-size: var(--text-xl);
  font-weight: 600;
  margin-bottom: var(--space-lg);
  color: var(--fg);
}

.quick-help-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: var(--space-md);
}

.quick-help-item {
  display: flex;
  align-items: center;
}

.quick-help-item:hover {
  --ds-card-border-color: var(--accent-hover);
}

.quick-help-icon {
  margin-right: var(--space-md);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
}

.quick-help-icon img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.quick-help-text {
  font-size: var(--text-base);
  color: var(--fg);
  font-weight: 500;
}

/* Chat Input Styles */
.chat-input {
  display: flex;
  flex-direction: column;
  background: var(--bg-tertiary);
  border-top: 1px solid var(--border);
  padding: var(--space-sm);
}

.input-actions {
  display: flex;
  justify-content: space-between;
  gap: var(--space-sm);
  align-items: center;
}

/* Form Styles for Save Dialog */
.form-group {
  margin-bottom: var(--space-md);
}

.form-group label {
  display: block;
  margin-bottom: var(--space-sm);
  font-weight: 500;
  color: var(--fg);
}

/* Responsive Adjustments */
@media (min-width: 768px) {
  .chat-input {
    flex-direction: row;
    align-items: flex-end;
  }

  .prompt-textarea {
    margin-bottom: 0;
    margin-right: var(--space-sm);
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
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-sm);
  }

  .status-metrics {
    width: 100%;
    justify-content: space-between;
  }
}

@media (max-width: 480px) {
  .quick-help-grid {
    grid-template-columns: 1fr;
  }

  .quick-help-heading {
    font-size: var(--text-lg);
  }
}

/* Saving Indicator Styles */
.saving-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-sm);
  margin-top: var(--space-md);
  padding: var(--space-md);
  background-color: var(--bg);
  border-radius: var(--radius-sm);
  color: var(--muted);
  font-size: var(--text-base);
}

.saving-indicator :deep(svg) {
  color: var(--accent);
}
</style>
