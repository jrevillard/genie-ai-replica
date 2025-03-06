<!-- ChatBotComponent.vue -->
<template>
  <div class="chatbot-container">
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
          <button @click="openFeedbackDialog(index)">{{ $t('feedback.button') }}</button>
        </div>
      </div>
      <!-- Auto-scroll anchor element -->
      <div ref="messagesEnd"></div>
    </div>

    <!-- Input row at bottom -->
    <div class="chat-input">
      <textarea
        v-model="newMessage"
        class="prompt-textarea"
        rows="4"
        :placeholder="$t('chatbot.placeholder')"
        @keyup.enter.exact.prevent="sendMessage"
      ></textarea>

      <div class="file-upload-wrapper">
        <label for="file-upload" class="file-upload-button">
          <span>{{ $t('chatbot.attachFile') }}</span>
          <input 
            id="file-upload" 
            type="file" 
            accept="image/*,.pdf" 
            @change="onFileSelected"
            class="hidden-input" 
          />
        </label>
        <div v-if="filePreview" class="file-preview">
          <img
            v-if="isImagePreview"
            :src="filePreview"
            alt="Preview"
            class="preview-img"
          />
          <div v-else class="pdf-preview">
            <p>PDF: {{ selectedFile?.name }}</p>
          </div>
          <button @click="removeFile" class="remove-file-btn">x</button>
        </div>
      </div>

      <!-- Upload progress indicator -->
      <div v-if="uploadProgress > 0 && uploadProgress < 100" class="upload-progress">
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: uploadProgress + '%' }"></div>
        </div>
        <span>{{ uploadProgress }}%</span>
      </div>

      <button class="send-btn" @click="sendMessage" :disabled="isUploading">
        {{ $t('chatbot.sendButton') }}
      </button>
    </div>

    <chat-response-feedback-dialog
      :visible="feedbackDialog.visible"
      :message="feedbackDialog.message"
      @close="feedbackDialog.visible = false"
      @submit="handleFeedbackSubmit"
    />
  </div>
</template>

<script>
import axios from 'axios'
import ChatResponseFeedbackDialog from './ChatResponseFeedbackDialog.vue'

