<template>
  <div v-if="visible" class="feedback-dialog">
    <div class="overlay" @click="closeDialog"></div>
    <div class="dialog-content">
      <!-- Two-column layout for more compact appearance -->
      <div class="dialog-header">
        <h4>{{ $t('responseRating.title') }}</h4>
        <p class="note">
          {{ $t('responseRating.note') }}
        </p>
      </div>

      <div class="dialog-layout">
        <!-- Left column -->
        <div class="dialog-column">
          <div class="message-preview">
            <strong>{{ $t('responseRating.chatbotResponse') }}</strong>
            <div class="message-text">{{ message?.content }}</div>
          </div>

          <!-- Thumbs up/down options with SVG icons and skin tone -->
          <div class="thumbs-container">
            <button
              class="thumb-button"
              :class="{ selected: thumbFeedback === 'up' }"
              :aria-label="$t('feedback.positive')"
              @click="selectThumbFeedback('up')"
            >
              <!-- SVG Thumbs Up with skin tone fill -->
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="thumb-icon"
              >
                <path d="M7 10v12" stroke-width="2" fill="none" />
                <path
                  d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z"
                  :fill="thumbFeedback === 'up' ? skinToneColor : 'none'"
                />
              </svg>
              <span class="thumb-label">{{ $t('feedback.positive') }}</span>
            </button>

            <button
              class="thumb-button"
              :class="{ selected: thumbFeedback === 'down' }"
              :aria-label="$t('feedback.negative')"
              @click="selectThumbFeedback('down')"
            >
              <!-- SVG Thumbs Down with skin tone fill -->
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="thumb-icon"
              >
                <path d="M17 14V2" stroke-width="2" fill="none" />
                <path
                  d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22h0a3.13 3.13 0 0 1-3-3.88Z"
                  :fill="thumbFeedback === 'down' ? skinToneColor : 'none'"
                />
              </svg>
              <span class="thumb-label">{{ $t('feedback.negative') }}</span>
            </button>
          </div>

          <!-- Skin tone selector (more compact) -->
          <div class="skin-tone-selector">
            <div class="skin-tone-options">
              <button
                v-for="(color, index) in skinTones"
                :key="index"
                class="skin-tone-button"
                :class="{ selected: skinToneColor === color }"
                :style="{ backgroundColor: color }"
                :aria-label="`Skin tone ${index + 1}`"
                @click="skinToneColor = color"
              ></button>
            </div>
          </div>
        </div>

        <!-- Right column -->
        <div class="dialog-column">
          <!-- Rating scale section -->
          <p class="rating-title">{{ $t('feedback.promptText') }}</p>
          <div class="rating-group">
            <label
              v-for="rating in 5"
              :key="rating"
              class="rating-option"
              :class="{ selected: selectedRating === rating }"
            >
              <input v-model="selectedRating" type="radio" :value="rating" :aria-label="getRatingLabel(rating)" />
              <span class="rating-number">{{ rating }}</span>
              <span class="rating-label">{{ getRatingLabel(rating) }}</span>
            </label>
          </div>

          <textarea
            v-model="feedbackText"
            class="feedback-text"
            rows="3"
            :placeholder="$t('responseRating.additionalComments')"
          ></textarea>
        </div>
      </div>

      <div class="actions">
        <DsButton variant="primary" :disabled="!(selectedRating || thumbFeedback)" @click="submitFeedback">
          {{ $t('responseRating.submit') }}
        </DsButton>
        <DsButton variant="secondary" @click="closeDialog">
          {{ $t('responseRating.cancel') }}
        </DsButton>
      </div>
    </div>
  </div>
</template>

<script>
import DsButton from './ds/Button.vue';

