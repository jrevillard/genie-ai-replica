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

      <!-- System Status Panel -->
      <div class="system-status-panel">
        <div class="status-indicator" :class="{ online: systemStatus.online }">
          <div class="status-dot"></div>
          <span>{{
            systemStatus.online
              ? translate("status.online")
              : translate("status.offline")
          }}</span>
        </div>
        <div class="status-metrics">
          <div class="metric">
            <span class="metric-label">{{
              translate("status.responseTime")
            }}</span>
            <span class="metric-value"
              >{{ systemStatus.avgResponseTime }}ms</span
            >
          </div>
          <div class="metric">
            <span class="metric-label">{{
              translate("status.queueLength")
            }}</span>
            <span class="metric-value">{{ systemStatus.requestQueue }}</span>
          </div>
          <div class="metric">
            <span class="metric-label">{{ translate("status.uptime") }}</span>
            <span class="metric-value">{{
              formatUptime(systemStatus.uptime)
            }}</span>
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
      <div class="chat-window" ref="chatWindow">
        <div
          v-for="(msg, index) in chatMessages"
          :key="index"
          class="chat-message"
          :class="msg.sender"
        >
          <div class="message-bubble">
            <span>{{ msg.content }}</span>
          </div>
          <!-- Feedback for bot messages -->
          <div v-if="msg.sender === 'bot'" class="feedback-trigger">
            <button @click="openFeedbackDialog(index)">
              {{ translate("feedback.button") }}
            </button>
          </div>
        </div>
        <!-- Auto-scroll anchor element -->
        <div ref="messagesEnd"></div>
      </div>
      <!-- Quick Help Overlay -->
      <div
        class="quick-help-overlay"
        v-if="showQuickHelp && chatMessages.length <= 1"
      >
        <div class="quick-help-content">
          <h2 class="quick-help-heading">
            {{ translate("chatbot.whatCanIHelp") }}
          </h2>

          <div class="quick-help-grid">
            <div
              v-for="button in quickHelpButtons"
              :key="button.id"
              class="quick-help-item"
              :class="{ 'just-chat': !button.category }"
              @click="selectQuickHelpOption(button)"
            >
              <img
                class="quick-help-icon"
                :src="button.icon"
                alt="Quick Help Icon"
              />
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
          <button
            class="new-chat-btn"
            @click="startNewChat"
            :title="translate('chatbot.newChat')"
          >
            <i class="fas fa-plus"></i>
          </button>
          <button
            v-if="chatMessages.length > 0"
            class="save-chat-btn"
            @click="saveChatToHistory"
            :title="translate('chatbot.saveChat')"
          >
            <i class="fas fa-save"></i>
          </button>
          <button class="send-btn" @click="sendMessage">
            {{ translate("chatbot.sendButton") }}
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
    <right-side-bar-component
      :current-chat-id="currentChatId"
      :current-locale="currentLocale"
      :translations="translations"
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
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import chatHistoryService from "../services/chatHistoryService";
import analyticsService from "../services/analyticsService";

