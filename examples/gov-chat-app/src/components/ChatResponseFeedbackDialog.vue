<template>
  <div v-if="visible" class="feedback-dialog">
    <div class="overlay" @click="closeDialog"></div>
    <div class="dialog-content">
      <h4>{{ $t('responseRating.title') }}</h4>
      <p class="note">
        {{ $t('responseRating.note') }}
      </p>

      <div class="message-preview">
        <strong>{{ $t('responseRating.chatbotResponse') }}</strong>
        <div class="message-text">{{ message?.content }}</div>
      </div>

      <div class="rating-group">
        <label
          v-for="rating in 5"
          :key="rating"
          class="rating-option"
          :class="{ 'selected': selectedRating === rating }"
        >
          <input 
            type="radio" 
            :value="rating" 
            v-model="selectedRating" 
            :aria-label="getRatingLabel(rating)"
          />
          <span class="rating-number">{{ rating }}</span>
          <span class="rating-label">{{ getRatingLabel(rating) }}</span>
        </label>
      </div>

      <textarea
        class="feedback-text"
        v-model="feedbackText"
        rows="4"
        :placeholder="$t('responseRating.additionalComments')"
      ></textarea>

      <div class="actions">
        <button 
          class="submit-btn" 
          @click="submitFeedback"
          :disabled="!selectedRating"
        >
          {{ $t('responseRating.submit') }}
        </button>
        <button class="cancel-btn" @click="closeDialog">
          {{ $t('responseRating.cancel') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'ChatResponseFeedbackDialog',
  props: {
    visible: { type: Boolean, default: false },
    message: { type: Object, default: null }
  },
  data() {
    return {
      selectedRating: null,
      feedbackText: ''
    }
  },
  methods: {
    closeDialog() {
      this.selectedRating = null;
      this.feedbackText = '';
      this.$emit('close');
    },
    submitFeedback() {
      // Validate that a rating is selected
      if (!this.selectedRating) return;
      
      this.$emit('submit', {
        rating: this.selectedRating,
        text: this.feedbackText,
        message: this.message
      });
      
      this.closeDialog();
    },
    getRatingLabel(rating) {
      // Directly access translation data to avoid missing translation issues
      try {
        const locale = this.$i18n.locale;
        const label = this.$i18n.messages[locale]?.responseRating?.ratingLabels[rating];
        return label || `Rating ${rating}`;
      } catch (err) {
        console.error('Error getting rating label:', err);
        return `Rating ${rating}`;
      }
    }
  },
  // Focus management for accessibility
  mounted() {
    // Handle escape key press
    this.escHandler = (e) => {
      if (e.key === 'Escape' && this.visible) {
        this.closeDialog();
      }
    };
    document.addEventListener('keydown', this.escHandler);
    
    // Focus the first rating option when dialog opens
    this.$nextTick(() => {
      if (this.visible) {
        const firstRadio = this.$el.querySelector('input[type="radio"]');
        if (firstRadio) firstRadio.focus();
      }
    });
  },
  beforeDestroy() {
    document.removeEventListener('keydown', this.escHandler);
  },
  watch: {
    visible(newVal) {
      if (newVal) {
        // Reset state when dialog is opened
        this.selectedRating = null;
        this.feedbackText = '';
        
        // Focus management
        this.$nextTick(() => {
          const firstRadio = this.$el.querySelector('input[type="radio"]');
          if (firstRadio) firstRadio.focus();
        });
      }
    }
  }
}
</script>

<style scoped>
.feedback-dialog {
  position: fixed;
  top: 0; left: 0;
  width: 100%; height: 100%;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
}
.overlay {
  position: absolute;
  width: 100%; height: 100%;
  background: rgba(0,0,0,0.5);
  backdrop-filter: blur(2px);
}
.dialog-content {
  position: relative;
  background: #fff;
  width: 500px;
  max-width: 90%;
  margin: 0 auto;
  padding: 24px;
  border-radius: 12px;
  box-shadow: 0 4px 25px rgba(0,0,0,0.2);
}
h4 {
  margin: 0 0 12px;
  font-size: 22px;
  color: #333;
  text-align: center;
}
.note {
  font-size: 0.9rem;
  margin-bottom: 16px;
  color: #555;
  text-align: center;
}
.message-preview {
  margin-bottom: 20px;
}
.message-text {
  background: #f7f7f7;
  padding: 12px;
  border-radius: 8px;
  margin-top: 4px;
  max-height: 150px;
  overflow-y: auto;
  font-size: 0.95rem;
  color: #444;
  border-left: 3px solid #e0e0e0;
}
.rating-group {
  display: flex;
  flex-direction: column;
  margin-bottom: 16px;
  gap: 8px;
}
.rating-option {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}
.rating-option:hover {
  background-color: #f5f5f5;
  border-color: #d0d0d0;
}
.rating-option.selected {
  background-color: #f0f7ff;
  border-color: #4a90e2;
}
.rating-option input {
  position: absolute;
  opacity: 0;
  cursor: pointer;
  height: 0;
  width: 0;
}
.rating-number {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: #e8e8e8;
  border-radius: 50%;
  margin-right: 12px;
  font-weight: bold;
  color: #555;
  transition: all 0.2s ease;
}
.rating-option.selected .rating-number {
  background: #4a90e2;
  color: white;
}
.rating-label {
  font-weight: 500;
  color: #444;
}
.rating-option.selected .rating-label {
  color: #4a90e2;
}
.feedback-text {
  width: 100%;
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 10px;
  font-size: 0.95rem;
  margin-bottom: 20px;
  resize: vertical;
  min-height: 80px;
  font-family: inherit;
}
.feedback-text:focus {
  outline: none;
  border-color: #4a90e2;
}
.actions {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.submit-btn, .cancel-btn {
  padding: 10px 16px;
  border: none;
  cursor: pointer;
  border-radius: 6px;
  font-weight: 500;
  transition: all 0.2s ease;
}
.submit-btn {
  background: #4a90e2;
  color: #fff;
  flex: 2;
}
.submit-btn:hover:not(:disabled) {
  background: #3a7bc8;
}
.submit-btn:disabled {
  background: #b3d1f5;
  cursor: not-allowed;
}
.cancel-btn {
  background: #f0f0f0;
  color: #555;
  flex: 1;
}
.cancel-btn:hover {
  background: #e0e0e0;
}

/* Responsive adjustments */
@media (max-width: 480px) {
  .dialog-content {
    padding: 16px;
  }
  
  h4 {
    font-size: 18px;
  }
  
  .actions {
    flex-direction: column;
  }
  
  .submit-btn, .cancel-btn {
    width: 100%;
  }
}
</style>
