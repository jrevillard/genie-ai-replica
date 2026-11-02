<template>
  <div class="app-container" :class="{ 'welcome-mode': isWelcomeMode }">
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
      <modal-dialog
        v-if="exportDialog.visible"
        @close="exportDialog.visible = false"
      >
        <template v-slot:header>
          <h3>{{ translate("chatbot.exportChat") }}</h3>
        </template>
        <template v-slot:body>
          <div class="form-group">
            <label for="exportFilename">{{
              translate("chatbot.exportFilename")
            }}</label>
            <input
              type="text"
              id="exportFilename"
              v-model="exportDialog.filename"
              :placeholder="translate('chatbot.exportFilenamePlaceholder')"
            />
          </div>
        </template>
        <template v-slot:footer>
          <button @click="exportDialog.visible = false" class="cancel-btn">
            {{ translate("common.cancel") }}
          </button>
          <button
            @click="exportChatToPDF"
            class="primary-btn"
            :disabled="!exportDialog.filename.trim()"
          >
            {{ translate("chatbot.exportButton") }}
          </button>
        </template>
      </modal-dialog>

      <!-- System Status Panel -->
      <!-- M.1/CAP-6: admin diagnostics — hidden entirely for regular users,
           including the error line (failures surface via toasts) -->
      <div class="system-status-panel" v-if="!isRegularUser">
        <div class="status-left">
          <div class="status-indicator" :class="{ online: systemStatus.online }">
            <div class="status-dot"></div>
            <span>{{
              systemStatus.online
                ? translate("status.online")
                : translate("status.offline")
            }}</span>
          </div>
          <div v-if="!systemStatus.online && systemStatus.errorMessage" class="status-error-message">
             {{ systemStatus.errorMessage }}
          </div>
        </div>
        <div class="status-metrics">
          <div class="metric">
            <span class="metric-label">{{
              translate("status.lastResponseTime")
            }}</span>
            <span class="metric-value"
              >{{ systemStatus.lastResponseTime !== null ? systemStatus.lastResponseTime + 'ms' : 'N/A' }}</span
            >
          </div>
        </div>
      </div>
      <!-- Context Panel for selected tree nodes -->
      <div class="context-panel" v-if="selectedContextItems.length > 0">
        <div class="context-header">
          <span class="context-title">{{
            translate("chatbot.queryContext")
          }}</span>
        </div>
        <div class="context-items">
          <div
            v-for="(item, index) in selectedContextItems"
            :key="index"
            class="context-item"
          >
            <span class="context-text">{{ item.service }}</span>
            <button
              class="context-remove-btn"
              @click="removeContextItem(index)"
              :aria-label="translate('chatbot.removeItem')"
            >
              ✕
            </button>
          </div>
        </div>
      </div>
      <!-- The scrollable chat window -->
      <div class="chat-window" ref="chatWindow" aria-live="polite" v-show="chatMessages.length > 0">
        <div
          v-for="(msg, index) in chatMessages"
          :key="index"
          class="chat-message"
          :class="msg.sender"
        >
          <div class="message-bubble">
            <!-- Render bot messages as sanitized HTML for Markdown, user messages as plain text -->
            <span v-if="msg.sender === 'user'">{{ msg.content }}</span>
            <div v-else class="bot-markdown" v-html="renderMarkdown(msg.content)"></div>
          </div>
          <!-- Feedback and confidence score for bot messages -->
          <div v-if="msg.sender === 'bot'" class="bot-message-meta">
            <!-- M.10: confidence is an admin/elevated diagnostic — regular
                 users never see it -->
            <div
              v-if="msg.confidenceScore && !isRegularUser"
              class="confidence-score"
            >
              <i class="fas fa-brain"></i>
              <span
                >Confidence: {{ (msg.confidenceScore * 100).toFixed(0) }}%</span
              >
            </div>
            <div class="feedback-trigger">
              <button @click="openFeedbackDialog(index)">
                {{ translate("feedback.button") }}
              </button>
            </div>
          </div>
        </div>
        <!-- Auto-scroll anchor element -->
        <div ref="messagesEnd"></div>
      </div>
      <!-- Loading spinner with "Thinking..." text -->
      <div
        v-if="isLoading"
        class="loading-spinner"
        role="status"
        :aria-label="tOr('chatbot.processing', 'Processing your request')"
      >
        <i class="fas fa-spinner fa-spin" aria-hidden="true"></i>
        <span class="loading-text">{{ tOr("chatbot.thinking", "Thinking...") }}</span>
      </div>
      <!-- Quick Help Overlay (landing / welcome screen) — M.9: hero only;
           the starter grid moved below the input (Google: art → input → buttons) -->
      <div class="quick-help-overlay" v-if="isWelcomeMode">
        <div class="quick-help-content">
          <!-- Keletso landing hero: greeting pill over Adem's welcome art.
               M.15: greeting only, per Adem — subline dropped. -->
          <KeletsoHero
            :greeting="tOr('chatbot.greeting', 'Lumela! Welcome to Agrivisory')"
          />
        </div>
      </div>
      <!-- Input Area - Always visible at bottom (M.5: ChatGPT-style pill) -->
      <div class="chat-input">
        <div class="chat-input-pill">
          <div class="pill-utilities">
            <!-- M.18: new chat = compose icon (fa-edit = FA5's
                 pen-to-square), shown after the first message like
                 save/export — Adem 10-12 -->
            <button
              v-if="chatMessages.length > 0"
              class="pill-icon-btn"
              @click="startNewChat"
              :title="translate('chatbot.newChat')"
              :aria-label="translate('chatbot.newChat')"
            >
              <i class="fas fa-edit"></i>
            </button>
            <button
              v-if="chatMessages.length > 0"
              class="pill-icon-btn"
              @click="saveChatToHistory"
              :title="translate('chatbot.saveChat')"
              :aria-label="translate('chatbot.saveChat')"
            >
              <i class="fas fa-save"></i>
            </button>
            <button
              v-if="chatMessages.length > 0"
              class="pill-icon-btn"
              @click="openExportDialog"
              :title="translate('chatbot.exportChat')"
              :aria-label="translate('chatbot.exportChat')"
            >
              <i class="fas fa-file-pdf"></i>
            </button>
          </div>
          <textarea
            ref="promptInput"
            v-model="newMessage"
            class="prompt-textarea"
            rows="1"
            :placeholder="translate('chatbot.placeholder')"
            @keyup.enter.exact.prevent="sendMessage"
            @focus="handleTextareaFocus"
            @input="autoGrowInput"
          ></textarea>
          <button
            class="pill-send-btn"
            @click="sendMessage"
            :disabled="!newMessage.trim()"
            :title="translate('chatbot.sendButton')"
            :aria-label="translate('chatbot.sendButton')"
          >
            <i class="fas fa-arrow-up"></i>
          </button>
        </div>
      </div>
      <!-- M.9: starter buttons below the input in welcome mode (Google:
           art → input → buttons); unmount on first message -->
      <div class="quick-help-below" v-if="isWelcomeMode">
        <div class="quick-help-grid">
          <button
            v-for="button in quickHelpButtons"
            :key="button._key"
            type="button"
            class="quick-help-item"
            :class="{ 'just-chat': button.isJustChat }"
            @click="selectQuickHelpOption(button)"
          >
            <!-- Keletso Basotho topic icons where the admin button has a
                 known _key; anything else (admin-created) keeps its icon img -->
            <KeletsoIcon
              v-if="keletsoIconFor(button)"
              :name="keletsoIconFor(button)"
              :size="34"
              class="quick-help-icon"
            />
            <img
              v-else
              class="quick-help-icon"
              :src="button.icon"
              alt=""
              aria-hidden="true"
            />
            <span class="quick-help-text">{{ quickHelpText(button.title) }}</span>
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
        @close="saveChatDialog.visible = false"
      >
        <template v-slot:header>
          <h3>{{ translate("chatbot.saveChat") }}</h3>
        </template>
        <template v-slot:body>
          <div class="form-group">
            <label for="chatTitle">{{ translate("chatbot.chatTitle") }}</label>
            <input
              type="text"
              id="chatTitle"
              v-model="saveChatDialog.title"
              :placeholder="translate('chatbot.chatTitlePlaceholder')"
            />
          </div>
          <div class="form-group">
            <label for="chatFolder">{{
              translate("chatbot.selectFolder")
            }}</label>
            <select id="chatFolder" v-model="saveChatDialog.folderId">
              <option
                v-for="folder in folders"
                :key="folder.id"
                :value="folder.id"
              >
                {{ folder.name }}
              </option>
            </select>
          </div>
        </template>
        <template v-slot:footer>
          <button @click="saveChatDialog.visible = false" class="cancel-btn">
            {{ translate("common.cancel") }}
          </button>
          <button
            @click="handleSaveChat"
            class="primary-btn"
            :disabled="!saveChatDialog.title.trim()"
          >
            {{ translate("common.save") }}
          </button>
        </template>
      </modal-dialog>
    </div>
    <!-- Right Sidebar - Now using the dedicated component -->
    <!-- M.1: hidden for regular users (related docs + FAQ are admin surfaces) -->
    <right-side-bar-component
      v-if="!isRegularUser"
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
import { eventBus } from "../eventBus.js";
import notificationService from "../services/notificationService";
import { mapGetters, mapActions } from "vuex";
import ChatResponseFeedbackDialog from "./ChatResponseFeedbackDialog.vue";
import ModalDialog from "./ModalDialog.vue";
import RightSideBarComponent from "./RightSideBarComponent.vue";
import chatbotService from "../services/chatbotService";
import quickhelpService from "../services/quickhelpService";
import { streamChatQuery, abortActiveStream } from "../services/streamingService";
import serviceTreeService from "../services/serviceTreeService"; // *** NEW: Import serviceTreeService
import ConfirmDialog from "@/components/ConfirmDialog.vue";
// AgriConnect LSO (Keletso design): landing hero + Basotho topic icons,
// ported from ITU-Agrivisory-Agriconnect-LSO feature/landing-polish (S-2)
import KeletsoHero from "@/components/KeletsoHero.vue";
import KeletsoIcon from "@/components/KeletsoIcon.vue";
import chatHistoryService from "../services/chatHistoryService";
import analyticsService from "../services/analyticsService";
import { marked } from "marked";
import DOMPurify from "dompurify";
import jsPDF from "jspdf";

