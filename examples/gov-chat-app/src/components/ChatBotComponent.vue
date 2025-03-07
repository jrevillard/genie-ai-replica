<!-- ChatBotComponent.vue - With Chat History Integration -->
<template>
  <div class="chatbot-container">
    <!-- Context Panel for selected tree nodes -->
    <div class="context-panel" v-if="selectedContextItems.length > 0">
      <div class="context-header">
        <span class="context-title">{{ $t('chatbot.queryContext', 'Query Context:') }}</span>
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
            :aria-label="$t('chatbot.removeItem', 'Remove item')"
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
          <button @click="openFeedbackDialog(index)">Feedback</button>
        </div>
      </div>
      <!-- Auto-scroll anchor element -->
      <div ref="messagesEnd"></div>
    </div>

    <!-- Input Area -->
    <div class="chat-input">
      <textarea
        v-model="newMessage"
        class="prompt-textarea"
        rows="4"
        :placeholder="$t('chatbot.placeholder', 'Type your message here...')"
        @keyup.enter.exact.prevent="sendMessage"
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
          {{ $t('chatbot.sendButton', 'Send') }}
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
        <h3>{{ $t('chatbot.saveChat', 'Save Chat') }}</h3>
      </template>
      <template v-slot:body>
        <div class="form-group">
          <label for="chatTitle">{{ $t('chatbot.chatTitle', 'Chat Title') }}</label>
          <input 
            type="text" 
            id="chatTitle" 
            v-model="saveChatDialog.title" 
            :placeholder="$t('chatbot.chatTitlePlaceholder', 'Enter a title for this chat')"
          >
        </div>
        <div class="form-group">
          <label for="chatFolder">{{ $t('chatbot.selectFolder', 'Select Folder') }}</label>
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
          {{ $t('common.cancel', 'Cancel') }}
        </button>
        <button 
          @click="handleSaveChat" 
          class="primary-btn" 
          :disabled="!saveChatDialog.title.trim()"
        >
          {{ $t('common.save', 'Save') }}
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
          'chatbot.unsavedChanges': 'You have unsaved changes. Are you sure you want to start a new chat?'
        },
        fr: {
          'chatbot.welcomeMessage': 'Bienvenue ! Comment puis-je vous aider aujourd\'hui ?',
          'chatbot.queryContext': 'Contexte de la requête :',
          // Other French translations...
          'chatbot.newChat': 'Nouvelle Conversation',
          'chatbot.clearContext': 'Effacer le contexte et démarrer une nouvelle conversation'
        },
        sw: {
          'chatbot.welcomeMessage': 'Karibu! Nawezaje kukusaidia leo?',
          'chatbot.queryContext': 'Muktadha wa Hoja:',
          // Other Swahili translations...
          'chatbot.newChat': 'Mazungumzo Mapya',
          'chatbot.clearContext': 'Futa muktadha na anza mazungumzo mapya'
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
      // Try translation from i18n
      if (this.$t) {
        const i18nTranslation = this.$t(key);
        if (i18nTranslation && i18nTranslation !== key) {
          return i18nTranslation;
        }
      }
      
      // Try from local translations
      return this.translations[this.currentLocale]?.[key] || 
             this.translations['en']?.[key] || 
             fallback;
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
  margin-bottom: 8px;
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
}
</style>
