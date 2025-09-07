<template>
  <div class="dialog-backdrop" @click="$emit('close')"></div>
  <div class="dialog-container">
    <div class="dialog-header">
      <h2 class="dialog-title">
        {{ translate("upload.title", "Upload Files") }}
      </h2>
      <button
        class="dialog-close-btn"
        @click="$emit('close')"
        :aria-label="translate('upload.close', 'Close')"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>

    <div class="dialog-body">
      <div
        class="drop-zone"
        @dragover.prevent="onDragOver"
        @dragleave.prevent="onDragLeave"
        @drop.prevent="handleDrop"
        @click="openFileDialog"
        :class="{ 'drag-over': isDragging }"
      >
        <input
          type="file"
          ref="fileInput"
          @change="handleFileSelect"
          multiple
          hidden
        />
        <p>
          {{
            translate(
              "upload.dropzone",
              "Drag & drop files here, or click to select"
            )
          }}
        </p>
      </div>

      <div class="file-list-container" v-if="files.length > 0">
        <ul class="file-list">
          <li v-for="(file, index) in files" :key="index" class="file-item">
            <span class="file-name">{{ file.name }}</span>
            <span class="file-size">{{ formatFileSize(file.size) }}</span>
            <button class="remove-file-btn" @click="removeFile(index)">
              {{ translate("upload.remove", "Remove") }}
            </button>
          </li>
        </ul>
      </div>
    </div>

    <div class="dialog-footer">
      <button class="btn btn-outline" @click="$emit('close')">
        {{ translate("buttons.cancel", "Cancel") }}
      </button>
      <button
        class="btn btn-primary"
        @click="handleUpload"
        :disabled="files.length === 0 || isUploading"
      >
        <span v-if="isUploading">{{
          translate("upload.uploading", "Uploading...")
        }}</span>
        <span v-else>{{
          translate("upload.uploadAll", `Upload ${files.length} File(s)`)
        }}</span>
      </button>
    </div>
  </div>
</template>
  
  <script>
export default {
  name: "UploadFilesDialog",
  emits: ["close", "files-uploaded"],
  data() {
    return {
      files: [],
      isDragging: false,
      isUploading: false,
    };
  },
  methods: {
    translate(key, fallback) {
      // In a real app, this would use your i18n library
      return fallback || key;
    },
    openFileDialog() {
      this.$refs.fileInput.click();
    },
    handleFileSelect(event) {
      this.addFiles([...event.target.files]);
    },
    handleDrop(event) {
      this.isDragging = false;
      this.addFiles([...event.dataTransfer.files]);
    },
    addFiles(newFiles) {
      // Prevent duplicates
      newFiles.forEach((file) => {
        if (
          !this.files.some((f) => f.name === file.name && f.size === file.size)
        ) {
          this.files.push(file);
        }
      });
    },
    removeFile(index) {
      this.files.splice(index, 1);
    },
    onDragOver() {
      this.isDragging = true;
    },
    onDragLeave() {
      this.isDragging = false;
    },
    formatFileSize(bytes) {
      if (bytes === 0) return "0 Bytes";
      const k = 1024;
      const sizes = ["Bytes", "KB", "MB", "GB"];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    },
    async handleUpload() {
      this.isUploading = true;
      // In a real app, you would use FormData and an HTTP client like Axios
      // to POST to /api/files/uploads
      console.log(`Simulating upload for ${this.files.length} files...`);

      // Simulate API call delay
      setTimeout(() => {
        this.isUploading = false;
        console.log("Upload successful.");
        this.$emit(
          "files-uploaded",
          this.files.map((f) => f.name)
        );
        this.$emit("close");
      }, 2000);
    },
  },
};
</script>
  
  <style scoped>
/* Using a consistent dialog style */
.dialog-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  z-index: 1050;
}
.dialog-container {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 90%;
  max-width: 600px;
  background-color: var(--bg-dialog, #fff);
  border-radius: 8px;
  box-shadow: var(--shadow-lg);
  z-index: 1051;
  display: flex;
  flex-direction: column;
  max-height: 80vh;
}
.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--border-color, #e2e8f0);
}
.dialog-title {
  font-size: 1.25rem;
  color: var(--text-primary, #333);
}
.dialog-close-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-secondary);
}
.dialog-body {
  padding: 1.5rem;
  overflow-y: auto;
}
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--border-color, #e2e8f0);
}
.btn {
  padding: 0.6rem 1rem;
  border-radius: 0.375rem;
  border: none;
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.2s;
}
.btn-primary {
  background-color: #3b82f6;
  color: white;
}
.btn-primary:hover {
  background-color: #2563eb;
}
.btn-primary:disabled {
  background-color: #9ca3af;
  cursor: not-allowed;
}
.btn-outline {
  background-color: transparent;
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
}
.btn-outline:hover {
  background-color: var(--bg-section);
}

/* Component-specific styles */
.drop-zone {
  border: 2px dashed var(--border-color, #d1d5db);
  border-radius: 8px;
  padding: 2rem;
  text-align: center;
  color: var(--text-secondary, #6b7280);
  cursor: pointer;
  transition: background-color 0.2s, border-color 0.2s;
}
.drop-zone.drag-over {
  background-color: rgba(59, 130, 246, 0.05);
  border-color: #3b82f6;
}
.file-list-container {
  margin-top: 1rem;
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid var(--border-color);
  border-radius: 4px;
}
.file-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.file-item {
  display: flex;
  align-items: center;
  padding: 0.75rem;
  border-bottom: 1px solid var(--border-color);
}
.file-item:last-child {
  border-bottom: none;
}
.file-name {
  flex-grow: 1;
  font-size: 0.9rem;
  color: var(--text-primary);
}
.file-size {
  font-size: 0.8rem;
  color: var(--text-tertiary);
  margin: 0 1rem;
}
.remove-file-btn {
  color: var(--danger, #ef4444);
  background: none;
  border: none;
  cursor: pointer;
}
</style>