export default {
  name: 'ChatResponseFeedbackDialog',
  components: {
    DsButton
  },
  props: {
    visible: { type: Boolean, default: false },
    message: { type: Object, default: null }
  },
  emits: ['close', 'submit'],
  data() {
    return {
      selectedRating: null,
      thumbFeedback: null,
      feedbackText: '',
      skinToneColor: '#FFCBA4', // Default skin tone
      skinTones: [
        '#FFDBAC', // Light skin tone
        '#F1C27D', // Medium-light skin tone
        '#E0AC69', // Medium skin tone
        '#C68642', // Medium-dark skin tone
        '#8D5524' // Dark skin tone
      ]
    };
  },
  watch: {
    visible(newVal) {
      if (newVal) {
        // Reset state when dialog is opened
        this.selectedRating = null;
        this.thumbFeedback = null;
        this.feedbackText = '';

        // Focus management
        this.$nextTick(() => {
          const firstButton = this.$el.querySelector('.thumb-button');
          if (firstButton) firstButton.focus();
        });
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

    // Focus the first thumbs button when dialog opens
    this.$nextTick(() => {
      if (this.visible) {
        const firstButton = this.$el.querySelector('.thumb-button');
        if (firstButton) firstButton.focus();
      }
    });
  },
  beforeUnmount() {
    document.removeEventListener('keydown', this.escHandler);
  },
  methods: {
    closeDialog() {
      this.selectedRating = null;
      this.thumbFeedback = null;
      this.feedbackText = '';
      this.$emit('close');
    },
    selectThumbFeedback(type) {
      this.thumbFeedback = type;

      // Auto-set rating based on thumb selection (optional)
      if (type === 'up') {
        this.selectedRating = 4; // Default "up" to a 4 rating
      } else if (type === 'down') {
        this.selectedRating = 2; // Default "down" to a 2 rating
      }
    },
    submitFeedback() {
      // Validate that either a rating or thumb feedback is selected
      if (!this.selectedRating && !this.thumbFeedback) return;

      this.$emit('submit', {
        rating: this.selectedRating,
        thumbFeedback: this.thumbFeedback,
        skinTone: this.skinToneColor,
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
  }
};
</script>

<style scoped>
/* Dialog container */
.feedback-dialog {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: dialogFadeIn 0.2s ease-out;
}

.overlay {
  position: absolute;
  width: 100%;
  height: 100%;
  background: var(--overlay-bg);
  backdrop-filter: blur(2px);
}

.dialog-content {
  position: relative;
  background: var(--surface);
  width: 700px;
  max-width: 90%;
  max-height: 90vh;
  margin: 0 auto;
  padding: var(--space-lg);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  overflow-y: auto;
}

.dialog-header {
  margin-bottom: var(--space-md);
}

h4 {
  margin: 0 0 var(--space-sm);
  font-size: var(--text-lg);
  color: var(--fg);
  text-align: center;
}

.note {
  font-size: var(--text-base);
  margin-bottom: 0;
  color: var(--muted);
  text-align: center;
}

/* Two-column layout */
.dialog-layout {
  display: flex;
  gap: var(--space-lg);
  margin-bottom: var(--space-md);
}

.dialog-column {
  flex: 1;
  min-width: 0;
}

.message-preview {
  margin-bottom: var(--space-md);
}

.message-text {
  background: var(--bg);
  padding: var(--space-sm);
  border-radius: var(--radius-lg);
  margin-top: var(--space-xs);
  max-height: 120px;
  overflow-y: auto;
  font-size: var(--text-base);
  color: var(--muted);
  border-left: 3px solid var(--border-light);
}

/* Thumbs up/down section */
.thumbs-container {
  display: flex;
  justify-content: space-between;
  gap: var(--space-sm);
  margin-bottom: var(--space-sm);
}

.thumb-button {
  background: var(--accent-muted);
  border: 2px solid var(--border-light);
  border-radius: var(--radius-lg);
  padding: var(--space-sm);
  flex: 1;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  flex-direction: column;
  align-items: center;
  color: var(--muted);
}

.thumb-button .thumb-icon {
  margin-bottom: var(--space-xs);
  color: var(--muted);
  transition: all 0.2s ease;
}

.thumb-button .thumb-label {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--muted);
}

.thumb-button:hover {
  border-color: var(--border-light);
  transform: translateY(-2px);
  box-shadow: var(--shadow-sm);
}

.thumb-button.selected {
  border-color: var(--accent);
  background-color: var(--accent-muted);
}

.thumb-button.selected .thumb-icon {
  color: var(--accent);
}

.thumb-button.selected .thumb-label {
  color: var(--muted);
}

/* Skin tone selector */
.skin-tone-selector {
  display: flex;
  justify-content: center;
  margin-bottom: var(--space-sm);
}

.skin-tone-options {
  display: flex;
  justify-content: center;
  gap: var(--space-sm);
}

.skin-tone-button {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid var(--border-light);
  padding: 0;
  cursor: pointer;
  transition: all 0.2s ease;
}

.skin-tone-button:hover {
  transform: scale(1.1);
}

.skin-tone-button.selected {
  border-color: var(--accent);
  transform: scale(1.1);
  box-shadow: 0 0 0 2px var(--accent-muted);
}

/* Rating section */
.rating-title {
  font-weight: 500;
  color: var(--muted);
  margin: 0 0 var(--space-sm);
}

.rating-group {
  display: flex;
  flex-direction: column;
  margin-bottom: var(--space-md);
  gap: var(--space-sm);
}

.rating-option {
  display: flex;
  align-items: center;
  padding: var(--space-sm) var(--space-sm);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: all 0.2s ease;
}

.rating-option:hover {
  background-color: var(--bg);
  border-color: var(--border-light);
}

.rating-option.selected {
  background-color: var(--accent-muted);
  border-color: var(--accent);
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
  width: 28px;
  height: 28px;
  background: var(--border-light);
  border-radius: 50%;
  margin-right: var(--space-sm);
  font-weight: bold;
  color: var(--muted);
  transition: all 0.2s ease;
}

.rating-option.selected .rating-number {
  background: var(--accent);
  color: var(--accent-fg);
}

.rating-label {
  font-weight: 500;
  color: var(--muted);
  font-size: var(--text-base);
}

.feedback-text {
  width: 100%;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  padding: var(--space-sm);
  font-size: var(--text-base);
  height: 80px;
  resize: vertical;
  font-family: inherit;
  background: var(--surface);
  color: var(--fg);
}

.feedback-text:focus {
  outline: none;
  border-color: var(--accent);
}

/* Actions */
.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
}

.submit-btn {
}

/* Responsive adjustments */
@media (max-width: 768px) {
  .dialog-layout {
    flex-direction: column;
    gap: var(--space-md);
  }

  .dialog-content {
    padding: var(--space-md);
    max-height: 90vh;
  }

  h4 {
    font-size: var(--text-lg);
    margin-bottom: var(--space-sm);
  }

  .thumbs-container {
    flex-direction: row;
  }

  .thumb-button {
    flex-direction: row;
    align-items: center;
    justify-content: flex-start;
    padding: var(--space-sm) var(--space-md);
  }

  .thumb-button .thumb-icon {
    margin-right: var(--space-sm);
    margin-bottom: 0;
  }

  .feedback-text {
    height: 60px;
  }
}

@keyframes dialogFadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
