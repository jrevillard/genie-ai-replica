<template>
  <button class="icon-btn">
    <img src="/icons/upload.svg" alt="Upload" />
    <input type="file" @change="onFileChange" />
  </button>
</template>

<script>
export default {
  name: 'FileUploadComponent',
  methods: {
    onFileChange(e) {
      const file = e.target.files[0]
      if (file) {
        this.$emit('fileUploaded', file)
      }
    }
  }
}
</script>

<style scoped>
.icon-btn {
  position: relative;
  padding: 6px;
  border: none;
  background: transparent;
  cursor: pointer;
}

.icon-btn input[type="file"] {
  position: absolute;
  opacity: 0;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  cursor: pointer;
}
</style>

