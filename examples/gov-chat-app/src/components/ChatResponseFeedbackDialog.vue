<template>
  <div v-if="visible" class="feedback-panel">
    <div class="feedback-overlay" @click="closePanel"></div>
    <div class="feedback-content">
      <div class="feedback-header">
        <h2>{{ $t('feedback.title') }}</h2>
        <p class="feedback-description">{{ $t('feedback.description') }}</p>
      </div>

      <div class="chatbot-response">
        <h3>{{ $t('feedback.chatbotResponse') }}</h3>
        <div class="response-box">
          <p>{{ message.content }}</p>
        </div>
      </div>

      <div class="rating-container">
        <div class="rating-options">
          <div 
            v-for="rating in 5" 
            :key="rating" 
            class="rating-option"
            :class="{ 'selected': selectedRating === rating }"
            @click="selectedRating = rating"
          >
            <input 
              type="radio" 
              :id="`rating-${rating}`" 
              name="rating" 
              :value="rating" 
              v-model="selectedRating"
            >
            <label :for="`rating-${rating}`" class="rating-label">
              <span class="rating-number">{{ rating }}</span>
              <span class="rating-text">{{ $t(`feedback.ratingLabels.${rating}`) }}</span>
            </label>
          </div>
        </div>
      </div>

      <div class="comment-section">
        <textarea 
          v-model="commentText" 
          :placeholder="$t('feedback.placeholder')"
          class="comment-textarea"
          rows="4"
        ></textarea>
      </div>

      <div class="feedback-actions">
        <button 
          @click="submit" 
          class="submit-button" 
          :disabled="!isValid"
        >
          {{ $t('feedback.submit') }}
        </button>
        <button 
          @click="closePanel" 
          class="cancel-button"
        >
          {{ $t('feedback.cancel') }}
        </button>
      </div>
      
      <!-- Submission status message -->
      <div v-if="submissionStatus" class="submission-status" :class="submissionStatus.type">
        {{ submissionStatus.message }}
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'ChatResponseFeedbackDialog',
  props: {
    visible: {
      type: Boolean,
      default: false
    },
    message: {
      type: Object,
      default: () => ({})
    }
  },
  data() {
    return {
      selectedRating: null,
      commentText: '',
      submissionStatus: null
    }
  },
  computed: {
    isValid() {
      return this.selectedRating !== null;
    }
  },
  methods: {
    submit() {
      if (!this.isValid) return;
      
      // Display loading state
      this.submissionStatus = {
        type: 'loading',
        message: this.$t('feedback.submitting')
      };
      
      // Prepare feedback data
      const feedbackData = {
        rating: this.selectedRating,
        comment: this.commentText,
        timestamp: new Date().toISOString(),
        locale: this.$i18n.locale
      };
      
      // Simulate API call with a timeout (replace with actual API call)
      setTimeout(() => {
        // Success status
        this.submissionStatus = {
          type: 'success',
          message: this.$t('feedback.thankYouMessage')
        };
        
        // Emit event with feedback data
        this.$emit('submit', feedbackData);
        
        // Close after showing success message
        setTimeout(() => {
          this.reset();
          this.closePanel();
        }, 1500);
      }, 600);
    },
    closePanel() {
      this.reset();
      this.$emit('close');
    },
    reset() {
      this.selectedRating = null;
      this.commentText = '';
      this.submissionStatus = null;
    }
  },
  // Handle escape key and set initial focus
  mounted() {
    if (this.visible) {
      this.escHandler = (e) => {
        if (e.key === 'Escape') {
          this.closePanel();
        }
      };
      document.addEventListener('keydown', this.escHandler);
    }
  },
  beforeDestroy() {
    document.removeEventListener('keydown', this.escHandler);
  },
  watch: {
    visible(newVal) {
      if (newVal) {
        // When dialog becomes visible
        this.$nextTick(() => {
          document.addEventListener('keydown', this.escHandler);
          const firstRating = document.getElementById('rating-1');
          if (firstRating) firstRating.focus();
        });
      } else {
        // When dialog is hidden
        document.removeEventListener('keydown', this.escHandler);
      }
    }
  }
}
</script>

<style scoped>
.feedback-panel {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}

.feedback-overlay {
  position: absolute;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(2px);
}

.feedback-content {
  position: relative;
  background: #fff;
  padding: 24px;
  width: 480px;
  max-width: 90%;
  max-height: 90vh;
  overflow-y: auto;
  z-index: 10;
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.feedback-header {
  text-align: center;
}

.feedback-header h2 {
  margin: 0 0 8px;
  font-size: 22px;
  color: #333;
}

.feedback-description {
  color: #666;
  margin: 0;
  font-size: 14px;
}

.chatbot-response {
  background: #f5f7fa;
  border-radius: 8px;
  padding: 12px;
}

.chatbot-response h3 {
  margin: 0 0 8px;
  font-size: 16px;
  color: #555;
}

.response-box {
  background: white;
  border-radius: 6px;
  padding: 12px;
  border: 1px solid #eee;
}

.response-box p {
  margin: 0;
  color: #333;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.rating-container {
  margin-top: 10px;
}

.rating-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rating-option {
  display: flex;
  align-items: center;
  padding: 8px;
  border-radius: 8px;
  transition: background-color 0.2s;
  cursor: pointer;
}

.rating-option:hover {
  background-color: #f0f7ff;
}

.rating-option.selected {
  background-color: #e3f2fd;
  border: 1px solid #4a90e2;
}

.rating-option input {
  position: absolute;
  opacity: 0;
  cursor: pointer;
  height: 0;
  width: 0;
}

.rating-label {
  display: flex;
  align-items: center;
  width: 100%;
  cursor: pointer;
}

.rating-number {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: #eee;
  color: #555;
  font-weight: bold;
  margin-right: 12px;
}

.selected .rating-number {
  background: #4a90e2;
  color: white;
}

.rating-text {
  font-size: 15px;
  color: #333;
}

.comment-section {
  margin-top: 10px;
}

.comment-textarea {
  width: 100%;
  padding: 10px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  resize: vertical;
  font-family: inherit;
  font-size: 14px;
}

.comment-textarea:focus {
  border-color: #4a90e2;
  outline: none;
}

.feedback-actions {
  display: flex;
  justify-content: space-between;
  margin-top: 15px;
}

.submit-button, .cancel-button {
  padding: 10px 16px;
  border-radius: 6px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
  min-width: 100px;
}

.submit-button {
  background-color: #4a90e2;
  color: white;
}

.submit-button:hover:not(:disabled) {
  background-color: #3a80d2;
}

.submit-button:disabled {
  background-color: #a0c5f0;
  cursor: not-allowed;
}

.cancel-button {
  background-color: #f5f5f5;
  color: #555;
}

.cancel-button:hover {
  background-color: #e5e5e5;
}

/* Submission status styling */
.submission-status {
  margin-top: 16px;
  padding: 8px 12px;
  border-radius: 6px;
  text-align: center;
  font-size: 14px;
  animation: fadeIn 0.3s ease;
}

.submission-status.loading {
  background-color: #f5f9ff;
  color: #4a90e2;
}

.submission-status.success {
  background-color: #e8f5e9;
  color: #2e7d32;
}

.submission-status.error {
  background-color: #fef2f2;
  color: #ef4444;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(5px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Responsive adjustments */
@media (max-width: 480px) {
  .feedback-content {
    padding: 20px;
    gap: 15px;
  }
  
  .feedback-actions {
    flex-direction: column;
    gap: 10px;
  }
  
  .submit-button, .cancel-button {
    width: 100%;
  }
  
  .rating-options {
    gap: 5px;
  }
}
</style>
