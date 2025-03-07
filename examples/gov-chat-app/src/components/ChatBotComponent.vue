<!-- ChatBotComponent.vue - Enhanced Translation Support -->
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

    <!-- Chat Window -->
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
        <div v-if="msg.sender === 'bot'" class="feedback-trigger">
          <button @click="openFeedback(index)">{{ translate('feedback.button', 'Feedback') }}</button>
        </div>
      </div>
      <div ref="messagesEnd"></div>
    </div>

    <!-- Input Area -->
    <div class="chat-input">
      <textarea
        v-model="newMessage"
        class="prompt-textarea"
        rows="4"
        :placeholder="translate('chatbot.placeholder', 'Type your message here...')"
        @keyup.enter.exact.prevent="sendMessage"
      ></textarea>
      <button class="send-btn" @click="sendMessage">
        {{ translate('chatbot.sendButton', 'Send') }}
      </button>
    </div>
  </div>
</template>

<script>
import { eventBus } from '../eventBus.js'
import axios from 'axios'

export default {
  name: 'ChatBotComponent',
  
  data() {
    return {
      chatMessages: [],
      newMessage: '',
      selectedContextItems: [],
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
          'chatbot.removeItem': 'Supprimer l\'élément',
          'chatbot.placeholder': 'Tapez votre message ici...',
          'chatbot.sendButton': 'Envoyer',
          'feedback.button': 'Commentaires',
          'chatbot.responsePrefix': 'J\'ai reçu votre message',
          'chatbot.withContext': 'avec contexte',
          'chatbot.processingError': 'Désolé, une erreur s\'est produite lors du traitement de votre demande.'
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
          'chatbot.processingError': 'Samahani, kulikuwa na hitilafu katika kutuma ombi lako.'
        }
      }
    }
  },
  
  created() {
    // Set initial locale
    if (this.$i18n && this.$i18n.locale) {
      this.currentLocale = this.$i18n.locale;
    }
    
    // Watch for locale changes
    if (this.$i18n) {
      this.$watch(() => this.$i18n.locale, (newLocale) => {
        console.log('Locale changed to:', newLocale);
        this.currentLocale = newLocale;
        this.updateWelcomeMessage();
      });
    }
  },
  
  mounted() {
    // Listen for tree node selection events
    eventBus.$on('treeNodeSelected', this.handleTreeNodeSelected);
    
    // Add welcome message
    this.updateWelcomeMessage();
    
    // Scroll to bottom of chat
    this.scrollToBottom();
  },
  
  beforeUnmount() {
    // Clean up event listeners
    eventBus.$off('treeNodeSelected', this.handleTreeNodeSelected);
  },
  
  watch: {
    chatMessages: {
      handler() {
        this.scrollToBottom();
      },
      deep: true
    }
  },
  
  methods: {
    getCurrentLocale() {
      // Get current locale from i18n, fallback to component's property
      return this.$i18n ? this.$i18n.locale : this.currentLocale;
    },
    
    translate(key, fallback) {
      const locale = this.getCurrentLocale();
      
      try {
        // Try i18n first
        if (this.$t) {
          const i18nTranslation = this.$t(key);
          // Check if translation exists and is not just the key repeated
          if (i18nTranslation && i18nTranslation !== key) {
            return i18nTranslation;
          }
        }
        
        // Try local translations
        const translation = this.translations[locale]?.[key] || 
                            this.translations['en']?.[key] || 
                            fallback;
        return translation;
      } catch (error) {
        console.error(`Translation error for key ${key}:`, error);
        return fallback;
      }
    },
    
    updateWelcomeMessage() {
      // Replace welcome message with translated version 
      // Only if it's the first and only message
      if (this.chatMessages.length === 0 || 
          (this.chatMessages.length === 1 && this.chatMessages[0].sender === 'bot')) {
        
        this.chatMessages = [{
          sender: 'bot',
          content: this.translate('chatbot.welcomeMessage', 'Welcome! How can I help you today?')
        }];
      }
    },
    
    handleTreeNodeSelected(item) {
      console.log('Tree node selection received:', item);
      
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
    
    async sendMessage() {
      const content = this.newMessage.trim();
      if (!content) return;
      
      // Add user message
      this.chatMessages.push({ sender: 'user', content });
      this.newMessage = '';
      
      try {
        // Include context items in the API request
        let contextInfo = null;
        
        if (this.selectedContextItems.length > 0) {
          contextInfo = this.selectedContextItems.map(item => item.service).join(', ');
        }
          
        // Simulate API response
        setTimeout(() => {
          this.chatMessages.push({ 
            sender: 'bot', 
            content: `${this.translate('chatbot.responsePrefix', 'I received your message')}: "${content}"${contextInfo ? ` ${this.translate('chatbot.withContext', 'with context')}: ${contextInfo}` : ''}`
          });
        }, 500);
        
        // Uncomment for real API call
        /*
        const res = await axios.post('/api/chat', { 
          message: content,
          context: contextInfo
        });
        
        this.chatMessages.push({ sender: 'bot', content: res.data.reply });
        */
      } catch (error) {
        console.error('Chat API error:', error);
        this.chatMessages.push({
          sender: 'bot',
          content: this.translate('chatbot.processingError', 'Sorry, there was an error processing your request.')
        });
      }
    },
    
    openFeedback(index) {
      alert('Feedback feature not implemented');
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
