<template>
  <div v-if="visible" class="feedback-dialog">
    <div class="overlay" @click="closeDialog"></div>
    <div class="dialog-content">
      <h4>Help Us Improve</h4>
      <p class="note">
        Your feedback will be used to better tune the chatbot and improve responses over time.
      </p>

      <div class="message-preview">
        <strong>Chatbot Response:</strong>
        <div class="message-text">{{ message?.content }}</div>
      </div>

      <div class="rating-group">
        <label
          v-for="(label, index) in ratingLabels"
          :key="index"
          class="rating-option"
        >
          <input type="radio" :value="index + 1" v-model="selectedRating" />
          <span class="rating-number">{{ index + 1 }}</span>
          <span class="rating-label">{{ label }}</span>
        </label>
      </div>

      <textarea
        class="feedback-text"
        v-model="feedbackText"
        rows="4"
        placeholder="Additional comments..."
      ></textarea>

      <div class="actions">
        <button class="submit-btn" @click="submitFeedback">Submit</button>
        <button class="cancel-btn" @click="closeDialog">Cancel</button>
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
      feedbackText: '',
      ratingLabels: [
        'Useless',
        'Slightly Helpful',
        'Moderately Helpful',
        'Very Helpful',
        'Life Changing'
      ]
    }
  },
  methods: {
    closeDialog() {
      this.$emit('close')
    },
    submitFeedback() {
      this.$emit('submit', {
        rating: this.selectedRating,
        text: this.feedbackText,
        message: this.message
      })
      this.closeDialog()
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
}
.overlay {
  position: absolute;
  width: 100%; height: 100%;
  background: rgba(0,0,0,0.5);
}
.dialog-content {
  position: relative;
  background: #fff;
  width: 500px;
  max-width: 90%;
  margin: 80px auto;
  padding: 20px;
  border-radius: 8px;
}
.note {
  font-size: 0.9rem;
  margin-bottom: 10px;
}
.message-preview {
  margin-bottom: 16px;
}
.message-text {
  background: #f7f7f7;
  padding: 8px;
  border-radius: 4px;
  margin-top: 4px;
}
.rating-group {
  display: flex;
  flex-direction: column;
  margin-bottom: 12px;
}
.rating-option {
  display: flex;
  align-items: center;
  margin: 4px 0;
}
.rating-number {
  font-weight: bold;
  margin-right: 4px;
  width: 24px;
  display: inline-block;
}
.feedback-text {
  width: 100%;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 6px;
  font-size: 0.9rem;
  margin-bottom: 12px;
  resize: vertical;
}
.actions {
  text-align: right;
}
.submit-btn, .cancel-btn {
  padding: 8px 16px;
  border: none;
  cursor: pointer;
  border-radius: 4px;
  margin-left: 8px;
}
.submit-btn {
  background: #4E97D1;
  color: #fff;
}
.cancel-btn {
  background: #ccc;
  color: #333;
}
</style>

