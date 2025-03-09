<!-- ChatBotComponent.vue - With Quick Help Overlay -->
<template>
  <div class="chatbot-container">
    <!-- Context Panel for selected tree nodes -->
    <div class="context-panel" v-if="selectedContextItems.length > 0">
      <div class="context-header">
        <span class="context-title">{{ translate('chatbot.queryContext', 'Query Context:') }}</span>
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
          <button @click="openFeedbackDialog(index)">{{ translate('feedback.button', 'Feedback') }}</button>
        </div>
      </div>
      <!-- Auto-scroll anchor element -->
      <div ref="messagesEnd"></div>
    </div>

    <!-- Updated Quick Help Overlay with proper internationalization -->
    <div 
      class="quick-help-overlay" 
      v-if="showQuickHelp && chatMessages.length <= 1"
    >
      <div class="quick-help-content">
        <h2 class="quick-help-heading">{{ translate('chatbot.whatCanIHelp', 'How can I help you today?') }}</h2>
    
        <div class="quick-help-grid">
          <!-- Just Chat option with different styling -->
          <div
            class="quick-help-item just-chat"
            @click="selectQuickHelpOption(justChatOption)"
          >
            <div class="quick-help-icon" v-html="justChatOption.icon"></div>
            <div class="quick-help-text">{{ translate(justChatOption.textKey, justChatOption.text) }}</div>
          </div>
      
          <!-- Other service options with proper i18n -->
          <div
            v-for="(option, index) in quickHelpOptions"
            :key="index"
            class="quick-help-item"
            @click="selectQuickHelpOption(option)"
          >
            <div class="quick-help-icon" v-html="option.icon"></div>
            <div class="quick-help-text">{{ translate(option.textKey, option.text) }}</div>
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
        :placeholder="translate('chatbot.placeholder', 'Type your message here...')"
        @keyup.enter.exact.prevent="sendMessage"
        @focus="handleTextareaFocus"
      ></textarea>
      <div class="input-actions">
        <button 
          class="new-chat-btn" 
          @click="startNewChat" 
          title="Start New Chat"
        >
          <i class="fas fa-plus"></i>
        </button>
        <button 
          v-if="chatMessages.length > 0" 
          class="save-chat-btn" 
          @click="saveChatToHistory" 
          title="Save to Chat History"
        >
          <i class="fas fa-save"></i>
        </button>
        <button class="send-btn" @click="sendMessage">
          {{ translate('chatbot.sendButton', 'Send') }}
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
    <modal-dialog v-if="saveChatDialog.visible" @close="saveChatDialog.visible = false">
      <template v-slot:header>
        <h3>{{ translate('chatbot.saveChat', 'Save Chat') }}</h3>
      </template>
      <template v-slot:body>
        <div class="form-group">
          <label for="chatTitle">{{ translate('chatbot.chatTitle', 'Chat Title') }}</label>
          <input 
            type="text" 
            id="chatTitle" 
            v-model="saveChatDialog.title" 
            :placeholder="translate('chatbot.chatTitlePlaceholder', 'Enter a title for this chat')"
          >
        </div>
        <div class="form-group">
          <label for="chatFolder">{{ translate('chatbot.selectFolder', 'Select Folder') }}</label>
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
          {{ translate('common.cancel', 'Cancel') }}
        </button>
        <button 
          @click="handleSaveChat" 
          class="primary-btn" 
          :disabled="!saveChatDialog.title.trim()"
        >
          {{ translate('common.save', 'Save') }}
        </button>
      </template>
    </modal-dialog>
  </div>
</template>

<script>
import { eventBus } from '../eventBus.js'
import { mapGetters, mapActions } from 'vuex';
import ChatResponseFeedbackDialog from './ChatResponseFeedbackDialog.vue'
import ModalDialog from './ModalDialog.vue'

