<!-- ChatBotComponent.vue - With Fixed Button Label -->
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
      <button class="send-btn" @click="sendMessage">
        {{ $t('chatbot.sendButton', 'Send') }}
      </button>
    </div>

    <!-- Feedback Dialog -->
    <chat-response-feedback-dialog
      v-if="feedbackDialog.visible"
      :visible="feedbackDialog.visible"
      :message="feedbackDialog.message"
      @close="closeFeedbackDialog"
      @submit="handleFeedbackSubmit"
    />
  </div>
</template>

<script>
import { eventBus } from '../eventBus.js'
import ChatResponseFeedbackDialog from './ChatResponseFeedbackDialog.vue'

export default {
  name: 'ChatBotComponent',
  components: {
    ChatResponseFeedbackDialog
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
          'chatbot.processingError': 'Sorry, there was an error processing your request.'
        },
        fr: {
          'chatbot.welcomeMessage': 'Bienvenue ! Comment puis-je vous aider aujourd\'hui ?',
          'chatbot.queryContext': 'Contexte de la requête :',
          // Other French translations...
        },
        sw: {
          'chatbot.welcomeMessage': 'Karibu! Nawezaje kukusaidia leo?',
          'chatbot.queryContext': 'Muktadha wa Hoja:',
          // Other Swahili translations...
        }
      }
    };
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
    
    // Scroll to bottom of chat
    this.scrollToBottom();
  },
  
  beforeUnmount() {
    // Clean up event listeners
    eventBus.$off('treeNodeSelected', this.handleTreeNodeSelected);
  },
  
  methods: {
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

.send-btn {
  align-self: flex-end;
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
