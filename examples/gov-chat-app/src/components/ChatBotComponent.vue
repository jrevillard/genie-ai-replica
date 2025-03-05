<!-- ChatBotComponent.vue -->
<template>
  <div class="chatbot-container">
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
          <button @click="openFeedbackDialog(index)">Feedback</button>
        </div>
      </div>
    </div>

    <div class="chat-input">
      <textarea
        v-model="newMessage"
        class="prompt-textarea"
        rows="4"
        :placeholder="$t('chatbot.placeholder')"
        @keyup.enter.exact.prevent="sendMessage"
      ></textarea>

      <div class="file-upload-wrapper">
        <input type="file" accept="image/*,.pdf" @change="onFileSelected" />
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
          <button @click="removeFile">x</button>
        </div>
      </div>

      <button class="send-btn" @click="sendMessage">{{ $t('chatbot.sendButton') }}</button>
    </div>

    <!-- Feedback dialog, etc. -->
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
      feedbackDialog: {
        visible: false,
        message: null
      }
    }
  },
  computed: {
    isImagePreview() {
      return this.filePreview && this.filePreview.startsWith('blob:')
    }
  },
  mounted() {
    this.scrollToBottom()
  },
  watch: {
    chatMessages() {
      this.scrollToBottom()
    }
  },
  methods: {
    onFileSelected(e) {
      const file = e.target.files[0]
      if (!file) return
      this.selectedFile = file

      if (file.type.includes('image')) {
        this.filePreview = URL.createObjectURL(file)
      } else if (file.type === 'application/pdf') {
        this.filePreview = 'pdf'
      }
    },
    removeFile() {
      this.selectedFile = null
      this.filePreview = null
    },
    sendMessage() {
      const content = this.newMessage.trim()
      if (content) {
        this.chatMessages.push({ sender: 'user', content })
      }
      this.newMessage = ''

      if (this.selectedFile) {
        const formData = new FormData()
        formData.append('file', this.selectedFile)
        axios.post('/api/upload', formData)
          .then(() => {
            this.chatMessages.push({
              sender: 'bot',
              content: this.$t('chatbot.fileReceived')
            })
          })
          .catch(() => {
            this.chatMessages.push({
              sender: 'bot',
              content: this.$t('chatbot.fileUploadError')
            })
          })
      }

      if (content) {
        axios.post('/api/chat', { message: content })
          .then(res => {
            this.chatMessages.push({ sender: 'bot', content: res.data.reply })
          })
          .catch(() => {
            this.chatMessages.push({
              sender: 'bot',
              content: this.$t('chatbot.processingError')
            })
          })
      }

      this.removeFile()
    },
    openFeedbackDialog(index) {
      const botMessage = this.chatMessages[index]
      this.feedbackDialog.visible = true
      this.feedbackDialog.message = botMessage
    },
    handleFeedbackSubmit(feedback) {
      console.log('Feedback submitted:', feedback)
      // e.g. axios.post('/api/feedback', feedback)
    },
    scrollToBottom() {
      this.$nextTick(() => {
        // short delay so images, PDFs, etc. can size
        setTimeout(() => {
          const container = this.$refs.chatWindow
          if (container) {
            container.scrollTop = container.scrollHeight
          }
        }, 100)
      })
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
}

.chat-message {
  margin-bottom: 8px;
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
  background: #ccc;
  border: none;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  margin-top: 4px;
}
.feedback-trigger button:hover {
  background: #bbb;
}

.chat-input {
  display: flex;
  background: #fff;
  border-top: 1px solid #ccc;
  padding: 8px;
}
.prompt-textarea {
  flex: 1;
  resize: vertical;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 6px;
  font-size: 1rem;
  margin-right: 8px;
}
.file-upload-wrapper {
  position: relative;
  margin-right: 8px;
}
.file-preview {
  display: flex;
  align-items: center;
  margin-top: 4px;
}
.preview-img {
  max-width: 40px;
  max-height: 40px;
  margin-right: 4px;
}
.pdf-preview {
  background: #f0f0f0;
  padding: 4px 8px;
  margin-right: 4px;
}
.send-btn {
  background: #4e97d1;
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
}
.send-btn:hover {
  background: #3a7da0;
}
</style>