export default {
  name: 'ChatBotComponent',
  components: {
    ChatResponseFeedbackDialog,
    ModalDialog
  },
  
  data() {
    return {
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
      currentChatId: null,
      currentLocale: 'en',
      showQuickHelp: true,
      // Just Chat option defined separately so it can be referenced directly in the template
      justChatOption: { 
        text: "Just Chat", 
        textKey: "chatbot.justChat",
        prompt: "I'd like to chat about government services",
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4e97d1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>'
      },
      // Other quick help options with translation keys
      quickHelpOptions: [
        { 
          text: "Apply for ID", 
          textKey: "quickHelp.applyForID",
          prompt: "I need information on how to apply for a national ID card",
          icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M16 10a4 4 0 1 1-8 0 4 4 0 0 1 8 0z"></path><path d="M16 19c-1.43-1.74-3.58-3-6-3s-4.57 1.26-6 3"></path></svg>'
        },
        { 
          text: "Pay taxes", 
          textKey: "quickHelp.payTaxes",
          prompt: "What's the process for paying my taxes online?",
          icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"></rect><path d="M16 10a4 4 0 1 1-8 0 4 4 0 0 1 8 0z"></path><path d="M12 10v.01"></path></svg>'
        },
        { 
          text: "Start a business", 
          textKey: "quickHelp.startBusiness",
          prompt: "Guide me through the steps to register a new business",
          icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v3a4 4 0 0 1-4 4h-3"></path><path d="M7 3v7a4 4 0 0 0 4 4h7"></path><path d="M13 21l-3-3 3-3"></path><path d="M9 3l3 3-3 3"></path></svg>'
        },
        { 
          text: "Find healthcare", 
          textKey: "quickHelp.findHealthcare",
          prompt: "Where can I find information about public healthcare services?",
          icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>'
        },
        { 
          text: "Education services", 
          textKey: "quickHelp.educationServices",
          prompt: "What education services are available for my children?",
          icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h20v14H2zM8 21h8m-4-4v4"></path></svg>'
        },
        { 
          text: "Transport & licenses", 
          textKey: "quickHelp.transportLicenses",
          prompt: "How do I renew my driving license?",
          icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 8v4l3 3"></path></svg>'
        },
        { 
          text: "Housing programs", 
          textKey: "quickHelp.housingPrograms",
          prompt: "Tell me about affordable housing programs in Kenya",
          icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>'
        },
        { 
          text: "Find jobs", 
          textKey: "quickHelp.findJobs",
          prompt: "What government job opportunities are currently available?",
          icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ec4899" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9"></path><path d="M13 2v7h7"></path></svg>'
        }
      ],
      translations: {
        en: {
          'chatbot.welcomeMessage': 'Welcome! How can I help you today?',
          'chatbot.queryContext': 'Query Context:',
          'chatbot.removeItem': 'Remove item',
          'chatbot.placeholder': 'Type your message here...',
          'chatbot.sendButton': 'Send',
          'feedback.button': 'Feedback',
          'chatbot.responsePrefix': 'I received your message',
          'chatbot.withContext': 'with context',
          'chatbot.processingError': 'Sorry, there was an error processing your request.',
          'chatbot.saveChat': 'Save Chat',
          'chatbot.chatTitle': 'Chat Title',
          'chatbot.chatTitlePlaceholder': 'Enter a title for this chat',
          'chatbot.selectFolder': 'Select Folder',
          'chatbot.chatSaved': 'Chat saved successfully!',
          'chatbot.chatUpdated': 'Chat updated successfully!',
          'chatbot.newChat': 'Start New Chat',
          'chatbot.clearContext': 'Clear context and start a new conversation',
          'chatbot.unsavedChanges': 'You have unsaved changes. Are you sure you want to start a new chat?',
          'chatbot.whatCanIHelp': 'How can I help you today?',
          'chatbot.justChat': 'Just Chat',
          'quickHelp.applyForID': 'Apply for ID',
          'quickHelp.payTaxes': 'Pay taxes',
          'quickHelp.startBusiness': 'Start a business',
          'quickHelp.findHealthcare': 'Find healthcare',
          'quickHelp.educationServices': 'Education services',
          'quickHelp.transportLicenses': 'Transport & licenses',
          'quickHelp.housingPrograms': 'Housing programs',
          'quickHelp.findJobs': 'Find jobs',
          'common.cancel': 'Cancel',
          'common.save': 'Save'
        },
        fr: {
          'chatbot.welcomeMessage': 'Bienvenue ! Comment puis-je vous aider aujourd\'hui ?',
          'chatbot.queryContext': 'Contexte de la requête :',
          'chatbot.removeItem': 'Supprimer l\'élément',
          'chatbot.placeholder': 'Tapez votre message ici...',
          'chatbot.sendButton': 'Envoyer',
          'feedback.button': 'Commentaires',
          'chatbot.responsePrefix': 'J\'ai reçu votre message',
          'chatbot.withContext': 'avec contexte',
          'chatbot.processingError': 'Désolé, une erreur s\'est produite lors du traitement de votre demande.',
          'chatbot.saveChat': 'Enregistrer la Conversation',
          'chatbot.chatTitle': 'Titre de la Conversation',
          'chatbot.chatTitlePlaceholder': 'Entrez un titre pour cette conversation',
          'chatbot.selectFolder': 'Sélectionner un Dossier',
          'chatbot.chatSaved': 'Conversation enregistrée avec succès !',
          'chatbot.chatUpdated': 'Conversation mise à jour avec succès !',
          'chatbot.newChat': 'Nouvelle Conversation',
          'chatbot.clearContext': 'Effacer le contexte et démarrer une nouvelle conversation',
          'chatbot.unsavedChanges': 'Vous avez des modifications non enregistrées. Êtes-vous sûr de vouloir commencer une nouvelle conversation ?',
          'chatbot.whatCanIHelp': 'Comment puis-je vous aider aujourd\'hui ?',
          'chatbot.justChat': 'Simplement discuter',
          'quickHelp.applyForID': 'Demander une pièce d\'identité',
          'quickHelp.payTaxes': 'Payer ses impôts',
          'quickHelp.startBusiness': 'Créer une entreprise',
          'quickHelp.findHealthcare': 'Trouver des soins de santé',
          'quickHelp.educationServices': 'Services d\'éducation',
          'quickHelp.transportLicenses': 'Transport et permis',
          'quickHelp.housingPrograms': 'Programmes de logement',
          'quickHelp.findJobs': 'Chercher un emploi',
          'common.cancel': 'Annuler',
          'common.save': 'Enregistrer'
        },
        sw: {
          'chatbot.welcomeMessage': 'Karibu! Nawezaje kukusaidia leo?',
          'chatbot.queryContext': 'Muktadha wa Hoja:',
          'chatbot.removeItem': 'Ondoa kipengee',
          'chatbot.placeholder': 'Andika ujumbe wako hapa...',
          'chatbot.sendButton': 'Tuma',
          'feedback.button': 'Maoni',
          'chatbot.responsePrefix': 'Nimepokea ujumbe wako',
          'chatbot.withContext': 'na muktadha',
          'chatbot.processingError': 'Samahani, kulikuwa na hitilafu katika kuchakata ombi lako.',
          'chatbot.saveChat': 'Hifadhi Mazungumzo',
          'chatbot.chatTitle': 'Kichwa cha Mazungumzo',
          'chatbot.chatTitlePlaceholder': 'Weka kichwa cha mazungumzo haya',
          'chatbot.selectFolder': 'Chagua Folda',
          'chatbot.chatSaved': 'Mazungumzo yamehifadhiwa kikamilifu!',
          'chatbot.chatUpdated': 'Mazungumzo yameboreshwa kikamilifu!',
          'chatbot.newChat': 'Mazungumzo Mapya',
          'chatbot.clearContext': 'Futa muktadha na anza mazungumzo mapya',
          'chatbot.unsavedChanges': 'Una mabadiliko ambayo hayajahifadhiwa. Una uhakika unataka kuanza mazungumzo mapya?',
          'chatbot.whatCanIHelp': 'Naweza kukusaidia vipi leo?',
          'chatbot.justChat': 'Ongea tu',
          'quickHelp.applyForID': 'Omba kitambulisho',
          'quickHelp.payTaxes': 'Lipa kodi',
          'quickHelp.startBusiness': 'Anza biashara',
          'quickHelp.findHealthcare': 'Tafuta huduma za afya',
          'quickHelp.educationServices': 'Huduma za elimu',
          'quickHelp.transportLicenses': 'Usafiri na leseni',
          'quickHelp.housingPrograms': 'Programu za nyumba',
          'quickHelp.findJobs': 'Tafuta kazi',
          'common.cancel': 'Ghairi',
          'common.save': 'Hifadhi'
        }
      }
    };
  },
  
  computed: {
    ...mapGetters('chatHistory', [
      'getAllFolders',
      'getChatById'
    ]),
    
    folders() {
      return this.getAllFolders;
    },
    
    // Get the first message from the user as a preview
    chatPreview() {
      const userMessage = this.chatMessages.find(msg => msg.sender === 'user');
      if (userMessage) {
        // Truncate to reasonable length (50 chars)
        return userMessage.content.length > 50 
          ? userMessage.content.substring(0, 47) + '...' 
          : userMessage.content;
      }
      return 'New conversation';
    }
  },
  
  mounted() {
    // Add welcome message
    if (this.chatMessages.length === 0) {
      this.chatMessages.push({
        sender: 'bot',
        content: this.translate('chatbot.welcomeMessage', 'Welcome! How can I help you today?')
      });
    }
    
    // Set up event listeners
    if (this.$root.$i18n) {
      this.currentLocale = this.$root.$i18n.locale;
      this.$watch('$root.$i18n.locale', (newLocale) => {
        this.currentLocale = newLocale;
      });
    }
    
    // Listen for tree node selection events
    eventBus.$on('treeNodeSelected', this.handleTreeNodeSelected);
    
    // Listen for open-chat events from the folder system
    eventBus.$on('open-chat', this.loadChatFromHistory);
    
    // Scroll to bottom of chat
    this.scrollToBottom();
  },
  
  beforeUnmount() {
    // Clean up event listeners
    eventBus.$off('treeNodeSelected', this.handleTreeNodeSelected);
    eventBus.$off('open-chat', this.loadChatFromHistory);
  },
  
  methods: {
    ...mapActions('chatHistory', [
      'createChat',
      'updateChat'
    ]),
    
    translate(key, fallback) {
      // Try translation from i18n plugin first
      if (this.$t && typeof this.$t === 'function') {
        const i18nTranslation = this.$t(key);
        if (i18nTranslation && i18nTranslation !== key) {
          return i18nTranslation;
        }
      }
      
      // Then try from local translations
      const localTranslation = this.translations[this.currentLocale]?.[key];
      if (localTranslation) {
        return localTranslation;
      }
      
      // Finally, use English translation or fallback
      return this.translations['en']?.[key] || fallback;
    },
    
    selectQuickHelpOption(option) {
      // Set the prompt text in the input field
      this.newMessage = option.prompt;
      
      // Hide the quick help overlay
      this.showQuickHelp = false;
      
      // Focus on the textarea
      this.$nextTick(() => {
        const textarea = document.querySelector('.prompt-textarea');
        if (textarea) {
          textarea.focus();
        }
      });
    },
    
    handleTextareaFocus() {
      // Hide quick help when user focuses on the textarea
      this.showQuickHelp = false;
    },
    
    handleTreeNodeSelected(item) {
      if (!item || typeof item !== 'object') return;
      
      // Check if item is selected or deselected
      if (item.selected) {
        // Add to context if not already present
        const exists = this.selectedContextItems.some(existing => 
            existing.category === item.category && 
            existing.service === item.service);
            
        if (!exists) {
          this.selectedContextItems.push(item);
        }
      } else {
        // Remove from context if deselected
        this.selectedContextItems = this.selectedContextItems.filter(existing => 
          !(existing.category === item.category && existing.service === item.service)
        );
      }
    },
    
    removeContextItem(index) {
      if (index < 0 || index >= this.selectedContextItems.length) return;
      
      const removed = this.selectedContextItems[index];
      this.selectedContextItems.splice(index, 1);
      
      // Emit event to notify tree component to update its selection
      eventBus.$emit('contextItemRemoved', removed);
    },
    
    sendMessage() {
      const content = this.newMessage.trim();
      if (!content) return;
      
      // Add user message
      this.chatMessages.push({ sender: 'user', content });
      this.newMessage = '';
      
      // Create context string
      const contextInfo = this.selectedContextItems.length > 0
        ? this.selectedContextItems.map(item => item.service).join(', ')
        : null;
      
      // Hide quick help when a message is sent
      this.showQuickHelp = false;
      
      // Simulate response (in real app, this would be an API call)
      setTimeout(() => {
        this.chatMessages.push({ 
          sender: 'bot', 
          content: `${this.translate('chatbot.responsePrefix', 'I received your message')}: "${content}"${
            contextInfo ? ` ${this.translate('chatbot.withContext', 'with context')}: ${contextInfo}` : ''
          }`
        });
        
        // Scroll to bottom after adding message
        this.scrollToBottom();
        
        // If this is an existing chat, update it
        if (this.currentChatId) {
          this.updateChatInHistory();
        }
      }, 500);
    },
    
    openFeedbackDialog(index) {
      // Set the selected message and make dialog visible
      this.feedbackDialog = {
        visible: true,
        message: this.chatMessages[index]
      };
    },
    
    closeFeedbackDialog() {
      this.feedbackDialog.visible = false;
    },
    
    handleFeedbackSubmit(feedback) {
      // In a real app, this would send the feedback to your API
      console.log('Feedback submitted:', feedback);
      
      // Close the dialog
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
    
    // Chat History Integration
    
    saveChatToHistory() {
      // Open the save dialog
      this.saveChatDialog = {
        visible: true,
        title: this.currentChatId ? 
          (this.getChatById(this.currentChatId)?.title || '') : 
          this.generateChatTitle(),
        folderId: 'default'
      };
    },
    
    handleSaveChat() {
      if (!this.saveChatDialog.title.trim()) return;
      
      if (this.currentChatId) {
        // Update existing chat
        this.updateChat({
          chatId: this.currentChatId,
          title: this.saveChatDialog.title.trim(),
          preview: this.chatPreview
        });
        
        // Show success message or notification
        alert(this.translate('chatbot.chatUpdated', 'Chat updated successfully!'));
      } else {
        // Create new chat
        const chatId = this.createChat({
          title: this.saveChatDialog.title.trim(),
          preview: this.chatPreview,
          folderId: this.saveChatDialog.folderId,
          // Store full chat data in localStorage or somewhere else
          fullChatData: JSON.stringify(this.chatMessages)
        });
        
        // Update current chat ID
        this.currentChatId = chatId;
        
        // Show success message or notification
        alert(this.translate('chatbot.chatSaved', 'Chat saved successfully!'));
      }
      
      // Close dialog
      this.saveChatDialog.visible = false;
    },
    
    updateChatInHistory() {
      // Only update if we have a current chat ID
      if (this.currentChatId) {
        this.updateChat({
          chatId: this.currentChatId,
          preview: this.chatPreview,
          // Store full chat data in localStorage or somewhere else
          fullChatData: JSON.stringify(this.chatMessages)
        });
      }
    },
    
    loadChatFromHistory(chatId) {
      // Get chat from store
      const chat = this.getChatById(chatId);
      if (!chat) return;
      
      try {
        // Retrieve full chat data from storage
        // This is a simplified example - in a real app, you'd store this in your backend
        const storedChatData = localStorage.getItem(`chat_data_${chatId}`);
        if (storedChatData) {
          // Load chat messages
          this.chatMessages = JSON.parse(storedChatData);
        } else {
          // If no stored data, create a new chat with just the title
          this.chatMessages = [
            {
              sender: 'bot',
              content: this.translate('chatbot.welcomeMessage', 'Welcome! How can I help you today?')
            }
          ];
        }
        
        // Set current chat ID
        this.currentChatId = chatId;
        
        // Hide quick help when loading a chat
        this.showQuickHelp = false;
        
        // Scroll to bottom after loading
        this.scrollToBottom();
      } catch (error) {
        console.error('Error loading chat:', error);
        // Show error message
      }
    },
    
    generateChatTitle() {
      // Generate a title based on the first user message or current date
      const userMessage = this.chatMessages.find(msg => msg.sender === 'user');
      if (userMessage) {
        // Use first 20 chars of user message
        return userMessage.content.length > 20 
          ? userMessage.content.substring(0, 17) + '...' 
          : userMessage.content;
      }
      
      // Default to date-based title
      const now = new Date();
      return `Chat - ${now.toLocaleDateString()}`;
    },
    
    startNewChat() {
      // Confirm with user if there are unsaved changes
      if (this.chatMessages.length > 1 && !this.currentChatId) {
        if (!confirm(this.translate('chatbot.unsavedChanges', 'You have unsaved changes. Are you sure you want to start a new chat?'))) {
          return;
        }
      }
      
      // Clear current chat
      this.chatMessages = [
        {
          sender: 'bot',
          content: this.translate('chatbot.welcomeMessage', 'Welcome! How can I help you today?')
        }
      ];
      this.currentChatId = null;
      this.selectedContextItems = [];
      this.newMessage = '';
      
      // Show quick help when starting a new chat
      this.showQuickHelp = true;
      
      // Scroll to bottom after resetting
      this.scrollToBottom();
    }
  }
}
</script>

<style scoped>
.chatbot-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  position: relative;
}

