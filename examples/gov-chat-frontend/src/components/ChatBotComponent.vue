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
              ? translate("status.online", "System Online")
              : translate("status.offline", "System Offline")
          }}</span>
        </div>
        <div class="status-metrics">
          <div class="metric">
            <span class="metric-label">{{
              translate("status.responseTime", "Avg. Response Time")
            }}</span>
            <span class="metric-value"
              >{{ systemStatus.avgResponseTime }}ms</span
            >
          </div>
          <div class="metric">
            <span class="metric-label">{{
              translate("status.queueLength", "Queue")
            }}</span>
            <span class="metric-value">{{ systemStatus.requestQueue }}</span>
          </div>
          <div class="metric">
            <span class="metric-label">{{
              translate("status.uptime", "Uptime")
            }}</span>
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
            translate("chatbot.queryContext", "Query Context:")
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
              :aria-label="translate('chatbot.removeItem', 'Remove item')"
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
              {{ translate("feedback.button", "Feedback") }}
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
            {{ translate("chatbot.whatCanIHelp", "How can I help you today?") }}
          </h2>

          <div class="quick-help-grid">
            <!-- Just Chat option with different styling -->
            <div
              class="quick-help-item just-chat"
              @click="selectQuickHelpOption(justChatOption)"
            >
              <div class="quick-help-icon" v-html="justChatOption.icon"></div>
              <div class="quick-help-text">
                {{ translate(justChatOption.textKey, "Just Chat") }}
              </div>
            </div>

            <!-- Other service options with proper i18n -->
            <div
              v-for="(option, index) in quickHelpOptions"
              :key="index"
              class="quick-help-item"
              @click="selectQuickHelpOption(option)"
            >
              <div class="quick-help-icon" v-html="option.icon"></div>
              <div class="quick-help-text">
                {{ translate(option.textKey, option.textKey.split(".")[1]) }}
              </div>
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
          :placeholder="
            translate('chatbot.placeholder', 'Type your message here...')
          "
          @keyup.enter.exact.prevent="sendMessage"
          @focus="handleTextareaFocus"
        ></textarea>
        <div class="input-actions">
          <button
            class="new-chat-btn"
            @click="startNewChat"
            :title="translate('chatbot.newChat', 'Start New Chat')"
          >
            <i class="fas fa-plus"></i>
          </button>
          <button
            v-if="chatMessages.length > 0"
            class="save-chat-btn"
            @click="saveChatToHistory"
            :title="translate('chatbot.saveChat', 'Save Chat')"
          >
            <i class="fas fa-save"></i>
          </button>
          <button class="send-btn" @click="sendMessage">
            {{ translate("chatbot.sendButton", "Send") }}
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
          <h3>{{ translate("chatbot.saveChat", "Save Chat") }}</h3>
        </template>
        <template v-slot:body>
          <div class="form-group">
            <label for="chatTitle">{{
              translate("chatbot.chatTitle", "Chat Title")
            }}</label>
            <input
              type="text"
              id="chatTitle"
              v-model="saveChatDialog.title"
              :placeholder="
                translate(
                  'chatbot.chatTitlePlaceholder',
                  'Enter a title for this chat'
                )
              "
            />
          </div>
          <div class="form-group">
            <label for="chatFolder">{{
              translate("chatbot.selectFolder", "Select Folder")
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
            {{ translate("common.cancel", "Cancel") }}
          </button>
          <button
            @click="handleSaveChat"
            class="primary-btn"
            :disabled="!saveChatDialog.title.trim()"
          >
            {{ translate("common.save", "Save") }}
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
      justChatOption: {
        service: "Just Chat",
        textKey: "quickhelp.justChat",
        promptKey: "quickhelp.justChatPrompt",
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4e97d1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',
      },
      quickHelpOptions: [
        {
          service: "Identity & Civil Registration",
          category: "1",
          textKey: "quickhelp.applyForID",
          promptKey: "quickhelp.applyForIDPrompt",
          icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M16 10a4 4 0 1 1-8 0 4 4 0 0 1 8 0z"></path><path d="M16 19c-1.43-1.74-3.58-3-6-3s-4.57 1.26-6 3"></path></svg>',
        },
        {
          service: "Taxes & Revenue",
          category: "5",
          textKey: "quickhelp.payTaxes",
          promptKey: "quickhelp.payTaxesPrompt",
          icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"></rect><path d="M16 10a4 4 0 1 1-8 0 4 4 0 0 1 8 0z"></path><path d="M12 10v.01"></path></svg>',
        },
        {
          service: "Business & Trade",
          category: "8",
          textKey: "quickhelp.startBusiness",
          promptKey: "quickhelp.startBusinessPrompt",
          icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v3a4 4 0 0 1-4 4h-3"></path><path d="M7 3v7a4 4 0 0 0 4 4h7"></path><path d="M13 21l-3-3 3-3"></path><path d="M9 3l3 3-3 3"></path></svg>',
        },
        {
          service: "Healthcare & Social Services",
          category: "2",
          textKey: "quickhelp.findHealthcare",
          promptKey: "quickhelp.findHealthcarePrompt",
          icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>',
        },
        {
          service: "Education & Learning",
          category: "3",
          textKey: "quickhelp.educationServices",
          promptKey: "quickhelp.educationServicesPrompt",
          icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h20v14H2zM8 21h8m-4-4v4"></path></svg>',
        },
        {
          service: "Transportation & Mobility",
          category: "7",
          textKey: "quickhelp.transportLicenses",
          promptKey: "quickhelp.transportLicensesPrompt",
          icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 8v4l3 3"></path></svg>',
        },
        {
          service: "Housing & Urban Development",
          category: "9",
          textKey: "quickhelp.housingPrograms",
          promptKey: "quickhelp.housingProgramsPrompt",
          icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>',
        },
        {
          service: "Employment & Labor Services",
          category: "4",
          textKey: "quickhelp.findJobs",
          promptKey: "quickhelp.findJobsPrompt",
          icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ec4899" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9"></path><path d="M13 2v7h7"></path></svg>',
        },
      ],
      translations: {
        en: {
          "chatbot.welcomeMessage": "Welcome! How can I help you today?",
          "chatbot.queryContext": "Query Context:",
          "chatbot.removeItem": "Remove item",
          "chatbot.placeholder": "Type your message here...",
          "chatbot.sendButton": "Send",
          "feedback.button": "Feedback",
          "chatbot.responsePrefix": "I received your message",
          "chatbot.withContext": "with context",
          "chatbot.processingError":
            "Sorry, there was an error processing your request.",
          "chatbot.saveChat": "Save Chat",
          "chatbot.chatTitle": "Chat Title",
          "chatbot.chatTitlePlaceholder": "Enter a title for this chat",
          "chatbot.selectFolder": "Select Folder",
          "chatbot.chatSaved": "Chat saved successfully!",
          "chatbot.chatUpdated": "Chat updated successfully!",
          "chatbot.newChat": "Start New Chat",
          "chatbot.clearContext": "Clear context and start a new conversation",
          "chatbot.unsavedChanges":
            "You have unsaved changes. Are you sure you want to start a new chat?",
          "chatbot.whatCanIHelp": "How can I help you today?",
          "chatbot.justChat": "Just Chat",
          "quickhelp.applyForID": "Apply for ID",
          "quickhelp.payTaxes": "Pay taxes",
          "quickhelp.startBusiness": "Start a business",
          "quickhelp.findHealthcare": "Find healthcare",
          "quickhelp.educationServices": "Education services",
          "quickhelp.transportLicenses": "Transport & licenses",
          "quickhelp.housingPrograms": "Housing programs",
          "quickhelp.findJobs": "Find jobs",
          "common.cancel": "Cancel",
          "common.save": "Save",
          "status.online": "System Online",
          "status.offline": "System Offline",
          "status.responseTime": "Avg. Response Time",
          "status.queueLength": "Queue",
          "status.uptime": "Uptime",
          "sidebar.title": "Info & Resources",
          "sidebar.chatHistory": "Recent Chats",
          "sidebar.relatedDocs": "Related Documents",
          "sidebar.faq": "Frequently Asked Questions",
          "sidebar.noChats": "No recent chats",
          "sidebar.noDocuments": "No related documents",
          "chatbot.saveConfirmTitle": "Save Existing Conversation",
          "chatbot.saveConfirmMessage": "Save existing conversation?",
          "chatbot.loadConfirmTitle": "Load Existing Conversation",
          "chatbot.loadConfirmMessage":
            "You have unsaved changes. Do you want to discard them and load the selected conversation, or save the current conversation first?",
          "chatbot.loadAndDiscard": "Load and Discard",
          "chatbot.saveAndLoad": "Save and Load",
          "chatbot.saveAndStartNew": "Save and Start New",
          "chatbot.discardAndStartNew": "Discard and Start New",
        },
        fr: {
          "chatbot.welcomeMessage":
            "Bienvenue ! Comment puis-je vous aider aujourd'hui ?",
          "chatbot.queryContext": "Contexte de la requête :",
          "chatbot.removeItem": "Supprimer l'élément",
          "chatbot.placeholder": "Tapez votre message ici...",
          "chatbot.sendButton": "Envoyer",
          "feedback.button": "Commentaires",
          "chatbot.responsePrefix": "J'ai reçu votre message",
          "chatbot.withContext": "avec le contexte",
          "chatbot.processingError":
            "Désolé, une erreur s'est produite lors du traitement de votre demande.",
          "chatbot.saveChat": "Enregistrer la discussion",
          "chatbot.chatTitle": "Titre de la discussion",
          "chatbot.chatTitlePlaceholder":
            "Entrez un titre pour cette discussion",
          "chatbot.selectFolder": "Sélectionner un dossier",
          "chatbot.chatSaved": "Discussion enregistrée avec succès !",
          "chatbot.chatUpdated": "Discussion mise à jour avec succès !",
          "chatbot.newChat": "Démarrer une nouvelle discussion",
          "chatbot.clearContext":
            "Effacer le contexte et démarrer une nouvelle conversation",
          "chatbot.unsavedChanges":
            "Vous avez des modifications non enregistrées. Êtes-vous sûr de vouloir démarrer une nouvelle discussion ?",
          "chatbot.whatCanIHelp": "Comment puis-je vous aider aujourd'hui ?",
          "chatbot.justChat": "Juste discuter",
          "quickhelp.applyForID": "Demander une carte d'identité",
          "quickhelp.payTaxes": "Payer les impôts",
          "quickhelp.startBusiness": "Démarrer une entreprise",
          "quickhelp.findHealthcare": "Trouver des soins de santé",
          "quickhelp.educationServices": "Services éducatifs",
          "quickhelp.transportLicenses": "Transport et licences",
          "quickhelp.housingPrograms": "Programmes de logement",
          "quickhelp.findJobs": "Trouver des emplois",
          "common.cancel": "Annuler",
          "common.save": "Enregistrer",
          "status.online": "Système en ligne",
          "status.offline": "Système hors ligne",
          "status.responseTime": "Temps de réponse moyen",
          "status.queueLength": "File d'attente",
          "status.uptime": "Temps de fonctionnement",
          "sidebar.title": "Infos et ressources",
          "sidebar.chatHistory": "Discussions récentes",
          "sidebar.relatedDocs": "Documents associés",
          "sidebar.faq": "Questions fréquentes",
          "sidebar.noChats": "Aucune discussion récente",
          "sidebar.noDocuments": "Aucun document associé",
          "chatbot.saveConfirmTitle": "Enregistrer la conversation existante",
          "chatbot.saveConfirmMessage":
            "Enregistrer la conversation existante ?",
          "chatbot.loadConfirmTitle": "Charger une conversation existante",
          "chatbot.loadConfirmMessage":
            "Vous avez des modifications non enregistrées. Voulez-vous les abandonner et charger la conversation sélectionnée, ou enregistrer la conversation actuelle d'abord ?",
          "chatbot.loadAndDiscard": "Charger et abandonner",
          "chatbot.saveAndLoad": "Enregistrer et charger",
          "chatbot.saveAndStartNew":
            "Enregistrer et démarrer une nouvelle discussion",
          "chatbot.discardAndStartNew":
            "Abandonner et démarrer une nouvelle discussion",
        },
        sw: {
          "chatbot.welcomeMessage": "Karibu! Nawezaje kukusaidia leo?",
          "chatbot.queryContext": "Muktadha wa Swali:",
          "chatbot.removeItem": "Ondoa kipengee",
          "chatbot.placeholder": "Andika ujumbe wako hapa...",
          "chatbot.sendButton": "Tuma",
          "feedback.button": "Maoni",
          "chatbot.responsePrefix": "Nimepokea ujumbe wako",
          "chatbot.withContext": "na muktadha",
          "chatbot.processingError":
            "Samahani, kulikuwa na hitilafu katika kushughulikia ombi lako.",
          "chatbot.saveChat": "Hifadhi Mazungumzo",
          "chatbot.chatTitle": "Kichwa cha Mazungumzo",
          "chatbot.chatTitlePlaceholder": "Ingiza kichwa cha mazungumzo haya",
          "chatbot.selectFolder": "Chagua Folda",
          "chatbot.chatSaved": "Mazungumzo yamehifadhiwa kwa mafanikio!",
          "chatbot.chatUpdated": "Mazungumzo yamesasishwa kwa mafanikio!",
          "chatbot.newChat": "Anza Mazungumzo Mapya",
          "chatbot.clearContext": "Futa muktadha na uanze mazungumzo mapya",
          "chatbot.unsavedChanges":
            "Una mabadiliko ambayo hayajahifadhiwa. Una uhakika unataka kuanza mazungumzo mapya?",
          "chatbot.whatCanIHelp": "Nawezaje kukusaidia leo?",
          "chatbot.justChat": "Zungumza tu",
          "quickhelp.applyForID": "Omba Kitambulisho",
          "quickhelp.payTaxes": "Lipa kodi",
          "quickhelp.startBusiness": "Anza Biashara",
          "quickhelp.findHealthcare": "Pata Huduma za Afya",
          "quickhelp.educationServices": "Huduma za Elimu",
          "quickhelp.transportLicenses": "Usafiri na Leseni",
          "quickhelp.housingPrograms": "Programu za Nyumba",
          "quickhelp.findJobs": "Tafuta Kazi",
          "common.cancel": "Ghairi",
          "common.save": "Hifadhi",
          "status.online": "Mfumo Uko Mtandaoni",
          "status.offline": "Mfumo Hauko Mtandaoni",
          "status.responseTime": "Wastani wa Muda wa Kumudu",
          "status.queueLength": "Foleni",
          "status.uptime": "Muda wa Kuendelea",
          "sidebar.title": "Taarifa na Rasilimali",
          "sidebar.chatHistory": "Mazungumzo ya Hivi Karibuni",
          "sidebar.relatedDocs": "Hati Zilizohusiana",
          "sidebar.faq": "Maswali Yanayoulizwa Mara kwa Mara",
          "sidebar.noChats": "Hakuna mazungumzo ya hivi karibuni",
          "sidebar.noDocuments": "Hakuna hati zinazohusiana",
          "chatbot.saveConfirmTitle": "Hifadhi Mazungumzo Yaliyopo",
          "chatbot.saveConfirmMessage": "Hifadhi mazungumzo yaliyopo?",
          "chatbot.loadConfirmTitle": "Pakia Mazungumzo Yaliyopo",
          "chatbot.loadConfirmMessage":
            "Una mabadiliko ambayo hayajahifadhiwa. Je, unataka kuyatupa na kupakia mazungumzo yaliyochaguliwa, au kuhifadhi mazungumzo ya sasa kwanza?",
          "chatbot.loadAndDiscard": "Pakia na Tupa",
          "chatbot.saveAndLoad": "Hifadhi na Pakia",
          "chatbot.saveAndStartNew": "Hifadhi na Anza Mazungumzo Mapya",
          "chatbot.discardAndStartNew": "Tupa na Anza Mazungumzo Mapya",
        },
      },
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
            content: this.translate(
              "chatbot.welcomeMessage",
              "Welcome! How can I help you today?"
            ),
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
        content: this.translate(
          "chatbot.welcomeMessage",
          "Welcome! How can I help you today?"
        ),
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

    translate(key, fallback) {
      if (this.$t && typeof this.$t === "function") {
        try {
          const i18nTranslation = this.$t(key);
          if (i18nTranslation && i18nTranslation !== key) {
            return i18nTranslation;
          }
        } catch (error) {
          console.warn(`Translation error for key: ${key}`, error);
        }
      }
      const localTranslation = this.translations[this.currentLocale]?.[key];
      if (localTranslation) {
        return localTranslation;
      }
      return this.translations["en"]?.[key] || fallback;
    },

    selectQuickHelpOption(option) {
      // Handle Vue Proxy or null option
      const rawOption =
        option && option.__v_isReactive ? { ...option } : option || {};
      if (!rawOption.service) {
        console.error("Invalid quick help option, missing service:", rawOption);
        return;
      }
      // Update context items
      const category =
        rawOption.category ||
        (rawOption.service !== this.justChatOption.service ? "general" : null);
      this.selectedContextItems = [
        {
          service: rawOption.service,
          category: category,
          selected: true,
        },
      ];

      // Set conversation category for non-Just Chat options, overriding sidebar
      if (rawOption.service !== this.justChatOption.service) {
        this.conversationCategory = category;
        console.log(
          `Set conversation category to ${category} for quick help option ${rawOption.service}, overriding any sidebar context`
        );
      } else {
        // Just Chat: retain existing sidebar category or set to null
        this.conversationCategory = this.conversationCategory || null;
        console.log(
          "Just Chat selected, retaining sidebar category:",
          this.conversationCategory
        );
      }

      // Hide quick help
      this.showQuickHelp = false;

      // Send predefined message if available
      if (rawOption.promptKey) {
        const message = this.translate(
          rawOption.promptKey,
          rawOption.promptKey.split(".")[1]
        );
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
            this.translate(
              "chatbot.contextAdded",
              "Context added to your query."
            ),
            1500
          );
          // Set conversationCategory if not set by a non-Just Chat quick help button
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
          this.translate(
            "chatbot.contextRemoved",
            "Context removed from your query."
          ),
          1500
        );
        // Clear conversationCategory if no context items remain and not set by quick help
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
      // Restore context item only if conversationCategory exists and matches a valid quick help option or sidebar context
      if (this.selectedContextItems.length === 0 && this.conversationCategory) {
        const quickHelpOption = this.quickHelpOptions.find(
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
          // Assume sidebar context; restore generic item
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
            `${this.translate(
              "chatbot.responsePrefix",
              "I received your message"
            )}: "${content}"${
              contextInfo
                ? ` ${this.translate(
                    "chatbot.withContext",
                    "with context"
                  )}: ${contextInfo}`
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
            this.translate("chatbot.sessionUpdated", "Session updated."),
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
          content: this.translate(
            "chatbot.processingError",
            "Sorry, there was an error processing your request."
          ),
          timestamp: new Date().toISOString(),
          isSaved: false,
        });
        notificationService.error(
          this.translate(
            "chatbot.processingError",
            "Sorry, there was an error processing your request."
          )
        );
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
        console.error("Cannot submit feedback: No queryId found");
        return;
      }
      try {
        await chatbotService.submitFeedback(queryId, {
          rating: feedback.rating,
          comment: feedback.text,
          providedAt: new Date().toISOString(),
        });
        console.log("Feedback submitted successfully");
        notificationService.success("Thank you for your feedback!");
      } catch (error) {
        console.error("Error submitting feedback:", error);
        notificationService.error(
          "Unable to submit feedback. Please try again."
        );
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

        // Set conversation metadata
        this.conversationId = conversation._key;
        this.currentChatId = conversation._key;
        this.currentChatTitle = conversation.title || this.generateChatTitle();
        this.conversationCategory = conversation.categoryId || null;

        // Load messages
        this.chatMessages = [];
        const messages = conversation.messages || [];
        messages.forEach((msg) => {
          this.chatMessages.push({
            sender: msg.sender === "user" ? "user" : "bot",
            content: msg.content,
            timestamp: msg.createdAt || new Date().toISOString(),
            queryId: msg.queryId || null,
            isSaved: true, // Mark all loaded messages as saved
          });
        });

        // If no messages, add welcome message
        if (this.chatMessages.length === 0) {
          this.chatMessages.push({
            sender: "bot",
            content: this.translate(
              "chatbot.welcomeMessage",
              "Welcome! How can I help you today?"
            ),
            timestamp: new Date().toISOString(),
            isSaved: true,
          });
        }

        // Load context items from tags
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

        // Reset lastSavedState to match loaded state
        this.lastSavedState = {
          messages: JSON.parse(JSON.stringify(this.chatMessages)), // Deep copy
          contextItems: JSON.parse(JSON.stringify(this.selectedContextItems)), // Deep copy
        };

        // Reset UI state
        this.newMessage = "";
        this.showQuickHelp = false;
        this.scrollToBottom();

        // Update Vuex store
        this.updateChatInHistory();

        notificationService.success(
          this.translate(
            "chatbot.conversationLoaded",
            "Conversation loaded successfully!"
          )
        );
      } catch (error) {
        console.error("Error loading conversation:", error);
        notificationService.error(
          this.translate("chatbot.loadError", "Unable to load conversation.")
        );
      }
    },

    hasUnsavedChanges() {
      // Case 3: New conversation not yet saved
      if (!this.conversationId && !this.currentChatId) {
        // Check if there are user messages or context items
        const hasUserMessages = this.chatMessages.some(
          (msg) => msg.sender === "user"
        );
        const hasContextItems = this.selectedContextItems.length > 0;
        return hasUserMessages || hasContextItems;
      }

      // Case 1: Check for new messages in existing conversation
      const hasNewMessages = this.chatMessages.some(
        (msg) =>
          !msg.isSaved &&
          (msg.sender === "user" || (msg.sender === "bot" && msg.queryId))
      );
      if (hasNewMessages) {
        return true;
      }

      // Case 2: Check for context item differences
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
        // Wait for save to complete (handled in handleSaveChat)
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
        // Existing conversation: update directly
        this.updateExistingChat();
      } else {
        // New conversation: open save dialog
        this.saveChatDialog = {
          visible: true,
          title: this.generateChatTitle(),
          folderId: "default",
        };
      }
    },

    // Convert selectedContextItems to tags array for storing the conversation
    getContextTags() {
      return this.selectedContextItems
        .map((item) => item.service)
        .filter((tag) => tag);
    },

    // Saves a new conversation to the backend... note that existing conversstions are handled differently
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

        // Add all messages, skipping the first user message if it matches initialMessage
        for (const message of this.chatMessages) {
          // Skip the welcome message (bot's initial message) and the first user message if it matches initialMessage
          if (
            (message.sender === "bot" && !message.queryId) || // Skip bot welcome message
            (message.sender === "user" &&
              message.content === firstUserMessage &&
              !message.isSaved) // Skip first user message
          ) {
            console.log(`Skipping message: ${message.content}`);
            message.isSaved = true; // Mark as saved to avoid reprocessing
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

        // Add conversation to folder if folderId is not 'default'
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

        // Update Vuex store
        this.currentChatId = conversation._key;
        this.currentChatTitle = conversationData.title;
        this.lastSavedState.messages = [...this.chatMessages];
        this.lastSavedState.contextItems = [...this.selectedContextItems];
        this.updateChatInHistory();

        // Notify success and close dialog
        notificationService.success(
          this.translate("chatbot.chatSaved", "Chat saved successfully!")
        );
        this.saveChatDialog.visible = false;
      } catch (error) {
        console.error("Error saving chat:", error);
        notificationService.error("Failed to save chat. Please try again.");
        throw error;
      }
    },

    // Updates an existing conversation on the backend... note that saving new conversstions is handled differently
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

        // Structure updateData to match backend expectations
        const updateData = {
          userId: currentUser._key,
          title: this.currentChatTitle || this.generateChatTitle(),
          categoryId: this.conversationCategory || null,
          tags: this.getContextTags(), // Populate tags from context items
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

        // Save only new messages
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

        // Update Vuex store
        this.currentChatId = this.conversationId;
        this.lastSavedState.messages = [...this.chatMessages];
        this.lastSavedState.contextItems = [...this.selectedContextItems];
        this.updateChatInHistory();

        // Notify success
        notificationService.success(
          this.translate("chatbot.chatUpdated", "Chat updated successfully!")
        );
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
              content: this.translate(
                "chatbot.welcomeMessage",
                "Welcome! How can I help you today?"
              ),
            },
          ];
        }
        this.currentChatId = chatId;
        this.showQuickHelp = false;
        this.scrollToBottom();
      } catch (error) {
        console.error("Error loading chat:", error);
        notificationService.error(
          this.translate("chatbot.loadError", "Unable to load chat history.")
        );
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
        // Update dialog text based on whether it's an existing or new conversation
        this.newChatDialog = {
          title: this.translate("chatbot.newChatTitle", "Start New Chat"),
          message: this.translate(
            "chatbot.unsavedChanges",
            "You have unsaved changes. Would you like to save them before starting a new chat?"
          ),
          confirmText: this.translate(
            "chatbot.saveAndStartNew",
            "Save and Start New"
          ),
          cancelText: this.translate(
            "chatbot.discardAndStartNew",
            "Discard and Start New"
          ),
          secondaryText: this.translate("common.cancel", "Cancel"),
        };
      } else {
        this.startNewChatConfirmed();
      }
    },

    async saveAndStartNewChat() {
      this.showNewChatConfirm = false;
      try {
        if (this.conversationId || this.currentChatId) {
          // Existing conversation: update it
          await this.updateExistingChat();
        } else {
          // New conversation: save it
          this.saveChatDialog = {
            visible: true,
            title: this.generateChatTitle(),
            folderId: "default",
          };
          // Wait for save to complete
          await new Promise((resolve) => {
            const unwatch = this.$watch("saveChatDialog.visible", (newVal) => {
              if (!newVal) {
                unwatch();
                resolve();
              }
            });
          });
        }
        // After saving, start new chat
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
          content: this.translate(
            "chatbot.welcomeMessage",
            "Welcome! How can I help you today?"
          ),
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
      notificationService.info(
        this.translate("chatbot.newChatStarted", "Started a new conversation."),
        1500
      );
    },

    cancelNewChat() {
      this.showNewChatConfirm = false;
    },

    updateDialogTexts() {
      this.newChatDialog = {
        title: this.translate("chatbot.newChatTitle", "Start New Chat"),
        message: this.translate(
          "chatbot.unsavedChanges",
          "You have unsaved changes. Would you like to save them before starting a new chat?"
        ),
        confirmText: this.translate(
          "chatbot.saveAndStartNew",
          "Save and Start New"
        ),
        cancelText: this.translate(
          "chatbot.discardAndStartNew",
          "Discard and Start New"
        ),
        secondaryText: this.translate("common.cancel", "Cancel"),
      };
      this.loadConfirmDialog = {
        title: this.translate(
          "chatbot.loadConfirmTitle",
          "Load Existing Conversation"
        ),
        message: this.translate(
          "chatbot.loadConfirmMessage",
          "You have unsaved changes. Do you want to discard them and load the selected conversation, or save the current conversation first?"
        ),
        confirmText: this.translate(
          "chatbot.loadAndDiscard",
          "Load and Discard"
        ),
        cancelText: this.translate("common.cancel", "Cancel"),
        secondaryText: this.translate("chatbot.saveAndLoad", "Save and Load"),
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
  background: var(--bg-card, #fff);
  border: 1px solid var(--border-light, #e5e7eb);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: var(--shadow-sm, 0 1px 3px rgba(0, 0, 0, 0.05));
}

.quick-help-item:hover {
  background: var(--bg-tertiary, #f9fafb);
  border-color: var(--border-color, #d1d5db);
  transform: translateY(-1px);
  box-shadow: var(--shadow-md, 0 2px 4px rgba(0, 0, 0, 0.1));
}

.quick-help-item.just-chat {
  background: var(--bg-tertiary, #f0f7ff);
  border-color: var(--accent-color, #bcdcff);
}

.quick-help-item.just-chat:hover {
  background: var(--bg-tertiary, #e1f0ff);
  border-color: var(--accent-color, #a3ceff);
}

.quick-help-icon {
  margin-right: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
}

.quick-help-text {
  font-size: 0.95rem;
  color: var(--text-primary, #333);
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
  /* This pushes it to the left */
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
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (min-width: 1024px) {
  .quick-help-grid {
    grid-template-columns: repeat(3, 1fr);
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