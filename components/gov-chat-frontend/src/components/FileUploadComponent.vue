<template>
  <DsButton variant="ghost" class="icon-btn">
    <img src="/icons/upload.svg" :alt="translate('upload.alt', 'Upload')" />
    <input type="file" @change="onFileChange" />
  </DsButton>
</template>

<script>
import DsButton from './ds/Button.vue';

export default {
  name: 'FileUploadComponent',
  components: {
    DsButton
  },
  emits: ['fileUploaded'],
  methods: {
    /**
     * ADDED: Uses this.$i18n.t() for translation, matching AdminDashboard.vue
     */
    translate(key, fallback) {
      // Check if $i18n is available
      if (this.$i18n && this.$i18n.t) {
        const translation = this.$i18n.t(key);
        // Fallback if key is not found
        if (translation === key) {
          return fallback || key;
        }
        return translation;
      }
      // Fallback if $i18n is not configured
      return fallback || key;
    },
    onFileChange(e) {
      const file = e.target.files[0];
      if (file) {
        this.$emit('fileUploaded', file);
      }
    }
  }
};
</script>

<style scoped>
.icon-btn {
  position: relative;
  padding: var(--space-sm);
}

.icon-btn input[type='file'] {
  position: absolute;
  opacity: 0;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  cursor: pointer;
}
</style>