/* Context Panel Styles */
.context-panel {
  background: #f5f9ff;
  border-bottom: 1px solid #e0e0e0;
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
  color: #4a4a4a;
}

.context-items {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.context-item {
  display: flex;
  align-items: center;
  background: #fff;
  border: 1px solid #ddd;
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
}

.context-remove-btn {
  background: none;
  border: none;
  color: #888;
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
  color: #555;
  background: #f0f0f0;
}

/* Chat Window Styles */
.chat-window {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
  background: #fafafa;
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
  background: #e5e5ea;
  color: #000;
  padding: 8px 12px;
  border-radius: 16px;
  max-width: 60%;
  line-height: 1.4;
  white-space: pre-wrap;
  word-wrap: break-word;
  box-shadow: 0 1px 2px rgba(0,0,0,0.1);
}

.chat-message.user .message-bubble {
  background: #4e97d1;
  color: #fff;
}
.feedback-trigger {
  margin-left: 8px;
  align-self: center;
}
.feedback-trigger button {
  background: #f0f0f0;
  border: none;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.8rem;
}
.feedback-trigger button:hover {
  background: #e0e0e0;
}

/* Quick Help Overlay */
.quick-help-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(250, 250, 250, 0.97);
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
  color: #333;
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
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.quick-help-item:hover {
  background: #f9fafb;
  border-color: #d1d5db;
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.quick-help-item.just-chat {
  background: #f0f7ff;
  border-color: #bcdcff;
}

.quick-help-item.just-chat:hover {
  background: #e1f0ff;
  border-color: #a3ceff;
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
  color: #333;
  font-weight: 500;
}

/* Chat Input Styles */
.chat-input {
  display: flex;
  flex-direction: column;
  background: #fff;
  border-top: 1px solid #ddd;
  padding: 8px;
}

.prompt-textarea {
  resize: vertical;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 10px;
  font-size: 1rem;
  margin-bottom:8px;
  max-height: 120px;
}

.input-actions {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
}

.new-chat-btn {
  background: #f0f0f0;
  color: #555;
  border: none;
  padding: 8px 12px;
  border-radius: 4px;
  cursor: pointer;
  margin-right: auto; /* This pushes it to the left */
}

.new-chat-btn:hover {
  background: #e0e0e0;
  color: #4e97d1;
}

.save-chat-btn {
  background: #f0f0f0;
  color: #555;
  border: none;
  padding: 8px 12px;
  border-radius: 4px;
  cursor: pointer;
}

.save-chat-btn:hover {
  background: #e0e0e0;
}

.send-btn {
  background: #4e97d1;
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 500;
}

.send-btn:hover {
  background: #3a7da0;
}

/* Form Styles for Save Dialog */
.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
}

.form-group input, 
.form-group select {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 1rem;
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
  background: none;
  border: 1px solid #ddd;
  color: #666;
}

.cancel-btn:hover {
  background-color: #f5f5f5;
}

.primary-btn {
  background-color: #4e97d1;
  border: none;
  color: white;
}

.primary-btn:hover {
  background-color: #3a7cb5;
}

.primary-btn:disabled {
  background-color: #a9cae8;
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

@media (max-width: 480px) {
  .quick-help-grid {
    grid-template-columns: 1fr;
  }
  
  .quick-help-heading {
    font-size: 1.4rem;
  }
}
</style>