export default {
  name: "ChatBotComponent",
  components: {
    ChatResponseFeedbackDialog,
    ModalDialog,
    RightSideBarComponent,
    ConfirmDialog,
  },

  data() {
    return {
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
      currentChatId: null,
      currentChatTitle: "",
      currentLocale: "en",
      showQuickHelp: true,
      conversationCategory: null,
      chatHistoryService: chatHistoryService,
      systemStatus: {
        online: true,
        avgResponseTime: 283,
        requestQueue: 0,
        uptime: 3659,
        lastUpdated: new Date(),
      },
      quickHelpButtons: [],
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
          },
        ];
        this.newMessage = "";
        this.selectedContextItems = [];
        this.lastSavedState = {
          messages: JSON.parse(JSON.stringify(this.chatMessages)),
          contextItems: [],
        };
        console.log(
          `Reset conversationId after deletion of chat ${deletedChatId}`
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
        this.chatMessages = []; // Clear messages to avoid carryover
        this.selectedContextItems = [];
        this.lastSavedState = { messages: [], contextItems: [] }; // Reset state
        this.loadExistingConversation(conversationId);
      }
    });
  },

  computed: {
    ...mapGetters("chatHistory", ["getAllFolders", "getChatById"]),

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
    if (this.chatMessages.length === 0) {
      this.chatMessages.push({
        sender: "bot",
        content: this.translate("chatbot.welcomeMessage"),
      });
    }

    if (this.$root.$i18n) {
      this.currentLocale = this.$root.$i18n.locale;
      this.$watch("$root.$i18n.locale", (newLocale) => {
        this.currentLocale = newLocale;
      });
    }

    eventBus.$on("treeNodeSelected", this.handleTreeNodeSelected);
    eventBus.$on("open-chat", this.loadChatFromHistory);
    this.scrollToBottom();
    this.loadQuickHelpButtons();

    this.statusUpdateInterval = setInterval(() => {
      this.systemStatus.uptime += 30;
      this.systemStatus.avgResponseTime = Math.max(
        200,
        Math.floor(
          this.systemStatus.avgResponseTime + (Math.random() * 20 - 10)
        )
      );
      this.systemStatus.requestQueue = Math.max(
        0,
        Math.floor(Math.random() * 3)
      );
      this.systemStatus.lastUpdated = new Date();
    }, 30000);
    this.updateDialogTexts();
  },

  beforeUnmount() {
    eventBus.$off("treeNodeSelected", this.handleTreeNodeSelected);
    eventBus.$off("open-chat", this.loadChatFromHistory);
    eventBus.$off("chat-deleted"); // Clean up the chat-deleted listener
    if (this.statusUpdateInterval) {
      clearInterval(this.statusUpdateInterval);
    }
    eventBus.$off("load-conversation");
  },

  watch: {
    currentLocale: function () {
      this.updateDialogTexts();
    },
  },

  methods: {
    ...mapActions("chatHistory", ["createChat", "updateChat"]),

    async loadQuickHelpButtons() {
      console.log("[ChatBotComponent] Loading Quick Help buttons from config");
      try {
        const { loadConfig } = await import("../main.js");
        const config = await loadConfig();
        const buttons = config?.features?.chat?.quickHelp?.buttons || [];
        this.quickHelpButtons = buttons.map((button) => {
          if (this.$t(button.title) === button.title) {
            console.warn(
              `[ChatBotComponent] Missing i18n key: ${button.title}`
            );
          }
          return {
            service: this.$t(button.title),
            textKey: button.title,
            promptKey: button.prompt,
            icon: button.icon.value,
            category: button.category,
            id: button.id,
          };
        });
        console.log(
          `[ChatBotComponent] Loaded ${buttons.length} Quick Help buttons:`,
          buttons.map((b) => ({
            id: b.id,
            title: b.title,
            category: b.category,
          }))
        );
      } catch (error) {
        console.error(
          "[ChatBotComponent] Failed to load Quick Help config:",
          error
        );
        this.quickHelpButtons = [];
      }
    },

    getCurrentTheme() {
      const documentTheme = document.documentElement.getAttribute("data-theme");
      const bodyTheme = document.body.getAttribute("data-theme");
      return documentTheme || bodyTheme || "light";
    },

    formatUptime(seconds) {
      const days = Math.floor(seconds / 86400);
      const hours = Math.floor((seconds % 86400) / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      if (days > 0) {
        return `${days}d ${hours}h`;
      } else if (hours > 0) {
        return `${hours}h ${minutes}m`;
      } else {
        return `${minutes}m`;
      }
    },

    handleSidebarToggle(collapsed) {
      console.log("Sidebar collapsed state:", collapsed);
    },

    handleOpenDocument(doc) {
      console.log("Document opened:", doc);
    },

    translate(key) {
      return this.$t(key);
    },

    selectQuickHelpOption(option) {
      console.log(
        `[ChatBotComponent] Quick Help button clicked: id=${option.id}, textKey=${option.textKey}`
      );
      const rawOption =
        option && option.__v_isReactive ? { ...option } : option || {};
      if (!rawOption.service) {
        console.error("Invalid quick help option, missing service:", rawOption);
        return;
      }
      const category =
        rawOption.category ||
        (rawOption.service !== this.$t("quickhelp.justChat")
          ? "general"
          : null);
      this.selectedContextItems = [
        {
          service: rawOption.service,
          category: category,
          selected: true,
        },
      ];
      if (rawOption.service !== this.$t("quickhelp.justChat")) {
        this.conversationCategory = category;
        console.log(
          `Set conversation category to ${category} for quick help option ${rawOption.service}, overriding any sidebar context`
        );
      } else {
        this.conversationCategory = this.conversationCategory || null;
        console.log(
          "Just Chat selected, retaining sidebar category:",
          this.conversationCategory
        );
      }
      this.showQuickHelp = false;
      if (rawOption.promptKey) {
        const message = this.$t(rawOption.promptKey);
        this.newMessage = message;
        this.sendMessage();
      }
    },

    handleTextareaFocus() {
      this.showQuickHelp = false;
    },

    handleTreeNodeSelected(item) {
      if (!item || typeof item !== "object") return;
      if (item.selected) {
        const exists = this.selectedContextItems.some(
          (existing) =>
            existing.category === item.category &&
            existing.service === item.service
        );
        if (!exists) {
          this.selectedContextItems.push(item);
          notificationService.info(
            this.translate("chatbot.contextAdded"),
            1500
          );
          if (
            !this.conversationCategory ||
            this.conversationCategory === "general"
          ) {
            this.conversationCategory = item.category || "general";
            console.log(
              `Set conversation category to ${this.conversationCategory} from sidebar tree node ${item.service}`
            );
          }
        }
      } else {
        this.selectedContextItems = this.selectedContextItems.filter(
          (existing) =>
            !(
              existing.category === item.category &&
              existing.service === item.service
            )
        );
        eventBus.$emit("contextItemRemoved", item);
        notificationService.info(
          this.translate("chatbot.contextRemoved"),
          1500
        );
        if (this.selectedContextItems.length === 0 && !this.newMessage) {
          this.conversationCategory = null;
          console.log(
            "Cleared conversation category after removing sidebar context"
          );
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
      if (this.selectedContextItems.length === 0 && this.conversationCategory) {
        const quickHelpOption = this.quickHelpButtons.find(
          (option) => option.category === this.conversationCategory
        );
        if (quickHelpOption) {
          this.selectedContextItems = [
            {
              service: quickHelpOption.service,
              category: this.conversationCategory,
              selected: true,
            },
          ];
          console.log(
            `Restored context item for category ${this.conversationCategory}: ${quickHelpOption.service}`
          );
        } else {
          this.selectedContextItems = [
            {
              service: `Category ${this.conversationCategory}`,
              category: this.conversationCategory,
              selected: true,
            },
          ];
          console.log(
            `Restored sidebar context item for category ${this.conversationCategory}`
          );
        }
      }
    },

    async sendMessage() {
      const content = this.newMessage.trim();
      if (!content) return;
      this.chatMessages.push({
        sender: "user",
        content,
        timestamp: new Date().toISOString(),
        isSaved: false,
      });
      this.newMessage = "";
      const contextInfo =
        this.selectedContextItems.length > 0
          ? this.selectedContextItems.map((item) => item.service).join(", ")
          : null;
      this.showQuickHelp = false;
      try {
        const queryData = {
          userId: this.$store.getters.currentUser?._key || "anonymous",
          sessionId: this.currentSessionId || "new-session",
          text: content,
          categoryId:
            this.conversationCategory ||
            (contextInfo ? this.selectedContextItems[0].category : "general"),
          serviceId: contextInfo ? this.selectedContextItems[0].service : null,
          isAnswered: false,
        };
        console.log("Query data sent:", queryData);
        console.log("Before queryData:", {
          conversationCategory: this.conversationCategory,
          selectedContextItems: this.selectedContextItems,
        });
        const result = await chatbotService.submitQuery(queryData);
        const botMessage = {
          sender: "bot",
          content:
            result.response ||
            `${this.translate("chatbot.responsePrefix")}: "${content}"${
              contextInfo
                ? ` ${this.translate("chatbot.withContext")}: ${contextInfo}`
                : ""
            }`,
          queryId: result._key,
          timestamp: new Date().toISOString(),
          isSaved: false,
        };
        this.chatMessages.push(botMessage);
        console.log("Query result:", result);

        if (result.sessionId) {
          this.currentSessionId = result.sessionId;
          notificationService.info(
            this.translate("chatbot.sessionUpdated"),
            1500
          );
        }
        console.log("About to mark query as answered:", result._key);
        await chatbotService.markQueryAsAnswered(
          result._key,
          result.responseTime
        );
        console.log("Query marked as answered successfully");
      } catch (error) {
        console.error("Error sending query:", error);
        this.chatMessages.push({
          sender: "bot",
          content: this.translate("chatbot.processingError"),
          timestamp: new Date().toISOString(),
          isSaved: false,
        });
        notificationService.error(this.translate("chatbot.processingError"));
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
        console.log(`Loading conversation ${conversationId}`);
        const conversation = await this.chatHistoryService.getConversation(
          conversationId
        );
        if (!conversation) {
          throw new Error("Conversation not found");
        }

        this.conversationId = conversation._key;
        this.currentChatId = conversation._key;
        this.currentChatTitle = conversation.title || this.generateChatTitle();
        this.conversationCategory = conversation.categoryId || null;

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
          });
        }

        this.selectedContextItems = [];
        if (conversation.tags && Array.isArray(conversation.tags)) {
          conversation.tags.forEach((tag) => {
            this.selectedContextItems.push({
              service: tag,
              category: this.conversationCategory || "general",
              selected: true,
            });
          });
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
        .map((item) => item.service)
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
        if (!currentUser || !currentUser._key) {
          throw new Error("User not authenticated");
        }

        const firstUserMessage =
          this.chatMessages.find((msg) => msg.sender === "user")?.content || "";

        const conversationData = {
          userId: currentUser._key,
          title: this.saveChatDialog.title || this.generateChatTitle(),
          initialMessage: firstUserMessage,
          categoryId: this.conversationCategory || null,
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
              userId: currentUser._key,
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

        if (
          this.saveChatDialog.folderId &&
          this.saveChatDialog.folderId !== "default"
        ) {
          console.log(
            "chatHistoryService.addConversationToFolder called with:",
            {
              folderId: this.saveChatDialog.folderId,
              conversationId: conversation._key,
              userId: currentUser._key,
            }
          );
          await this.chatHistoryService.addConversationToFolder(
            this.saveChatDialog.folderId,
            conversation._key,
            currentUser._key
          );
          console.log(
            `Conversation ${conversation._key} added to folder ${this.saveChatDialog.folderId}`
          );
        }

        this.currentChatId = conversation._key;
        this.currentChatTitle = conversationData.title;
        this.lastSavedState.messages = [...this.chatMessages];
        this.lastSavedState.contextItems = [...this.selectedContextItems];
        this.updateChatInHistory();

        notificationService.success(this.translate("chatbot.chatSaved"));
        this.saveChatDialog.visible = false;
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
        if (!currentUser || !currentUser._key) {
          throw new Error("User not authenticated");
        }

        if (!this.conversationId) {
          throw new Error(
            "Conversation ID is required for updating an existing chat"
          );
        }

        const updateData = {
          userId: currentUser._key,
          title: this.currentChatTitle || this.generateChatTitle(),
          categoryId: this.conversationCategory || null,
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
              userId: currentUser._key,
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
      this.chatMessages = [
        {
          sender: "bot",
          content: this.translate("chatbot.welcomeMessage"),
          timestamp: new Date().toISOString(),
          isSaved: true,
        },
      ];
      this.currentChatId = null;
      this.conversationId = null;
      this.selectedContextItems = [];
      this.newMessage = "";
      this.conversationCategory = null;
      this.currentChatTitle = "";
      this.showQuickHelp = true;
      this.lastSavedState = {
        messages: JSON.parse(JSON.stringify(this.chatMessages)),
        contextItems: [],
      };
      this.scrollToBottom();
      notificationService.info(this.translate("chatbot.newChatStarted"), 1500);
    },

    cancelNewChat() {
      this.showNewChatConfirm = false;
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
  padding: 8px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.85rem;
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

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background-color: var(--text-muted, #cbd5e1);
}

.status-indicator.online .status-dot {
  background-color: var(--status-operational, #10b981);
}

.status-metrics {
  display: flex;
  gap: 20px;
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

.feedback-trigger {
  margin-left: 8px;
  align-self: center;
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

.new-chat-btn {
  background: var(--bg-button-secondary, #f0f0f0);
  color: var(--text-button-secondary, #555);
  border: none;
  padding: 8px 12px;
  border-radius: 4px;
  cursor: pointer;
  margin-right: auto;
}

.new-chat-btn:hover {
  background: var(--bg-tertiary, #e0e0e0);
  color: var(--accent-color, #4e97d1);
}

.save-chat-btn {
  background: var(--bg-button-secondary, #f0f0f0);
  color: var(--text-button-secondary, #555);
  border: none;
  padding: 8px 12px;
  border-radius: 4px;
  cursor: pointer;
}

.save-chat-btn:hover {
  background: var(--bg-tertiary, #e0e0e0);
}

.send-btn {
  background: var(--accent-color, #4e97d1);
  color: var(--text-button-primary, #fff);
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 500;
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
  transition: background-color 0.2s;
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
</style>