export default {
  name: 'ChatBotComponent',
  components: { ChatResponseFeedbackDialog },
  data() {
    return {
      chatMessages: [],
      newMessage: '',
      selectedFile: null,
      filePreview: null,
      uploadProgress: 0,
      isUploading: false,
      feedbackDialog: {
        visible: false,
        message: null
      },
      // For intersection observer
      observer: null
    }
  },
  computed: {
    isImagePreview() {
      return this.filePreview && this.filePreview.startsWith('blob:')
    }
  },
  mounted() {
    this.scrollToBottom(true)
    this.setupScrollObserver()
    
    // Add welcome message if chat is empty
    if (this.chatMessages.length === 0) {
      this.chatMessages.push({
        sender: 'bot',
        content: this.$t('chatbot.welcomeMessage')
      })
    }
  },
  beforeDestroy() {
    // Clean up observer
    if (this.observer) {
      this.observer.disconnect()
    }
    // Clean up any blob URLs to prevent memory leaks
    if (this.filePreview && this.filePreview.startsWith('blob:')) {
      URL.revokeObjectURL(this.filePreview)
    }
  },
  methods: {
    setupScrollObserver() {
      // Create an intersection observer to detect when we should auto-scroll
      this.observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[0]
          if (entry.isIntersecting) {
            // User is at bottom, we should auto-scroll for new messages
            this.shouldAutoScroll = true
          } else {
            // User has scrolled up, don't auto-scroll
            this.shouldAutoScroll = false
          }
        },
        { threshold: 0.5 }
      )
      
      // Start observing our anchor element
      if (this.$refs.messagesEnd) {
        this.observer.observe(this.$refs.messagesEnd)
      }
    },
    onFileSelected(e) {
      const file = e.target.files[0]
      if (!file) return
      
      // File size validation (10MB limit)
      const maxSize = 10 * 1024 * 1024 // 10MB in bytes
      if (file.size > maxSize) {
        this.chatMessages.push({
          sender: 'bot',
          content: this.$t('chatbot.fileTooLarge', { maxSize: '10MB' })
        })
        return
      }
      
      this.selectedFile = file

      if (file.type.includes('image')) {
        // Clean up previous blob URL if exists
        if (this.filePreview && this.filePreview.startsWith('blob:')) {
          URL.revokeObjectURL(this.filePreview)
        }
        this.filePreview = URL.createObjectURL(file)
      } else if (file.type === 'application/pdf') {
        this.filePreview = 'pdf'
      }
    },
    removeFile() {
      if (this.filePreview && this.filePreview.startsWith('blob:')) {
        URL.revokeObjectURL(this.filePreview)
      }
      this.selectedFile = null
      this.filePreview = null
    },
    async sendMessage() {
      const content = this.newMessage.trim()
      if (!content && !this.selectedFile) return
      
      if (content) {
        this.chatMessages.push({ sender: 'user', content })
      }
      this.newMessage = ''

      if (this.selectedFile) {
        await this.uploadFile()
      }

      if (content) {
        try {
          const res = await axios.post('/api/chat', { message: content })
          this.chatMessages.push({ sender: 'bot', content: res.data.reply })
        } catch (error) {
          console.error('Chat API error:', error)
          this.chatMessages.push({
            sender: 'bot',
            content: this.$t('chatbot.processingError')
          })
        }
      }
    },
    async uploadFile() {
      this.isUploading = true
      this.uploadProgress = 0
      
      try {
        const formData = new FormData()
        formData.append('file', this.selectedFile)
        
        await axios.post('/api/upload', formData, {
          onUploadProgress: progressEvent => {
            const percentCompleted = Math.round(
              (progressEvent.loaded * 100) / progressEvent.total
            )
            this.uploadProgress = percentCompleted
          }
        })
        
        this.chatMessages.push({
          sender: 'bot',
          content: this.$t('chatbot.fileReceived')
        })
      } catch (error) {
        console.error('File upload error:', error)
        this.chatMessages.push({
          sender: 'bot',
          content: this.$t('chatbot.fileUploadError')
        })
      } finally {
        this.isUploading = false
        this.uploadProgress = 0
        this.removeFile()
      }
    },
    openFeedbackDialog(index) {
      const botMessage = this.chatMessages[index]
      this.feedbackDialog.visible = true
      this.feedbackDialog.message = botMessage
    },
    handleFeedbackSubmit(feedback) {
      console.log('Feedback submitted:', feedback)
      
      // Send feedback to server
      axios.post('/api/feedback', {
        messageContent: this.feedbackDialog.message.content,
        feedback
      }).catch(error => {
        console.error('Error submitting feedback:', error)
      })
    },
    scrollToBottom(force = false) {
      // If force is true or we're near the bottom already, scroll down
      this.$nextTick(() => {
        const container = this.$refs.chatWindow
        if (!container) return
        
        if (force || this.shouldAutoScroll) {
          // Use requestAnimationFrame for smoother scrolling after layout
          requestAnimationFrame(() => {
            container.scrollTop = container.scrollHeight
          })
        }
      })
    }
  },
  watch: {
    chatMessages: {
      handler() {
        this.scrollToBottom()
      },
      deep: true
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

.chat-window {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
  background: #fafafa;
  scroll-behavior: smooth;
}

.chat-message {
  margin-bottom: 12px;
  display: flex;
  align-items: flex-start;
  animation: fadeIn 0.3s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
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

  /* Ensure long text/code wraps */
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
  margin-top: 4px;
  font-size: 0.8rem;
  transition: background-color 0.2s;
}
.feedback-trigger button:hover {
  background: #e0e0e0;
}

.chat-input {
  display: flex;
  flex-direction: column;
  background: #fff;
  border-top: 1px solid #ddd;
  padding: 8px;
}

.prompt-textarea {
  flex: 1;
  resize: vertical;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 10px;
  font-size: 1rem;
  margin-bottom: 8px;
  max-height: 120px;
}

.file-upload-wrapper {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}

.file-upload-button {
  display: inline-block;
  padding: 6px 12px;
  background: #f0f0f0;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
}

.file-upload-button:hover {
  background: #e0e0e0;
}

.hidden-input {
  position: absolute;
  opacity: 0;
  width: 0.1px;
  height: 0.1px;
  overflow: hidden;
}

.file-preview {
  display: flex;
  align-items: center;
  margin-left: 10px;
  background: #f5f5f5;
  padding: 4px;
  border-radius: 4px;
}

.preview-img {
  max-width: 40px;
  max-height: 40px;
  border-radius: 3px;
}

.pdf-preview {
  padding: 4px 8px;
  font-size: 0.9rem;
}

.remove-file-btn {
  background: #ff5a5a;
  color: white;
  border: none;
  border-radius: 50%;
  width: 20px;
  height: 20px;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: 6px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.remove-file-btn:hover {
  background: #e04545;
}

.upload-progress {
  margin-bottom: 8px;
  display: flex;
  align-items: center;
}

.progress-bar {
  flex: 1;
  height: 6px;
  background: #eee;
  border-radius: 3px;
  overflow: hidden;
  margin-right: 8px;
}

.progress-fill {
  height: 100%;
  background: #4e97d1;
  transition: width 0.3s;
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
  transition: background-color 0.2s;
}

.send-btn:hover {
  background: #3a7da0;
}

.send-btn:disabled {
  background: #a0c8e0;
  cursor: not-allowed;
}

/* Responsive adjustments */
@media (min-width: 768px) {
  .chat-input {
    flex-direction: row;
    align-items: flex-end;
  }
  
  .prompt-textarea {
    margin-bottom: 0;
    margin-right: 8px;
  }
  
  .file-upload-wrapper {
    margin-bottom: 0;
    margin-right: 8px;
  }
  
  .upload-progress {
    margin-bottom: 0;
    margin-right: 8px;
    max-width: 150px;
  }
}
</style>