// K.7: wire cap for the conversation payload — bounds payload size + NLLB
// history-translation latency on restored long chats (server truncation still
// bounds the model's view). Exported so the payload tests pin the same number.
export const HISTORY_MESSAGE_CAP = 20;

export default {
  name: "ChatBotComponent",
  components: {
    ChatResponseFeedbackDialog,
    ModalDialog,
    RightSideBarComponent,
    ConfirmDialog,
    KeletsoHero,
    KeletsoIcon,
  },

  data() {
    return {
      useStreaming: true,
      conversationId: null,
      messages: [],
      chatMessages: [],
      newMessage: "",
      selectedContextItems: [],
      feedbackDialog: {
        visible: false,
        message: null,
      },
      saveChatDialog: {
        visible: false,
        title: "",
        folderId: "default",
      },
      exportDialog: {
        visible: false,
        filename: "",
      },
      currentChatId: null,
      currentChatTitle: "",
      currentLocale: "en",
      showQuickHelp: true,
      currentCategoryId: null,
      serviceCategories: [], // This will now hold the transformed tree data
      chatHistoryService: chatHistoryService,
      systemStatus: {
        online: true,
        lastResponseTime: null, // Replaced avgResponseTime
        errorMessage: "", // Added for error messages
        lastUpdated: new Date(),
      },
      quickHelpButtons: [],
      _quickHelpLoadSeq: 0,
      showNewChatConfirm: false,
      newChatDialog: {
        title: "",
        message: "",
        confirmText: "",
        cancelText: "",
      },
      lastSavedState: {
        messages: [],
        contextItems: [],
      },
      showLoadConfirm: false,
      loadConfirmDialog: {
        title: "",
        message: "",
        confirmText: "",
        cancelText: "",
        secondaryText: "",
      },
      pendingConversationId: null,
      isLoading: false, // Loading state for spinner
      relatedDocuments: [], // Holds documents for the right sidebar
    };
  },

  created() {
    eventBus.$on("chat-deleted", (deletedChatId) => {
      if (this.conversationId === deletedChatId) {
        this.conversationId = null;
        this.currentChatId = null;
        this.chatMessages = [
          {
            sender: "bot",
            content: this.translate("chatbot.welcomeMessage"),
            timestamp: new Date().toISOString(),
            isSaved: true,
            isUiOnly: true, // K.7: greeting never ships as model history
          },
        ];
        this.newMessage = "";
        this.selectedContextItems = [];
        this.relatedDocuments = [];
        this.lastSavedState = {
          messages: JSON.parse(JSON.stringify(this.chatMessages)),
          contextItems: [],
        };
        console.log(
          `Reset conversation ID after deletion of chat ${deletedChatId}`
        );
      }
    });

    eventBus.$on("load-conversation", (conversationId) => {
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

  computed: {
    ...mapGetters("chatHistory", ["getAllFolders", "getChatById"]),
    ...mapGetters(["isRegularUser"]),

    // M.9: Google-style welcome (art + centered input + starters) until the
    // first message lands; then normal bottom-input chat mode.
    isWelcomeMode() {
      return this.showQuickHelp && this.chatMessages.length === 0;
    },

    folders() {
      return this.getAllFolders;
    },

    chatPreview() {
      const userMessage = this.chatMessages.find(
        (msg) => msg.sender === "user"
      );
      if (userMessage) {
        return userMessage.content.length > 50
          ? userMessage.content.substring(0, 47) + "..."
          : userMessage.content;
      }
      return "New conversation";
    },
  },

  mounted() {
    // Quick-help overlay serves as the welcome screen, no need for a chat bubble welcome message

    if (this.$root.$i18n) {
      this.currentLocale = this.$root.$i18n.locale;
      this.$watch(
        () => this.$root.$i18n.locale,
        (newLocale) => {
          this.currentLocale = newLocale;
          // Update context labels when locale changes
          this.selectedContextItems = this.selectedContextItems.map((item) => ({
            ...item,
            service: this.safeTranslate(item.serviceKey || item.service),
          }));
          this.loadServiceCategories(); // Reload categories for the new locale
        }
      );
    }

    eventBus.$on("treeNodeSelected", this.handleTreeNodeSelected);
    eventBus.$on("open-chat", this.loadChatFromHistory);
    eventBus.$on("go-home", this.handleGoHome);
    // J.4: admin edits buttons in the dashboard overlay while this chat
    // stays mounted — refresh the grid on save (knowledge-hierarchy-updated
    // pattern).
    eventBus.$on("quick-help-updated", this.loadQuickHelpButtons);
    this.scrollToBottom();
    this.loadQuickHelpButtons();
    this.loadWeatherLocations();
    this.loadServiceCategories(); // Fetch categories on mount

    // Removed the statusUpdateInterval
    this.updateDialogTexts();
  },

  beforeUnmount() {
    eventBus.$off("treeNodeSelected", this.handleTreeNodeSelected);
    eventBus.$off("open-chat", this.loadChatFromHistory);
    eventBus.$off("go-home", this.handleGoHome);
    eventBus.$off("quick-help-updated", this.loadQuickHelpButtons);
    eventBus.$off("chat-deleted"); // Clean up the chat-deleted listener
    // Removed clearInterval
    eventBus.$off("load-conversation");
    // Audit F9: never leave an orphaned stream burning the upstream after
    // the component is gone.
    abortActiveStream();
  },

  watch: {
    currentLocale: function () {
      this.updateDialogTexts();
    },
  },

  methods: {
    ...mapActions("chatHistory", ["createChat", "updateChat"]),

    // *** UPDATED: Use serviceTreeService to load and transform categories ***
    async loadServiceCategories() {
      try {
        // Use the service which handles transformation and localization
        this.serviceCategories = await serviceTreeService.getAllCategories(
          this.currentLocale
        );
        console.log(
          "[ChatBotComponent] Service categories loaded for lookup via serviceTreeService:",
          this.serviceCategories
        );
      } catch (error) {
        console.error(
          "[ChatBotComponent] Failed to load service categories:",
          error
        );
        notificationService.error("Could not load service categories.");
      }
    },

    // *** UPDATED: Find category label by its key in the transformed tree data ***
    getCategoryLabelById(id) {
      if (id === null || id === undefined) {
        // DEC-27: quick-help items no longer enter selectedContextItems, so
        // there is no quickhelp.justChat special case — null stays null (no
        // category filter; service labels, if any, still apply).
        return null;
      }

      // The service returns `catKey` which corresponds to the numeric ID
      const category = this.serviceCategories.find(
        (cat) => cat.catKey == id.toString()
      );
      if (category) {
        // The service already provides the localized name in the `name` property
        return category.name || `Category ${id}`;
      }

      console.warn(
        `[ChatBotComponent] Category label for ID "${id}" not found.`
      );
      return `Category ${id}`; // Fallback
    },

    // Safely translate a key, with mapping for static strings
    safeTranslate(key) {
      try {
        const serviceKeyMap = {
          "Layanan Pelanggan": "context.customerService",
          Pembayaran: "context.payment",
          Pengiriman: "context.shipping",
          "Layanan Kesehatan": "context.healthService",
          Perumahan: "context.housing",
          Imigrasi: "context.immigration",
          Pendidikan: "context.education",
          Pajak: "context.tax",
          Pensiun: "context.retirement",
          "Lainnya - Pribadi": "context.personalOther",
        };
        const translationKey = serviceKeyMap[key] || key;
        if (typeof translationKey === "string" && translationKey.trim()) {
          const translated = this.$t(translationKey);
          return translated !== translationKey ? translated : key;
        }
        console.warn(`Invalid translation key: ${key}`);
        return this.$t("context.fallback") || key || "Unknown";
      } catch (error) {
        console.error(`Translation error for key ${key}:`, error);
        return this.$t("context.fallback") || key || "Unknown";
      }
    },

    // Render Markdown safely
    renderMarkdown(content) {
      try {
        // M.3: breaks:true — single newlines become <br> (compact line
        // structure) now that the bot div no longer pre-wraps.
        const html = marked.parse(content, { breaks: true });
        return DOMPurify.sanitize(html);
      } catch (error) {
        console.error("Error rendering Markdown:", error);
        return DOMPurify.sanitize(content);
      }
    },

    /**
     * Get the user's selected weather location from the weather widget.
     * Reads the saved location ID from localStorage and resolves coordinates
     * from the config. Returns null if no location is available.
     */
    getWeatherLocation() {
      try {
        const savedLocationId = localStorage.getItem('genie-ai-weather-location');
        if (!savedLocationId) return null;

        // Look up coordinates from cached weather locations (loaded from config)
        if (this._weatherLocations) {
          const loc = this._weatherLocations.find(l => l.id === savedLocationId);
          if (loc) {
            return { latitude: loc.latitude, longitude: loc.longitude };
          }
        }
        return null;
      } catch (e) {
        console.warn('[ChatBotComponent] Could not resolve weather location:', e);
        return null;
      }
    },

    async loadWeatherLocations() {
      try {
        const { loadConfig } = await import("../main.js");
        const config = await loadConfig();
        this._weatherLocations = config?.weather?.locations || [];
      } catch (e) {
        console.warn('[ChatBotComponent] Could not load weather locations:', e);
        this._weatherLocations = [];
      }
    },

    async loadQuickHelpButtons() {
      // J.4 (DEC-28): buttons come from the backend (admin-managed,
      // quickhelpButtons collection) — bilingual stored text, no i18n keys.
      // NO fallback to the old baked config set: a stale set masking a
      // backend failure is exactly the silent fallback plan.md forbids.
      // The chat page is behind login and dead without the backend anyway;
      // failure = loud error + empty grid.
      console.log("[ChatBotComponent] Loading Quick Help buttons from backend");
      // Out-of-order guard: a quick-help-updated refresh can race an
      // in-flight load; only the newest request may write the grid.
      const seq = ++this._quickHelpLoadSeq;
      try {
        const buttons = await quickhelpService.getButtons();
        if (seq !== this._quickHelpLoadSeq) return;
        this.quickHelpButtons = buttons;
        console.log(
          `[ChatBotComponent] Loaded ${buttons.length} Quick Help buttons:`,
          buttons.map((b) => ({ _key: b._key, title: b.title?.en, order: b.order }))
        );
      } catch (error) {
        if (seq !== this._quickHelpLoadSeq) return;
        console.error(
          "[ChatBotComponent] Failed to load Quick Help buttons from backend:",
          error
        );
        this.quickHelpButtons = [];
      }
    },

    // DEC-28: locale lookup for stored bilingual button text — st optional,
    // empty falls back to en (same logic as fallbackLocale for the rest of
    // the site).
    quickHelpText(obj) {
      if (!obj) return "";
      return obj[this.currentLocale] || obj.en || "";
    },

    getCurrentTheme() {
      const documentTheme = document.documentElement.getAttribute("data-theme");
      const bodyTheme = document.body.getAttribute("data-theme");
      return documentTheme || bodyTheme || "light";
    },

    // formatUptime method removed

    handleSidebarToggle(collapsed) {
      console.log("Sidebar collapsed state:", collapsed);
    },

    handleOpenDocument(doc) {
      console.log("Document opened:", doc);
    },

    translate(key) {
      return this.$t(key);
    },

    // AgriConnect LSO: translate with an English fallback, so new keys never
    // show up as raw "chatbot.xyz" text before they're added to the locale files.
    tOr(key, fallback) {
      const translated = this.$t(key);
      return translated && translated !== key ? translated : fallback;
    },

    // AgriConnect LSO: the eight DEC-28 ship-set buttons get their Basotho
    // icon by _key; admin-created buttons (any other _key) fall back to
    // their stored icon img — the admin surface stays fully in charge.
    keletsoIconFor(button) {
      const map = {
        "just-chat": "chat",
        "crop-advice": "crop",
        "soil-fertilizers": "soil",
        "pest-control": "pest",
        "maize-in-lesotho": "maize",
        "pre-planting": "plan",
        "crop-management": "care",
        "harvest-storage": "store",
      };
      return map[button._key] || null;
    },

    selectQuickHelpOption(option) {
      // DEC-27 (10-04): quick-help buttons are conversation starters, not
      // label selectors. The old context push sent display strings ("Crop
      // advice", "Category 248445") as retrieval filter labels, and the
      // retriever's hard ANY-IN chunk_labels filter zeroed every result
      // ("no information"). Buttons add no label filter of their own — the
      // prompt joins the running conversation (K.7 always-conversation
      // payload); existing tree-selected labels (real taxonomy names) still
      // apply as designed.
      // DEC-28: prompt text is stored bilingual data; the current locale's
      // text is sent (ST locale sends the ST prompt, matching typed-input
      // behavior under the DEC-26 language contract).
      this.showQuickHelp = false;
      const message = option ? this.quickHelpText(option.prompt) : "";
      if (message.trim()) {
        this.newMessage = message;
        this.sendMessage();
      } else {
        console.warn(
          `[ChatBotComponent] Quick Help button without prompt text: ${option?._key}`
        );
      }
    },

    handleTextareaFocus() {
      // Quick help stays visible until user sends a message or clicks a suggestion
      // M.12 belt for iOS: make sure the focused pill is inside the visible
      // area once the keyboard-driven resize settles
      if (this.$refs.promptInput && this.$refs.promptInput.scrollIntoView) {
        setTimeout(() => {
          this.$refs.promptInput.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }, 300);
      }
    },

    // M.5: auto-grow the pill textarea (1 row → ~6, then scrolls)
    autoGrowInput() {
      const el = this.$refs.promptInput;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 144) + "px";
    },

    handleTreeNodeSelected(item) {
      if (!item || typeof item !== "object" || !item.service) {
        console.warn("Invalid tree node selected:", item);
        return;
      }

      if (item.selected) {
        const exists = this.selectedContextItems.some(
          (existing) =>
            existing.service === this.safeTranslate(item.service) &&
            existing.category === item.category
        );
        if (!exists) {
          this.selectedContextItems.push({
            service: this.safeTranslate(item.service),
            serviceKey: item.service,
            category: item.category || "general",
            selected: true,
          });
          console.log(
            `Added sidebar context item: ${this.safeTranslate(
              item.service
            )} with category ID ${item.category || "general"}`
          );
          notificationService.info(
            this.translate("chatbot.contextAdded"),
            1500
          );
          if (!this.currentCategoryId) {
            this.currentCategoryId = item.category || null;
            console.log(
              `Set current category ID to ${this.currentCategoryId} from sidebar node.`
            );
          }
        } else {
          console.log(
            `Context item ${this.safeTranslate(
              item.service
            )} with category ID ${item.category} already exists`
          );
        }
      } else {
        const index = this.selectedContextItems.findIndex(
          (existing) =>
            existing.service === this.safeTranslate(item.service) &&
            existing.category === item.category
        );
        if (index !== -1) {
          const removedItem = this.selectedContextItems.splice(index, 1)[0];
          console.log(
            `Removed sidebar context item: ${removedItem.service} with category ID ${removedItem.category}`
          );
          notificationService.info(
            this.translate("chatbot.contextRemoved"),
            1500
          );
          eventBus.$emit("contextItemRemoved", removedItem);
          if (this.selectedContextItems.length === 0) {
            this.currentCategoryId = null;
            console.log(
              "Cleared current category ID as no context items remain."
            );
          }
        }
      }
    },

    removeContextItem(index) {
      if (this.selectedContextItems.length > index) {
        const removedItem = this.selectedContextItems.splice(index, 1)[0];
        console.log(
          `Removed context item: ${removedItem.service} at index ${index}`
        );
      }
      // DEC-27: the old branch re-fabricated a quick-help context item from
      // a stock category ID when the last chip was removed — the same
      // display-string label filter this story deletes. Just clear instead.
      if (this.selectedContextItems.length === 0) {
        this.currentCategoryId = null;
      }
    },

    // Streamed chat: appends deltas to a live bot bubble. Returns true when a
    // streamed answer was rendered; false when we should fall back to the
    // classic whole-response path; throws when a partial answer is showing.
    async tryStreamQuery(queryData, startTime) {
      const botMessage = {
        sender: "bot",
        content: "",
        timestamp: new Date().toISOString(),
        isSaved: false,
        metadata: {},
      };
      let started = false;
      let streamErrored = false;
      let streamErrorText = "";
      const result = await streamChatQuery(queryData, {
        onOpen: () => {
          this.chatMessages.push(botMessage);
          started = true;
        },
        onDelta: (text) => {
          botMessage.content += text;
        },
        // F4 (DEC-19 Sesotho primary): the streamed English was a live preview —
        // the final translated answer REPLACES the bubble content (and is what
        // the backend persists to Arango).
        onTranslation: (translated) => {
          botMessage.content = translated;
        },
        // F4: translation unavailable — the English answer stands, with a muted
        // notice line appended so the wrong language is never passed off silently.
        onTranslationNotice: () => {
          botMessage.content += `\n\n_${this.translate("chatbot.translationUnavailable")}_`;
          // K.7: the notice line must not ship as model history
          botMessage.isUiOnly = true;
        },
        onError: (errText) => {
          // Audit F9: keep the backend's reason ("empty response from
          // pipeline", "upstream timeout", …) — a generic message hides
          // exactly the thing the user needs to know.
          streamErrored = true;
          streamErrorText = errText || "";
        },
      }).catch((err) => {
        if (!started) return null; // silent fallback
        throw err;
      });
      if (!result) return false;
      // Upstream error with nothing to show: drop the empty bubble and let
      // sendMessage's catch render the error state.
      if (streamErrored && !botMessage.content) {
        this.chatMessages = this.chatMessages.filter((m) => m !== botMessage);
        throw new Error(streamErrorText || this.translate("chatbot.processingError"));
      }
      // Partial answer + error is NOT a clean success — mark the bubble so
      // the user sees the answer was cut short (audit F9).
      if (streamErrored && botMessage.content) {
        botMessage.content += `\n\n> ⚠️ ${this.translate("chatbot.responseTruncated")}`;
        // K.7: the warning line must not ship as model history
        botMessage.isUiOnly = true;
        this.systemStatus.online = false;
        this.systemStatus.errorMessage = streamErrorText;
      }

      this.systemStatus.lastResponseTime = Math.round(performance.now() - startTime);
      this.systemStatus.online = true;
      this.systemStatus.errorMessage = "";
      this.systemStatus.lastUpdated = new Date();

      // Vue 3: direct assignment — $set was removed (its TypeError killed the
      // post-success block and cascaded into the double-message + offline status).
      botMessage.queryId = result.queryId;
      botMessage.metadata = result.metadata || {};
      if (result.metadata && result.metadata.confidence_score) {
        botMessage.confidenceScore = result.metadata.confidence_score;
      }
      this.applySourceDocuments(result.metadata);
      if (result.sessionId) {
        this.currentSessionId = result.sessionId;
      }
      return true;
    },

    applySourceDocuments(metadata) {
      if (!metadata || !Array.isArray(metadata.source_documents)) return;
      const newDocs = metadata.source_documents.map((doc) => ({
        id: doc.document_id,
        title:
          doc.document_name ||
          doc.file_name ||
          doc.title ||
          `Source ${doc.document_id.slice(0, 4)}`,
        documentName: doc.document_name,
        fileName: doc.file_name,
        type: doc.url?.split(".").pop().toUpperCase() || "LINK",
        size: 0,
        url: doc.url,
        score: doc.score,
        categoryLabel: doc.categoryLabel,
        serviceLabels: doc.serviceLabels,
      }));
      const existingIds = new Set(this.relatedDocuments.map((d) => d.id));
      const uniqueNewDocs = newDocs.filter((d) => !existingIds.has(d.id));
      this.relatedDocuments.unshift(...uniqueNewDocs);
    },

    async sendMessage() {
      const content = this.newMessage.trim();
      if (!content) return;
      // Audit F9: double-submit guard — one in-flight query at a time (the
      // enter key fires this on every keypress-combo otherwise).
      if (this.isLoading) return;

      this.chatMessages.push({
        sender: "user",
        content,
        timestamp: new Date().toISOString(),
        isSaved: false,
      });
      this.newMessage = "";
      this.showQuickHelp = false;
      this.isLoading = true;
      // Do NOT clear relatedDocuments here. We want to keep previous docs visible.

      const startTime = performance.now(); // Start timing

      try {
        const categoryLabel = this.getCategoryLabelById(this.currentCategoryId);
        console.log(
          `[ChatBotComponent] Resolved Category ID "${this.currentCategoryId}" to Label "${categoryLabel}"`
        );

        // Resolve weather location from the user's weather widget selection
        const weatherLocation = this.getWeatherLocation();

        // K.7 (10-06): the conversation payload is ALWAYS sent. The old
        // tree-selection gate sent `text` alone for plain chats, so chatqna
        // treated every message as a brand-new conversation. Empty
        // serviceLabels are legal (DEC-27: no-labels = no retrieval filter).
        // G.2a (FR13): the locale rides context.language (upper-cased —
        // chatqna compares exact "EN"/"ST").
        const serviceLabels = this.selectedContextItems.map(
          (item) => item.service
        );
        // Real turns only: UI-only bubbles (welcome greeting, error bubbles,
        // truncated/untranslated notices) must never reach the model — they
        // poison the CHAT HISTORY prompt leg and the retrieval blend. The
        // string guard also drops restored entries with undefined content
        // (chatqna's history translation would choke on them).
        const wireMessages = this.chatMessages
          .filter(
            (m) =>
              m &&
              !m.isUiOnly &&
              typeof m.content === "string" &&
              m.content.trim()
          )
          .slice(-HISTORY_MESSAGE_CAP);
        // Open on a user turn: chatqna's _extract_history_text pairs turns
        // from the front, so a leading assistant turn misaligns the split.
        while (wireMessages.length && wireMessages[0].sender !== "user") {
          wireMessages.shift();
        }
        const queryData = {
          // conversationId is not yet consumed server-side; kept on the wire
          // by design for conversation-linked analytics (K.7 spec).
          conversationId: this.conversationId,
          userId: this.$store.getters.currentUser?.iss_sub || "anonymous",
          sessionId: this.currentSessionId || "new-session",
          messages: wireMessages.map((msg) => ({
            role: msg.sender === "user" ? "user" : "assistant",
            content: msg.content,
          })),
          context: {
            categoryLabel: categoryLabel,
            serviceLabels: serviceLabels,
            language: this.currentLocale.toUpperCase(),
            weatherLocation: weatherLocation,
          },
          contextOption: "conversation-with-context-labels",
          timestamp: new Date().toISOString(),
        };
        // Streaming first; falls back silently to the classic path below
        if (this.useStreaming) {
          const streamed = await this.tryStreamQuery(queryData, startTime);
          if (streamed) {
            this.isLoading = false;
            return;
          }
        }

        const result = await chatbotService.submitQuery(queryData);

        // --- Success State Update ---
        const endTime = performance.now();
        this.systemStatus.lastResponseTime = Math.round(endTime - startTime);
        this.systemStatus.online = true;
        this.systemStatus.errorMessage = "";
        this.systemStatus.lastUpdated = new Date();
        // --------------------------

        console.log("Query result:", result);
        const botMessage = {
          sender: "bot",
          content: result.response || this.translate("chatbot.processingError"),
          queryId: result.queryId,
          timestamp: new Date().toISOString(),
          isSaved: false,
          // CRITICAL FIX: Attach the full metadata object so it can be saved later
          metadata: result.metadata || {} 
        };
        
        if (result.metadata) {
          if (result.metadata.confidence_score) {
            botMessage.confidenceScore = result.metadata.confidence_score;
          }
          this.applySourceDocuments(result.metadata);
        }
        this.chatMessages.push(botMessage);
        if (result.sessionId) {
          this.currentSessionId = result.sessionId;
        }
      } catch (error) {
        // --- Error State Update ---
        this.systemStatus.lastResponseTime = null; // No successful response time
        this.systemStatus.online = false;
        this.systemStatus.errorMessage =
          error.message || this.translate("chatbot.processingError");
        this.systemStatus.lastUpdated = new Date();
        // ------------------------

        console.error("Error sending query:", error);
        const reason = error.message || this.translate("chatbot.processingError");
        this.chatMessages.push({
          sender: "bot",
          content: reason,
          timestamp: new Date().toISOString(),
          isSaved: false,
          isUiOnly: true, // K.7: error bubbles never ship as model history
        });
        notificationService.error(reason);
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
        message: this.chatMessages[index],
      };
    },

    closeFeedbackDialog() {
      this.feedbackDialog.visible = false;
    },

    async handleFeedbackSubmit(feedback) {
      const queryId = feedback.message.queryId;
      if (!queryId) {
        console.error("Cannot submit feedback: No queryId found for message");
        notificationService.error(
          this.translate("chatbot.feedbackMissingQueryId")
        );
        this.closeFeedbackDialog();
        return;
      }
      try {
        await chatbotService.submitFeedback(queryId, {
          rating: feedback.rating || (feedback.thumbFeedback === "up" ? 4 : 2),
          comment: feedback.text || "",
          providedAt: new Date().toISOString(),
        });
        console.log("Feedback submitted successfully for queryId:", queryId);
        notificationService.success(
          this.translate("chatbot.feedbackSubmitted")
        );
      } catch (error) {
        console.error("Error submitting feedback for queryId:", queryId, error);
        notificationService.error(this.translate("chatbot.feedbackError"));
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
        const conversation = await this.chatHistoryService.getConversation(
          conversationId
        );
        
        if (!conversation) {
          throw new Error("Conversation not found");
        }

        // DEBUG: Log the full response from backend
        console.log("[DEBUG] Conversation loaded successfully:", conversation);
        console.log("[DEBUG] conversation.files raw data:", conversation.files);

        this.conversationId = conversation._key;
        this.currentChatId = conversation._key;
        this.currentChatTitle = conversation.title || this.generateChatTitle();
        this.currentCategoryId = conversation.categoryId || null;
        
        // NEW: Populate related documents from history (files property from backend)
        if (conversation.files && Array.isArray(conversation.files)) {
          console.log(`[DEBUG] Found ${conversation.files.length} files. Mapping to relatedDocuments...`);
          
          this.relatedDocuments = conversation.files.map(file => {
             // Debug individual file mapping
             const mapped = {
                id: file.id,
                title: file.documentName || file.fileName || `Source ${file.id}`,
                documentName: file.documentName,
                fileName: file.fileName,
                type: file.url?.split(".").pop().toUpperCase() || "LINK",
                size: 0,
                url: file.url,
                score: file.score,
                categoryLabel: file.categoryLabel,
                serviceLabels: file.labels || []
             };
             return mapped;
          });
          
          console.log("[DEBUG] Final mapped relatedDocuments:", this.relatedDocuments);
        } else {
          console.warn("[DEBUG] No 'files' array found in conversation response or it is empty.");
          this.relatedDocuments = [];
        }

        this.chatMessages = [];
        const messages = conversation.messages || [];
        messages.forEach((msg) => {
          this.chatMessages.push({
            sender: msg.sender === "user" ? "user" : "bot",
            content: msg.content,
            timestamp: msg.timestamp || new Date().toISOString(),
            queryId: msg.queryId || null,
            isSaved: true,
          });
        });

        if (this.chatMessages.length === 0) {
          this.chatMessages.push({
            sender: "bot",
            content: this.translate("chatbot.welcomeMessage"),
            timestamp: new Date().toISOString(),
            queryId: null,
            isSaved: true,
            isUiOnly: true, // K.7: greeting never ships as model history
          });
        }

        this.selectedContextItems = [];
        if (conversation.tags && Array.isArray(conversation.tags)) {
          console.log(`Conversation tags:`, conversation.tags);
          conversation.tags.forEach((tag) => {
            this.selectedContextItems.push({
              service: this.safeTranslate(
                tag || `category.${this.currentCategoryId || "general"}`
              ),
              serviceKey:
                tag || `category.${this.currentCategoryId || "general"}`,
              category: this.currentCategoryId || "general",
              selected: true,
            });
          });
        } else if (this.currentCategoryId) {
          this.selectedContextItems.push({
            service: this.getCategoryLabelById(this.currentCategoryId),
            serviceKey: `category.${this.currentCategoryId}`,
            category: this.currentCategoryId,
            selected: true,
          });
          console.log(
            `No tags, using fallback category ID: ${this.currentCategoryId}`
          );
        }

        // DEC-27: pre-fix button chats were saved with quickhelp.* tags
        // and/or stock quick-help category IDs (248445-248452) — restoring
        // them would re-fabricate display-string label filters that zero
        // retrieval. Scrub by serviceKey (every restored item is stamped
        // with the legacy categoryId, so category alone over-matches and
        // would drop legit tree tags from the same chat); tree-sourced
        // service keys never collide with these shapes.
        // DEC-28: the stock IDs are a CLOSED historical list from the
        // pre-admin-era config — hardcoded so the scrub never depends on
        // live button data (which no longer carries categories).
        const stockQuickhelpCats = new Set([
          "248445", "248446", "248447", "248448",
          "248449", "248450", "248451", "248452",
        ]);
        this.selectedContextItems = this.selectedContextItems.filter(
          (item) => {
            const key = item.serviceKey || "";
            return (
              !key.startsWith("quickhelp.") &&
              !(
                key.startsWith("category.") &&
                stockQuickhelpCats.has(key.slice("category.".length))
              )
            );
          }
        );
        if (stockQuickhelpCats.has(this.currentCategoryId)) {
          this.currentCategoryId = null;
        }

        this.lastSavedState = {
          messages: JSON.parse(JSON.stringify(this.chatMessages)),
          contextItems: JSON.parse(JSON.stringify(this.selectedContextItems)),
        };

        this.newMessage = "";
        this.showQuickHelp = false;
        this.scrollToBottom();

        this.updateChatInHistory();

        notificationService.success(
          this.translate("chatbot.conversationLoaded")
        );
      } catch (error) {
        console.error("Error loading conversation:", error);
        notificationService.error(this.translate("chatbot.loadError"));
      }
    },

    hasUnsavedChanges() {
      if (!this.conversationId && !this.currentChatId) {
        const hasUserMessages = this.chatMessages.some(
          (msg) => msg.sender === "user"
        );
        const hasContextItems = this.selectedContextItems.length > 0;
        return hasUserMessages || hasContextItems;
      }

      const hasNewMessages = this.chatMessages.some(
        (msg) =>
          !msg.isSaved &&
          (msg.sender === "user" || (msg.sender === "bot" && msg.queryId))
      );
      if (hasNewMessages) {
        return true;
      }

      if (
        this.selectedContextItems.length !==
        this.lastSavedState.contextItems.length
      ) {
        return true;
      }
      for (let i = 0; i < this.selectedContextItems.length; i++) {
        if (
          this.selectedContextItems[i].service !==
            this.lastSavedState.contextItems[i]?.service ||
          this.selectedContextItems[i].category !==
            this.lastSavedState.contextItems[i]?.category
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
          folderId: "default",
        };
        await new Promise((resolve) => {
          const unwatch = this.$watch("saveChatDialog.visible", (newVal) => {
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
          folderId: "default",
        };
      }
    },

    getContextTags() {
      return this.selectedContextItems
        .map((item) => item.serviceKey || item.service)
        .filter((tag) => tag);
    },

    async handleSaveChat() {
      console.log("handleSaveChat called");
      try {
        console.log("Saving chat with data:", {
          title: this.saveChatDialog.title,
          folderId: this.saveChatDialog.folderId,
          messages: this.chatMessages,
        });

        const currentUser = this.$store.getters.currentUser;
        // M.13: Keycloak store user is claims-only (no Arango _key — the
        // legacy-auth shape this guard demanded, so EVERY save threw
        // "User not authenticated" before any request). Backend derives
        // identity server-side (extractUserId); the payload userId is
        // decorative — iss_sub is the honest client-side identifier.
        if (!currentUser) {
          throw new Error("User not authenticated");
        }

        const firstUserMessage =
          this.chatMessages.find((msg) => msg.sender === "user")?.content || "";

        const conversationData = {
          userId: currentUser.iss_sub || null,
          title: this.saveChatDialog.title || this.generateChatTitle(),
          initialMessage: firstUserMessage,
          categoryId: this.currentCategoryId || null,
          tags: this.getContextTags(),
        };

        if (this.conversationId) {
          throw new Error(
            "handleSaveChat should not be called for existing conversations"
          );
        }

        console.log(
          "chatHistoryService.createConversation called with:",
          conversationData
        );
        const conversation = await this.chatHistoryService.createConversation(
          conversationData
        );
        console.log("Conversation created:", conversation);
        this.conversationId = conversation._key;

        for (const message of this.chatMessages) {
          if (
            (message.sender === "bot" && !message.queryId) ||
            (message.sender === "user" &&
              message.content === firstUserMessage &&
              !message.isSaved)
          ) {
            console.log(`Skipping message: ${message.content}`);
            message.isSaved = true;
            continue;
          }

          if (
            message.sender === "user" ||
            (message.sender === "bot" && message.queryId)
          ) {
            const messageData = {
              conversationId: conversation._key,
              content: message.content,
              sender: message.sender === "user" ? "user" : "assistant",
              queryId: message.queryId || null,
              metadata: message.metadata || {},
              userId: currentUser.iss_sub || null,
            };
            console.log("Adding message with data:", messageData);
            console.log(
              "chatHistoryService.addMessage called with:",
              messageData
            );
            await this.chatHistoryService.addMessage(messageData);
            message.isSaved = true;
          }
        }

        const chatData = {
          id: conversation._key,
          title: conversationData.title,
          preview: this.chatPreview,
          folderId: this.saveChatDialog.folderId || "default",
          messageCount: this.chatMessages.filter(
            (msg) =>
              msg.sender === "user" || (msg.sender === "bot" && msg.queryId)
          ).length,
        };
        console.log("Dispatching createChat with:", chatData);
        await this.$store.dispatch("chatHistory/createChat", chatData);
        console.log(
          "Vuex chats state after createChat:",
          this.$store.state.chatHistory.chats
        );

        if (
          this.saveChatDialog.folderId &&
          this.saveChatDialog.folderId !== "default"
        ) {
          console.log(
            "chatHistoryService.addConversationToFolder called with:",
            {
              folderId: this.saveChatDialog.folderId,
              conversationId: conversation._key,
              userId: currentUser.iss_sub || null,
            }
          );
          await this.chatHistoryService.addConversationToFolder(
            this.saveChatDialog.folderId,
            conversation._key,
            currentUser.iss_sub
          );
          console.log(
            `Conversation ${conversation._key} added to folder ${this.saveChatDialog.folderId}`
          );
          console.log("Dispatching addChatToFolder with:", {
            chatId: conversation._key,
            folderId: this.saveChatDialog.folderId,
          });
          await this.$store.dispatch("chatHistory/addChatToFolder", {
            chatId: conversation._key,
            folderId: this.saveChatDialog.folderId,
          });
          console.log(
            "Vuex folderChats state after addChatToFolder:",
            this.$store.state.chatHistory.folderChats[
              this.saveChatDialog.folderId
            ]
          );
        }

        this.currentChatId = conversation._key;
        this.currentChatTitle = conversationData.title;
        this.lastSavedState.messages = [...this.chatMessages];
        this.lastSavedState.contextItems = [...this.selectedContextItems];
        this.updateChatInHistory();

        notificationService.success(this.translate("chatbot.chatSaved"));
        this.saveChatDialog.visible = false;

        console.log(
          `Emitting conversation-saved event for conversation ${conversation._key}`
        );
        eventBus.$emit("conversation-saved", conversation._key);
      } catch (error) {
        console.error("Error saving chat:", error);
        notificationService.error("Failed to save chat. Please try again.");
        throw error;
      }
    },

    async updateExistingChat() {
      console.log("updateExistingChat called");
      try {
        const currentUser = this.$store.getters.currentUser;
        // M.13: Keycloak store user is claims-only (no Arango _key — the
        // legacy-auth shape this guard demanded, so EVERY save threw
        // "User not authenticated" before any request). Backend derives
        // identity server-side (extractUserId); the payload userId is
        // decorative — iss_sub is the honest client-side identifier.
        if (!currentUser) {
          throw new Error("User not authenticated");
        }

        if (!this.conversationId) {
          throw new Error(
            "Conversation ID is required for updating an existing chat"
          );
        }

        const updateData = {
          userId: currentUser.iss_sub || null,
          title: this.currentChatTitle || this.generateChatTitle(),
          categoryId: this.currentCategoryId || null,
          tags: this.getContextTags(),
          isStarred: false,
          isArchived: false,
        };
        console.log("chatHistoryService.updateConversation called with:", {
          conversationId: this.conversationId,
          updateData,
        });
        const conversation = await this.chatHistoryService.updateConversation(
          this.conversationId,
          updateData
        );
        console.log("Conversation updated:", conversation);

        for (const message of this.chatMessages) {
          if (message.isSaved) {
            console.log(`Skipping already saved message: ${message.content}`);
            continue;
          }
          if (
            message.sender === "user" ||
            (message.sender === "bot" && message.queryId)
          ) {
            const messageData = {
              conversationId: this.conversationId,
              content: message.content,
              sender: message.sender === "user" ? "user" : "assistant",
              queryId: message.queryId || null,
              metadata: message.metadata || {},
              userId: currentUser.iss_sub || null,
            };
            console.log("Adding message with data:", messageData);
            console.log(
              "chatHistoryService.addMessage called with:",
              messageData
            );
            await this.chatHistoryService.addMessage(messageData);
            message.isSaved = true;
          }
        }

        this.currentChatId = this.conversationId;
        this.lastSavedState.messages = [...this.chatMessages];
        this.lastSavedState.contextItems = [...this.selectedContextItems];
        this.updateChatInHistory();

        notificationService.success(this.translate("chatbot.chatUpdated"));
      } catch (error) {
        console.error("Error updating chat:", error);
        notificationService.error("Failed to update chat. Please try again.");
        throw error;
      }
    },

    updateChatInHistory() {
      if (this.currentChatId) {
        this.updateChat({
          chatId: this.currentChatId,
          preview: this.chatPreview,
          fullChatData: JSON.stringify(this.chatMessages),
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
              sender: "bot",
              content: this.translate("chatbot.welcomeMessage"),
              isUiOnly: true, // K.7: greeting never ships as model history
            },
          ];
        }
        this.currentChatId = chatId;
        this.showQuickHelp = false;
        this.scrollToBottom();
      } catch (error) {
        console.error("Error loading chat:", error);
        notificationService.error(this.translate("chatbot.loadError"));
      }
    },

    generateChatTitle() {
      const userMessage = this.chatMessages.find(
        (msg) => msg.sender === "user"
      );
      if (userMessage) {
        return userMessage.content.length > 20
          ? userMessage.content.substring(0, 17) + "..."
          : userMessage.content;
      }
      const now = new Date();
      return `Chat - ${now.toLocaleDateString()}`;
    },

    startNewChat() {
      if (this.hasUnsavedChanges()) {
        this.showNewChatConfirm = true;
        this.newChatDialog = {
          title: this.translate("chatbot.newChatTitle"),
          message: this.translate("chatbot.unsavedChanges"),
          confirmText: this.translate("chatbot.saveAndStartNew"),
          cancelText: this.translate("chatbot.discardAndStartNew"),
          secondaryText: this.translate("common.cancel"),
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
            folderId: "default",
          };
          await new Promise((resolve) => {
            const unwatch = this.$watch("saveChatDialog.visible", (newVal) => {
              if (!newVal) {
                unwatch();
                resolve();
              }
            });
          });
        }
        this.startNewChatConfirmed();
      } catch (error) {
        console.error("Error saving before starting new chat:", error);
        notificationService.error("Failed to save changes. Please try again.");
      }
    },

    startNewChatConfirmed() {
      this.showNewChatConfirm = false;
      this.chatMessages = [];
      this.currentChatId = null;
      this.conversationId = null;
      this.selectedContextItems = [];
      this.newMessage = "";
      this.currentCategoryId = null;
      this.currentChatTitle = "";
      this.showQuickHelp = true;
      this.relatedDocuments = [];
      this.lastSavedState = {
        messages: [],
        contextItems: [],
      };
      this.scrollToBottom();
      notificationService.info(this.translate("chatbot.newChatStarted"), 1500);
    },

    cancelNewChat() {
      this.showNewChatConfirm = false;
    },

    handleGoHome() {
      // Reset chat to initial state showing the Quick Help overlay
      this.startNewChatConfirmed();
    },

    openExportDialog() {
      this.exportDialog = {
        visible: true,
        filename: this.generateChatTitle(),
      };
    },

    _processInlineTokens(tokens) {
      const parts = [];
      if (!tokens) {
        return parts;
      }

      tokens.forEach((token) => {
        switch (token.type) {
          case "strong":
            const boldParts = this._processInlineTokens(token.tokens);
            boldParts.forEach((p) => (p.style = "bold"));
            parts.push(...boldParts);
            break;
          case "em":
            const italicParts = this._processInlineTokens(token.tokens);
            italicParts.forEach((p) => (p.style = "italic"));
            parts.push(...italicParts);
            break;
          case "codespan":
            parts.push({ text: token.text, style: "code" });
            break;
          case "link":
            const linkParts = this._processInlineTokens(token.tokens);
            linkParts.forEach((p) => (p.style = "link"));
            parts.push(...linkParts);
            break;
          case "text":
            parts.push({ text: token.text, style: "normal" });
            break;
          default:
            if (token.text) {
              parts.push({ text: token.text, style: "normal" });
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
            case "space":
              result.push({ type: "space" });
              break;
            case "hr":
              result.push({ type: "hr" });
              break;
            case "heading":
              const headingParts = this._processInlineTokens(token.tokens);
              headingParts.forEach((p) => (p.style = `h${token.depth}`));
              result.push({ type: "line", indent: 0, content: headingParts });
              break;
            case "paragraph":
              result.push({
                type: "line",
                indent: 0,
                content: this._processInlineTokens(token.tokens),
              });
              break;
            case "list":
              listOrdered = token.ordered;
              listCounter = token.start ? token.start - 1 : 0;
              token.items.forEach((item) => {
                listCounter++;
                const prefix = listOrdered ? `${listCounter}. ` : "- ";
                const itemContent = this._processInlineTokens(
                  item.tokens[0].tokens
                );
                itemContent.unshift({ text: prefix, style: "normal" });
                result.push({ type: "line", indent: 15, content: itemContent });
              });
              break;
            case "code":
              const codeLines = token.text.split("\n");
              codeLines.forEach((line) => {
                result.push({
                  type: "line",
                  indent: 10,
                  content: [{ text: line, style: "code" }],
                });
              });
              break;
            case "blockquote":
              const quoteContent = token.tokens.map((tok) =>
                this._processInlineTokens(tok.tokens)
              );
              quoteContent.forEach((lineContent) => {
                result.push({
                  type: "line",
                  indent: 20,
                  isQuote: true,
                  content: lineContent,
                });
              });
              break;
          }
        });

        return result;
      } catch (error) {
        console.error("Error parsing markdown for PDF:", error);
        return [
          {
            type: "line",
            indent: 0,
            content: [{ text: markdown, style: "normal" }],
          },
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
        doc.setFont("helvetica", "bold");
        doc.text(
          this.currentChatTitle || this.generateChatTitle(),
          leftMargin,
          yOffset
        );
        yOffset += 15;

        this.chatMessages.forEach((msg) => {
          checkPageBreak(20);
          yOffset += 5;

          doc.setFontSize(10);
          doc.setFont("helvetica", "bold");
          const sender = msg.sender === "user" ? "User" : "Bot";
          const timestamp = msg.timestamp
            ? new Date(msg.timestamp).toLocaleString()
            : new Date().toLocaleString();
          doc.text(`${sender} (${timestamp}):`, leftMargin, yOffset);
          yOffset += 6;

          const parsedContent =
            msg.sender === "bot" && msg.content
              ? this.parseMarkdownForPDF(msg.content)
              : [
                  {
                    type: "line",
                    content: [{ text: msg.content || "", style: "normal" }],
                    indent: 0,
                  },
                ];

          parsedContent.forEach((block) => {
            checkPageBreak();

            if (block.type === "space") {
              yOffset += 5;
              return;
            }
            if (block.type === "hr") {
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
              doc.rect(leftMargin, yOffset - 4, 3, 6, "F");
            }

            let linePartsQueue = [...block.content];

            while (linePartsQueue.length > 0) {
              const part = linePartsQueue.shift();
              const availableWidth = rightMargin - xOffset;

              doc.setFontSize(12);
              let fontStyle = "normal";
              if (part.style === "bold") fontStyle = "bold";
              if (part.style === "italic") fontStyle = "italic";
              doc.setFont("helvetica", fontStyle);

              if (part.style && part.style.startsWith("h")) {
                const level = parseInt(part.style.replace("h", "")) || 1;
                doc.setFontSize(12 + (6 - level) * 2);
                doc.setFont("helvetica", "bold");
              } else if (part.style === "code") {
                doc.setFont("courier", "normal");
                doc.setFontSize(10);
              }

              const splitText = doc.splitTextToSize(part.text, availableWidth);

              doc.text(splitText[0], xOffset, yOffset);
              xOffset +=
                (doc.getStringUnitWidth(splitText[0]) * doc.getFontSize()) /
                doc.internal.scaleFactor;

              if (splitText.length > 1) {
                const remainingText = splitText.slice(1).join(" ");
                linePartsQueue.unshift({
                  text: remainingText,
                  style: part.style,
                });

                yOffset += 6;
                checkPageBreak();
                xOffset = leftMargin + (block.indent || 0);
                if (block.isQuote) {
                  doc.setFillColor(230, 230, 230);
                  doc.rect(leftMargin, yOffset - 4, 3, 6, "F");
                }
              }
            }
            yOffset += 6;
          });
        });

        let filename = this.exportDialog.filename.trim();
        if (!filename.toLowerCase().endsWith(".pdf")) {
          filename += ".pdf";
        }
        filename = filename.replace(/[^a-zA-Z0-9\-_\.]/g, "_");

        doc.save(filename);
        notificationService.success(this.translate("chatbot.exportSuccess"));
        this.exportDialog.visible = false;
      } catch (error) {
        console.error("Error exporting chat to PDF:", error);
        notificationService.error(this.translate("chatbot.exportError"));
      }
    },

    updateDialogTexts() {
      this.newChatDialog = {
        title: this.translate("chatbot.newChatTitle"),
        message: this.translate("chatbot.unsavedChanges"),
        confirmText: this.translate("chatbot.saveAndStartNew"),
        cancelText: this.translate("chatbot.discardAndStartNew"),
        secondaryText: this.translate("common.cancel"),
      };
      this.loadConfirmDialog = {
        title: this.translate("chatbot.loadConfirmTitle"),
        message: this.translate("chatbot.loadConfirmMessage"),
        confirmText: this.translate("chatbot.loadAndDiscard"),
        cancelText: this.translate("common.cancel"),
        secondaryText: this.translate("chatbot.saveAndLoad"),
      };
    },
  },
};
</script>

<style scoped>
.app-container {
  display: flex;
  /* M.12 root cause: was 100vh — a NESTED element re-declaring viewport
     height. The keyboard shrinks the outer chain (#app → window-height
     / dvh) but this 100vh ignored it, so the input stayed buried. Fill
     the parent instead; the parent owns viewport sizing. */
  height: 100%;
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
  padding: 8px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.85rem;
  min-height: 45px; /* Added for consistency */
}

.status-left {
  display: flex;
  flex-direction: column; /* Stack status and error */
  align-items: flex-start;
  gap: 4px; /* Space between status and error */
  flex: 1; /* Allow error message to take space */
  overflow: hidden; /* Prevent long errors from breaking layout */
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

.status-metrics {
  display: flex;
  gap: 20px;
  padding-left: 16px; /* Add space between error and metric */
}

.metric {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.metric-label {
  font-size: 0.7rem;
  color: var(--text-tertiary, #64748b);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.metric-value {
  font-weight: 600;
  color: var(--text-primary, #334155);
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
  /* M.10: column — the meta row (feedback) sits BELOW the response,
     not beside it */
  flex-direction: column;
  align-items: flex-start;
}

.message-bubble {
  background: var(--bg-tertiary, #e5e5ea);
  color: var(--text-primary, #000);
  padding: 8px 12px;
  border-radius: 16px;
  max-width: 60%;
  line-height: 1.4;
  white-space: pre-wrap;
  word-wrap: break-word;
  box-shadow: var(--shadow-sm, 0 1px 2px rgba(0, 0, 0, 0.1));
}

.chat-message.user .message-bubble {
  background: var(--accent-color, #4e97d1);
  color: var(--text-button-primary, #fff);
}

/* M.3: bot markdown renders as normal-flow HTML — the bubble's pre-wrap
   (kept for user plain-text) was rendering marked's inter-block source
   newlines as phantom blank lines ON TOP of these margins. */
.message-bubble .bot-markdown {
  white-space: normal;
}

/* Markdown Styles within Message Bubble — M.3: compacted */
.message-bubble :deep(h1),
.message-bubble :deep(h2),
.message-bubble :deep(h3),
.message-bubble :deep(h4),
.message-bubble :deep(h5),
.message-bubble :deep(h6) {
  font-weight: 600;
  margin: 0.4em 0 0.3em;
  color: var(--text-primary, #000);
}

.message-bubble :deep(h1:first-child),
.message-bubble :deep(h2:first-child),
.message-bubble :deep(h3:first-child),
.message-bubble :deep(h4:first-child),
.message-bubble :deep(h5:first-child),
.message-bubble :deep(h6:first-child),
.message-bubble :deep(p:first-child),
.message-bubble :deep(ul:first-child),
.message-bubble :deep(ol:first-child) {
  margin-top: 0;
}

.message-bubble :deep(p:last-child),
.message-bubble :deep(ul:last-child),
.message-bubble :deep(ol:last-child),
.message-bubble :deep(h1:last-child),
.message-bubble :deep(h2:last-child),
.message-bubble :deep(h3:last-child),
.message-bubble :deep(h4:last-child),
.message-bubble :deep(h5:last-child),
.message-bubble :deep(h6:last-child) {
  margin-bottom: 0;
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
  margin: 0 0 0.4em;
  color: var(--text-primary, #000);
}

.message-bubble :deep(ul),
.message-bubble :deep(ol) {
  margin: 0.25em 0;
  padding-left: 1.5em;
}

.message-bubble :deep(li) {
  margin-bottom: 0.15em;
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
[data-theme="dark"] .message-bubble :deep(h1),
[data-theme="dark"] .message-bubble :deep(h2),
[data-theme="dark"] .message-bubble :deep(h3),
[data-theme="dark"] .message-bubble :deep(h4),
[data-theme="dark"] .message-bubble :deep(h5),
[data-theme="dark"] .message-bubble :deep(h6),
[data-theme="dark"] .message-bubble :deep(p),
[data-theme="dark"] .message-bubble :deep(li),
[data-theme="dark"] .message-bubble :deep(th),
[data-theme="dark"] .message-bubble :deep(td),
[data-theme="dark"] .message-bubble :deep(code),
[data-theme="dark"] .message-bubble :deep(pre) {
  color: var(--text-primary, #ffffff);
}

[data-theme="dark"] .message-bubble :deep(code),
[data-theme="dark"] .message-bubble :deep(pre),
[data-theme="dark"] .message-bubble :deep(th) {
  background: var(--bg-tertiary, #2d2d2d);
}

[data-theme="dark"] .message-bubble :deep(blockquote) {
  color: var(--text-secondary, #cccccc);
  border-left-color: var(--border-color, #555);
}

[data-theme="dark"] .message-bubble :deep(a) {
  color: var(--accent-color, #4e97d1);
}

[data-theme="dark"] .message-bubble :deep(a:hover) {
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
  background: rgba(
    255,
    255,
    255,
    0.8
  ); /* Semi-transparent background for visibility */
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
[data-theme="dark"] .loading-spinner,
html[data-theme="dark"] .loading-spinner {
  background: rgba(30, 30, 30, 0.8); /* Darker background for dark mode */
}

[data-theme="dark"] .loading-spinner i,
html[data-theme="dark"] .loading-spinner i {
  color: var(--accent-color, #4e97d1);
}

[data-theme="dark"] .loading-spinner .loading-text,
html[data-theme="dark"] .loading-spinner .loading-text {
  color: var(--text-primary, #ffffff);
}

.bot-message-meta {
  /* M.10: below the response (parent .chat-message.bot is column) */
  margin: 4px 4px 0;
  display: flex;
  flex-direction: row;
  gap: 12px;
  align-items: center;
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
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  padding: 44px 20px 20px; /* M.9 tweak: near the top but with air (16 was too tight) */
  overflow-x: hidden;
  overflow-y: auto;
  min-height: 0;
}

.quick-help-content {
  max-width: 800px;
  width: 100%;
  text-align: center;
  margin: auto 0;
}

.quick-help-heading {
  text-align: center;
  font-size: 1.6rem;
  font-weight: 600;
  margin-bottom: 24px;
  color: var(--text-primary, #333);
}

/* M.9: Google-style welcome mode — art → centered short pill → starters,
   with the leftover space BELOW (not the input pinned to screen bottom) */
.welcome-mode .quick-help-overlay {
  flex: 0 0 auto;
}

.welcome-mode .chat-input {
  padding-top: 4px;
}

.welcome-mode .chat-input .chat-input-pill {
  max-width: 640px;
  margin: 0 auto;
}

.quick-help-below {
  max-width: 760px;
  width: 100%;
  margin: 16px auto 0;
  padding: 0 12px;
}

.quick-help-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
  max-width: 100%;
}

.quick-help-item {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: var(--shadow-sm);
}

.quick-help-item:hover {
  background: var(--bg-tertiary);
  border-color: var(--border-color);
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}

.quick-help-item.just-chat {
  background: var(--bg-card);
  border-color: var(--accent-color);
}

.quick-help-item.just-chat:hover {
  background: var(--bg-tertiary);
  border-color: var(--accent-hover);
}

.quick-help-icon {
  margin-right: 12px;
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
  font-size: 0.95rem;
  color: var(--text-primary);
  font-weight: 500;
}

/* Chat Input Styles */
/* M.5: ChatGPT-style pill input — no outer box (Adem: the frame around
   the pill was bulky); the pill floats on the chat background */
.chat-input {
  background: transparent;
  border-top: none;
  padding: 8px 12px 12px;
}

.chat-input-pill {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  background: var(--bg-input, #f6f7f9);
  border: 1px solid var(--border-color, #ddd);
  border-radius: 22px;
  padding: 4px 4px 4px 8px; /* M.9 slim: was 6px — pill felt fat */
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.chat-input-pill:focus-within {
  border-color: var(--accent-color, #4e97d1);
  box-shadow: 0 1px 6px rgba(78, 151, 209, 0.18);
}

.pill-utilities {
  display: flex;
  gap: 2px;
  align-self: flex-end;
  padding-bottom: 3px;
}

.pill-icon-btn {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--text-secondary, #666);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.9rem;
  flex-shrink: 0;
}

.pill-icon-btn:hover {
  background: var(--bg-tertiary, #e8e8ec);
  color: var(--text-primary, #333);
}

.prompt-textarea {
  flex: 1;
  resize: none;
  border: none;
  outline: none;
  background: transparent;
  padding: 5px 2px;
  font-size: 1rem;
  font-family: inherit;
  line-height: 1.5;
  max-height: 144px; /* ~6 rows, auto-grow caps here */
  overflow-y: auto;
  color: var(--text-primary, #333);
}

.pill-send-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: var(--accent-color, #4e97d1);
  color: var(--text-button-primary, #fff);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background-color 0.15s ease, opacity 0.15s ease;
}

.pill-send-btn:hover:not(:disabled) {
  background: var(--accent-hover, #3a7da0);
}

.pill-send-btn:disabled {
  opacity: 0.45;
  cursor: default;
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
    gap: 8px;
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
    font-size: 1.4rem;
  }
}

/* Additional fixes for dark theme visibility */
[data-theme="dark"] .metric-label,
[data-theme="dark"] .status-metrics,
html[data-theme="dark"] .metric-label,
html[data-theme="dark"] .metric-value {
  color: rgba(255, 255, 255, 0.8) !important;
}

[data-theme="dark"] .quick-help-heading,
html[data-theme="dark"] .quick-help-heading {
  color: white !important;
}

[data-theme="dark"] .quick-help-overlay,
html[data-theme="dark"] .quick-help-overlay {
  background: var(--bg-primary, #1e1e1e) !important;
}

[data-theme="dark"] .confidence-score {
  color: var(--text-tertiary, #a0aec0);
  background: var(--bg-tertiary, #2d3748);
}

[data-theme="dark"] .feedback-trigger button {
  background: var(--bg-button-secondary, #2d3748);
  color: var(--text-button-secondary, #e2e8f0);
}

/* --- AgriConnect LSO (Keletso): landing / welcome screen.
       Greeting + subtitle styles live inside KeletsoHero's pill. --- */
.quick-help-heading {
  margin-bottom: 8px;
}

/* Quick-help items are real buttons: reset browser button styling */
.quick-help-item {
  width: 100%;
  font: inherit;
  color: inherit;
  text-align: left;
}

.quick-help-item:focus-visible {
  outline: 2px solid var(--accent-color, #4a8c5c);
  outline-offset: 2px;
}

@media (max-width: 480px) {
  /* Chat bubbles were capped at 60% width, which is cramped on phones */
  .message-bubble {
    max-width: 85%;
  }

  /* M.11: the ANSWER goes full phone width — easier to read (Adem) */
  .chat-message.bot .message-bubble {
    max-width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .quick-help-item {
    transition: none;
  }

  .quick-help-item:hover {
    transform: none;
  }
}
</style>