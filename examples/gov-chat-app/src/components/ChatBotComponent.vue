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
          <button @click="openFeedback(index)">Feedback</button>
        </div>
      </div>
    </div>

    <div class="chat-input">
      <textarea
        v-model="newMessage"
        class="prompt-textarea"
        rows="3"
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
  </div>
</template>

<script>
import axios from 'axios'

export default {
  name: 'ChatBotComponent',
  data() {
    return {
      chatMessages: [],
      newMessage: '',
      selectedFile: null,
      filePreview: null
    }
  },
  computed: {
    isImagePreview() {
      return this.filePreview && this.filePreview.startsWith('blob:')
    }
  },
  watch: {
    chatMessages: {
      handler() {
        this.$nextTick(() => {
          const container = this.$refs.chatWindow
          if (container) {
            container.scrollTop = container.scrollHeight
          }
        })
      },
      deep: true
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
        // user message
        this.chatMessages.push({ sender: 'user', content })
      }
      this.newMessage = ''

      if (this.selectedFile) {
        const formData = new FormData()
        formData.append('file', this.selectedFile)
        axios.post('/api/upload', formData)
          .then(() => {
            this.chatMessages.push({ sender: 'bot', content: this.$t('chatbot.fileReceived') })
          })
          .catch(() => {
            this.chatMessages.push({ sender: 'bot', content: this.$t('chatbot.fileUploadError') })
          })
      }

      if (content) {
        axios.post('/api/chat', { message: content })
          .then(res => {
            this.chatMessages.push({ sender: 'bot', content: res.data.reply })
          })
          .catch(() => {
            this.chatMessages.push({ sender: 'bot', content: this.$t('chatbot.processingError') })
          })
      }

      this.removeFile()
    },
    openFeedback(index) {
      alert(`Feedback for message #${index}`)
    }
  }
}
</script>

<style scoped>
.chatbot-container {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}
.chat-window {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 10px;
  background: #fafafa;
}
.chat-message {
  margin-bottom: 8px;
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
}
.chat-message.user .message-bubble {
  background: #4e97d1;
  color: #fff;
}
.chat-message.bot .message-bubble {
  background: #e5e5ea;
  color: #000;
}
.message-bubble {
  padding: 8px 12px;
  border-radius: 16px;
  line-height: 1.4;
  max-width: 80%;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: break-word;
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

