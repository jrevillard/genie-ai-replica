<template>
  <div class="feedback-panel">
    <div class="feedback-overlay" @click="closePanel"></div>
    <div class="feedback-content">
      <h4>{{ $t('feedback.title') }}</h4>
      <div class="feedback-options">
        <button 
          @click="submitFeedback('up')" 
          class="feedback-button" 
          :class="{ 'selected': feedbackType === 'up' }"
          :aria-label="$t('feedback.positive')"
        >
          Ì†ΩÌ±ç
        </button>
        <button 
          @click="submitFeedback('down')" 
          class="feedback-button"
          :class="{ 'selected': feedbackType === 'down' }"
          :aria-label="$t('feedback.negative')"
        >
          Ì†ΩÌ±é
        </button>
      </div>
      <p class="feedback-prompt">{{ $t('feedback.promptText') }}</p>
      <textarea 
        v-model="feedbackText" 
        :placeholder="$t('feedback.placeholder')"
        class="feedback-textarea"
      ></textarea>
      <div class="button-group">
        <button 
          @click="submit" 
          class="submit-button" 
          :disabled="!feedbackType"
        >
          {{ $t('feedback.submit') }}
        </button>
        <button 
          @click="closePanel" 
          class="cancel-button"
        >
          {{ $t('feedback.close') }}
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
  name: 'FeedbackPanelComponent',
  data() {
    return {
      feedbackType: null,
      feedbackText: '',
      submissionStatus: null
    }
  },
  methods: {
    submitFeedback(type) {
      this.feedbackType = type;
    },
    submit() {
      if (!this.feedbackType) return;
      
      // Display loading state
      this.submissionStatus = {
        type: 'loading',
        message: this.$t('feedback.submitting')
      };
      
      // Simulate API call with a timeout (replace with actual API call)
      setTimeout(() => {
        // Log feedback (for development)
        console.log('Feedback submitted:', this.feedbackType, this.feedbackText);
        
        // Success status
        this.submissionStatus = {
          type: 'success',
          message: this.$t('feedback.thankYouMessage')
        };
        
        // Emit event with feedback data
        this.$emit('submit', {
          type: this.feedbackType,
          text: this.feedbackText,
          timestamp: new Date().toISOString(),
          locale: this.$i18n.locale
        });
        
        // Close after showing success message
        setTimeout(() => {
          this.closePanel();
        }, 1500);
      }, 600);
    },
    closePanel() {
      this.$emit('close');
    }
  },
  // Add focus trap and escape key handler
  mounted() {
    // Handle escape key press
    this.escHandler = (e) => {
      if (e.key === 'Escape') {
        this.closePanel();
      }
    };
    document.addEventListener('keydown', this.escHandler);
    
    // Focus trap (accessibility)
    this.$nextTick(() => {
      this.$el.querySelector('.feedback-button').focus();
    });
  },
  beforeDestroy() {
    document.removeEventListener('keydown', this.escHandler);
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
  width: 350px;
  max-width: 90%;
  z-index: 10;
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}

.feedback-options {
  display: flex;
  justify-content: center;
  margin: 20px 0;
  gap: 24px;
}

.feedback-button {
  background: none;
  border: 2px solid #e0e0e0;
  border-radius: 50%;
  width: 60px;
  height: 60px;
  font-size: 28px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.feedback-button:hover {
  border-color: #bbbbbb;
  transform: scale(1.05);
}

.feedback-button.selected {
  border-color: #4a90e2;
  background-color: #f0f7ff;
}

.feedback-prompt {
  text-align: center;
  margin-bottom: 16px;
  color: #555;
}

.feedback-textarea {
  width: 100%;
  margin: 10px 0 20px;
  height: 80px;
  padding: 10px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  resize: vertical;
  font-family: inherit;
}

.feedback-textarea:focus {
  border-color: #4a90e2;
  outline: none;
}

.button-group {
  display: flex;
  justify-content: space-between;
}

.submit-button, .cancel-button {
  padding: 10px 16px;
  border-radius: 6px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
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

h4 {
  margin: 0 0 10px;
  text-align: center;
  font-size: 20px;
  color: #333;
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
  }
  
  .feedback-button {
    width: 50px;
    height: 50px;
    font-size: 24px;
  }
  
  .button-group {
    flex-direction: column;
    gap: 10px;
  }
  
  .submit-button, .cancel-button {
    width: 100%;
  }
}
</style>
