<template>
  <div class="dialog-backdrop" @click="$emit('close')"></div>
  <div class="dialog-container">
    <!-- 1. Loading State -->
    <div v-if="isLoading" class="loading-overlay">
      <div class="loading-spinner"></div>
      <span>{{ translate("details.loading", "Loading File Details...") }}</span>
    </div>

    <!-- 2. Main Content (displays after loading is complete) -->
    <template v-if="!isLoading && file">
      <div class="dialog-header">
        <h2 class="dialog-title">
          {{ translate("details.title", "File Details") }}
        </h2>
        <button
          class="dialog-close-btn"
          @click="$emit('close')"
          :aria-label="translate('details.close', 'Close')"
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
        <!-- 3. Editable Metadata Section -->
        <div class="form-section">
          <div class="form-group">
            <label for="file-name">{{
              translate("details.fileName", "File Name")
            }}</label>
            <input
              id="file-name"
              type="text"
              class="form-input"
              v-model="editableFile.file_name"
              :disabled="!isMetadataEditable"
              :class="{
                'is-invalid':
                  !editableFile.file_name.trim() && isMetadataEditable,
              }"
            />
          </div>
          <div class="form-group">
            <label for="author">{{
              translate("details.author", "Author")
            }}</label>
            <input
              id="author"
              type="text"
              class="form-input"
              v-model="editableFile.author"
              :disabled="!isMetadataEditable"
              :class="{
                'is-invalid': !editableFile.author.trim() && isMetadataEditable,
              }"
            />
          </div>
          <div class="form-group">
            <label>{{ translate("details.labels", "Labels") }}</label>

            <!-- Requirement: "Select All" Checkbox -->
            <div class="select-all-container">
              <input
                type="checkbox"
                id="select-all-labels"
                v-model="areAllLabelsSelected"
                :disabled="!isMetadataEditable"
              />
              <label for="select-all-labels">{{
                translate("details.selectAll", "Select All")
              }}</label>
            </div>

            <div class="labels-container">
              <div v-if="isHierarchyLoading" class="loading-state-small">
                Loading labels...
              </div>
              <div
                v-for="category in knowledgeHierarchy"
                :key="category.catKey"
                class="label-category"
              >
                <strong>{{ category.name }}</strong>
                <div
                  v-for="service in category.children"
                  :key="service._key"
                  class="label-item"
                >
                  <input
                    type="checkbox"
                    :id="'label-' + service._key"
                    :value="service.name"
                    v-model="editableFile.labels"
                    :disabled="!isMetadataEditable"
                  />
                  <label :for="'label-' + service._key">{{
                    service.name
                  }}</label>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 4. Static Info Section -->
        <div class="info-section">
          <div class="info-item">
            <span class="info-label">{{
              translate("details.status", "Status")
            }}</span>
            <span :class="['status-tag', getStatusClass(file.dataprep.status)]">
              {{ file.dataprep.status }}
            </span>
          </div>
          <div class="info-item">
            <span class="info-label">File ID</span>
            <span>{{ file.file_id }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">File Type</span>
            <span>{{ file.file_type }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">File Size</span>
            <span>{{ formatFileSize(file.file_size) }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Upload Date</span>
            <span>{{ new Date(file.upload_date).toLocaleString() }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">SHA256 Hash</span>
            <span class="info-hash">{{ file.file_hash }}</span>
          </div>
        </div>
      </div>

      <!-- 5. Footer with Conditional Actions -->
      <div class="dialog-footer">
        <button
          class="btn btn-danger"
          @click="handleDelete"
          :disabled="file.dataprep.status === 'ingested'"
        >
          {{ translate("buttons.delete", "Delete") }}
        </button>
        <div class="footer-actions">
          <button class="btn btn-outline" @click="$emit('close')">
            {{ translate("buttons.cancel", "Cancel") }}
          </button>
          <button
            class="btn btn-secondary"
            @click="handleSave"
            :disabled="isSaveDisabled"
          >
            {{ translate("buttons.save", "Save Metadata") }}
          </button>
          <button :class="mainAction.class" @click="mainAction.handler">
            {{ mainAction.text }}
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<script>
import documentFileService from "../services/documentFileService.js";
import serviceTreeService from "../services/serviceTreeService.js";
import { eventBus } from "../eventBus.js";

export default {
  name: "FileDetailsDialog",
  props: {
    fileId: {
      type: String,
      required: true,
    },
  },
  emits: ["close", "file-updated", "action-triggered"],
  data() {
    return {
      isLoading: true,
      isHierarchyLoading: true,
      file: null,
      editableFile: {
        file_name: "",
        author: "",
        labels: [],
      },
      knowledgeHierarchy: [],
      areAllLabelsSelected: false, // State for the "Select All" checkbox
    };
  },
  computed: {
    isSaveDisabled() {
      if (!this.isMetadataEditable) return true;
      if (!this.editableFile.file_name || !this.editableFile.file_name.trim())
        return true;
      if (!this.editableFile.author || !this.editableFile.author.trim())
        return true;
      return false;
    },
    isMetadataEditable() {
      return this.file && this.file.dataprep.status !== "ingested";
    },
    mainAction() {
      if (!this.file) return {};
      const status = this.file.dataprep.status;
      if (status === "ingested") {
        return {
          text: this.translate("buttons.retract", "Retract"),
          class: "btn btn-warning",
          handler: this.handleRetract,
        };
      }
      return {
        text: this.translate("buttons.ingest", "Ingest"),
        class: "btn btn-success",
        handler: this.handleIngest,
      };
    },
    /**
     * Requirement: Creates a flat list of all possible service names from the hierarchy.
     */
    allLabelNames() {
      if (!this.knowledgeHierarchy) {
        return [];
      }
      return this.knowledgeHierarchy.flatMap((category) =>
        category.children
          ? category.children.map((service) => service.name)
          : []
      );
    },
  },
  watch: {
    fileId: {
      immediate: true,
      handler(newId) {
        if (newId) {
          this.fetchData(newId);
        }
      },
    },
    /**
     * Requirement: Toggles all labels on or off when the "Select All" checkbox changes.
     */
    areAllLabelsSelected(newValue) {
      if (newValue) {
        // Create a new array to ensure reactivity
        this.editableFile.labels = [...this.allLabelNames];
      } else {
        // To deselect all, only clear the list if it was previously full
        if (this.editableFile.labels.length === this.allLabelNames.length) {
          this.editableFile.labels = [];
        }
      }
    },
    // This watcher keeps the "Select All" checkbox in sync if the user manually selects/deselects all items
    "editableFile.labels"(newLabels) {
      if (this.allLabelNames.length > 0) {
        this.areAllLabelsSelected =
          newLabels.length === this.allLabelNames.length;
      }
    },
  },
  methods: {
    translate(key, fallback) {
      return fallback || key;
    },
    async fetchData(id) {
      this.isLoading = true;
      this.isHierarchyLoading = true;
      try {
        const [fileData, hierarchyData] = await Promise.all([
          documentFileService.getFileMetadata(id),
          serviceTreeService.getAdminCategories("en"),
        ]);

        this.file = fileData; // Corrected based on previous debugging
        this.editableFile = {
          file_name: this.file.file_name,
          author: this.file.author,
          labels: [...this.file.labels],
        };

        this.knowledgeHierarchy = hierarchyData;
      } catch (error) {
        this.showNotification("Failed to load file details.", "error");
        this.$emit("close");
      } finally {
        this.isLoading = false;
        this.isHierarchyLoading = false;
      }
    },
    async handleSave() {
      if (this.isSaveDisabled) {
        this.showNotification("File Name and Author are required.", "error");
        return;
      }
      const updates = {
        file_name: this.editableFile.file_name.trim(),
        author: this.editableFile.author.trim(),
        labels: this.editableFile.labels,
      };
      try {
        await documentFileService.updateFile(this.fileId, updates);
        this.showNotification("Metadata updated successfully.", "success");
        this.$emit("file-updated", { fileId: this.fileId, ...updates });
        this.$emit("close");
      } catch (error) {
        this.showNotification("Failed to save metadata.", "error");
      }
    },
    async handleIngest() {
      if (window.confirm("Are you sure you want to ingest this file?")) {
        try {
          await documentFileService.ingestMultipleFiles([this.file.file_id]);
          this.showNotification("File queued for ingestion.", "success");
          this.$emit("action-triggered", {
            action: "ingest",
            fileId: this.file.file_id,
          });
          this.$emit("close");
        } catch (error) {
          this.showNotification("Failed to start ingestion.", "error");
        }
      }
    },
    async handleRetract() {
      if (window.confirm("Are you sure you want to retract this file?")) {
        try {
          await documentFileService.retractMultipleFiles([this.file.file_id]);
          this.showNotification("File has been retracted.", "success");
          this.$emit("action-triggered", {
            action: "retract",
            fileId: this.file.file_id,
          });
          this.$emit("close");
        } catch (error) {
          this.showNotification("Failed to retract file.", "error");
        }
      }
    },
    async handleDelete() {
      if (
        window.confirm(
          "Are you sure you want to permanently delete this file? This action cannot be undone."
        )
      ) {
        try {
          await documentFileService.deleteFile(this.file.file_id);
          this.showNotification("File deleted successfully.", "success");
          this.$emit("action-triggered", {
            action: "delete",
            fileId: this.file.file_id,
          });
          this.$emit("close");
        } catch (error) {
          this.showNotification("Failed to delete file.", "error");
        }
      }
    },
    getStatusClass(status) {
      if (status === "ingested") return "status-ingested";
      if (status === "pending") return "status-pending";
      if (status === "retracted") return "status-retracted";
      return "";
    },
    formatFileSize(bytes) {
      if (bytes === 0) return "0 Bytes";
      const k = 1024;
      const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    },
    showNotification(message, type = "success") {
      eventBus.$emit("notification:show", { message, type });
    },
  },
};
</script>

<style scoped>
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
  max-width: 800px;
  background-color: var(--bg-dialog, #fff);
  border-radius: 8px;
  box-shadow: var(--shadow-lg);
  z-index: 1051;
  display: flex;
  flex-direction: column;
  max-height: 90vh;
}
.loading-overlay {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  min-height: 400px;
  gap: 1rem;
}
.loading-spinner {
  width: 40px;
  height: 40px;
  border: 4px solid rgba(0, 0, 0, 0.1);
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--border-color, #e2e8f0);
  flex-shrink: 0;
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
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 2rem;
}
.dialog-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--border-color, #e2e8f0);
  flex-shrink: 0;
}
.footer-actions {
  display: flex;
  gap: 0.75rem;
}
.btn {
  padding: 0.6rem 1rem;
  border-radius: 0.375rem;
  border: none;
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.2s;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-primary {
  background-color: #3b82f6;
  color: white;
}
.btn-secondary {
  background-color: #64748b;
  color: white;
}
.btn-success {
  background-color: #10b981;
  color: white;
}
.btn-warning {
  background-color: #f59e0b;
  color: white;
}
.btn-danger {
  background-color: #ef4444;
  color: white;
}
.btn-outline {
  background-color: transparent;
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
}
.form-group {
  margin-bottom: 1.5rem;
}
.form-group label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 500;
}
.form-input {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid var(--border-color);
  border-radius: 4px;
}
.form-input:disabled {
  background-color: var(--bg-section);
}
.form-input.is-invalid {
  border-color: var(--danger, #ef4444);
  box-shadow: 0 0 0 1px var(--danger, #ef4444);
}
.info-section {
  background-color: var(--bg-section);
  border-radius: 8px;
  padding: 1.5rem;
}
.info-item {
  display: flex;
  flex-direction: column;
  margin-bottom: 1rem;
}
.info-label {
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 0.25rem;
}
.info-hash {
  word-break: break-all;
  font-family: monospace;
  font-size: 0.8rem;
}
.select-all-container {
  display: flex;
  align-items: center;
  margin-bottom: 0.75rem;
}
.select-all-container input {
  margin-right: 0.5rem;
}
.select-all-container label {
  margin-bottom: 0; /* Override default form-group label margin */
  font-weight: bold;
}
.labels-container {
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid var(--border-color);
  padding: 0.75rem;
  border-radius: 4px;
}
.loading-state-small {
  font-style: italic;
  color: var(--text-secondary);
}
.label-category {
  margin-bottom: 0.75rem;
}
.label-category strong {
  font-size: 0.9rem;
}
.label-item {
  display: flex;
  align-items: center;
  margin-top: 0.5rem;
  padding-left: 0.5rem;
}
.label-item input {
  margin-right: 0.5rem;
}
.status-tag {
  display: inline-block;
  padding: 0.2rem 0.6rem;
  border-radius: 1rem;
  font-weight: 600;
  text-transform: capitalize;
}
.status-ingested {
  background-color: rgba(16, 185, 129, 0.1);
  color: #10b981;
}
.status-pending {
  background-color: rgba(245, 158, 11, 0.1);
  color: #f59e0b;
}
.status-retracted {
  background-color: rgba(100, 116, 139, 0.1);
  color: #64748b;
}
</style>

