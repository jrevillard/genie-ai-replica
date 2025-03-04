<template>
  <div class="feedback-panel">
    <div class="feedback-overlay" @click="closePanel"></div>
    <div class="feedback-content">
      <h4>Feedback</h4>
      <div class="feedback-options">
        <button @click="submitFeedback('up')">Ì†ΩÌ±ç</button>
        <button @click="submitFeedback('down')">Ì†ΩÌ±é</button>
      </div>
      <textarea v-model="feedbackText" placeholder="Additional comments..."></textarea>
      <button @click="submit">Submit Feedback</button>
      <button @click="closePanel">Close</button>
    </div>
  </div>
</template>

<script>
export default {
  name: 'FeedbackPanelComponent',
  data() {
    return {
      feedbackType: null,
      feedbackText: ''
    }
  },
  methods: {
    submitFeedback(type) {
      this.feedbackType = type
    },
    submit() {
      // Submit feedback to your backend
      console.log('Feedback submitted:', this.feedbackType, this.feedbackText)
      this.closePanel()
    },
    closePanel() {
      this.$emit('close')
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
}
.feedback-overlay {
  position: absolute;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
}
.feedback-content {
  position: relative;
  background: #fff;
  margin: 100px auto;
  padding: 20px;
  width: 300px;
  z-index: 10;
  border-radius: 8px;
}
.feedback-options button {
  margin-right: 10px;
  font-size: 18px;
}
.feedback-options button:hover {
  cursor: pointer;
}
textarea {
  width: 100%;
  margin: 10px 0;
  height: 60px;
}
</style>

