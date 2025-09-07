<template>
  <div class="dialog-backdrop" @click="$emit('close')"></div>
  <div class="dialog-container">
    <div v-if="isLoading" class="loading-overlay">
      <span>Loading...</span>
    </div>

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
            />
          </div>
          <div class="form-group">
            <label>{{ translate("details.labels", "Labels") }}</label>
            <div class="labels-container">
              <div
                v-for="category in knowledgeHierarchy"
                :key="category._key"
                class="label-category"
              >
                <strong>{{ category.nameEN }}</strong>
                <div
                  v-for="service in category.services"
                  :key="service._key"
                  class="label-item"
                >
                  <input
                    type="checkbox"
                    :id="'label-' + service._key"
                    :value="service.nameEN"
                    v-model="editableFile.labels"
                  />
                  <label :for="'label-' + service._key">{{
                    service.nameEN
                  }}</label>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="info-section">
          <div class="info-item">
            <span class="info-label">{{
              translate("details.status", "Status")
            }}</span>
            <span
              :class="['status-tag', getStatusClass(file.dataprep.status)]"
              >{{ file.dataprep.status }}</span
            >
          </div>
          <div class="info-item">
            <span class="info-label">File ID</span
            ><span>{{ file.file_id }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">File Type</span
            ><span>{{ file.file_type }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">File Size</span
            ><span>{{ file.file_size }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Upload Date</span
            ><span>{{ new Date(file.upload_date).toLocaleString() }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">SHA256 Hash</span
            ><span class="info-hash">{{ file.file_hash }}</span>
          </div>
        </div>
      </div>

      <div class="dialog-footer">
        <button class="btn btn-danger" @click="handleDelete">
          {{ translate("buttons.delete", "Delete") }}
        </button>
        <div class="footer-actions">
          <button class="btn btn-outline" @click="$emit('close')">
            {{ translate("buttons.cancel", "Cancel") }}
          </button>
          <button class="btn btn-secondary" @click="handleSave">
            {{ translate("buttons.save", "Save Metadata") }}
          </button>
          <button
            v-if="file.dataprep.status !== 'ingested'"
            class="btn btn-primary"
            @click="handleIngest"
          >
            {{ translate("buttons.ingest", "Ingest") }}
          </button>
          <button
            v-if="file.dataprep.status === 'ingested'"
            class="btn btn-warning"
            @click="handleRetract"
          >
            {{ translate("buttons.retract", "Retract") }}
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
  
  <script>
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
      file: null,
      editableFile: {
        file_name: "",
        author: "",
        labels: [],
      },
      // This hierarchy would be fetched from an API in a real app
      knowledgeHierarchy: [
        {
          _key: "1",
          nameEN: "Healthcare & Social Services",
          services: [{ _key: "101", nameEN: "Find a Doctor" }],
        },
        {
          _key: "2",
          nameEN: "Finance & Taxation",
          services: [{ _key: "103", nameEN: "File Annual Tax Return" }],
        },
      ],
    };
  },
  watch: {
    fileId: {
      immediate: true,
      handler(newId) {
        if (newId) {
          this.fetchFileDetails(newId);
        }
      },
    },
  },
  methods: {
    translate(key, fallback) {
      return fallback || key;
    },
    async fetchFileDetails(id) {
      this.isLoading = true;
      // API Call: GET /api/files/:fileId
      console.log(`Fetching details for ${id}`);
      setTimeout(() => {
        // Simulate API call
        const mockData = {
          file_id: id,
          file_name: "Annual Budget Report 2025.pdf",
          file_size: "2.1 MB",
          file_type: "application/pdf",
          file_hash:
            "65f7f55f1142a85eff2ee54896dbe531c6db38289a1dac9ded7594ca7f9a5892",
          labels: ["Finance & Taxation"],
          author: "Finance Dept.",
          upload_date: "2025-09-01T10:00:00Z",
          dataprep: { status: "ingested" },
        };
        this.file = mockData;
        // Deep copy for editing to avoid mutating the original data until save
        this.editableFile = JSON.parse(
          JSON.stringify({
            file_name: mockData.file_name,
            author: mockData.author,
            labels: mockData.labels,
          })
        );
        this.isLoading = false;
      }, 1000);
    },
    handleSave() {
      // API Call: PATCH /api/files/:fileId with this.editableFile as payload
      console.log("Saving metadata:", this.editableFile);
      this.$emit("file-updated", { fileId: this.fileId, ...this.editableFile });
      this.$emit("close");
    },
    handleIngest() {
      // API Call: POST /api/files/:fileId/ingest
      console.log("Ingesting file:", this.fileId);
      this.$emit("action-triggered", { action: "ingest", fileId: this.fileId });
      this.$emit("close");
    },
    handleRetract() {
      // API Call: POST /api/files/:fileId/retract
      console.log("Retracting file:", this.fileId);
      this.$emit("action-triggered", {
        action: "retract",
        fileId: this.fileId,
      });
      this.$emit("close");
    },
    handleDelete() {
      if (
        window.confirm("Are you sure you want to permanently delete this file?")
      ) {
        // API Call: DELETE /api/files/:fileId
        console.log("Deleting file:", this.fileId);
        this.$emit("action-triggered", {
          action: "delete",
          fileId: this.fileId,
        });
        this.$emit("close");
      }
    },
    getStatusClass(status) {
      if (status === "ingested") return "status-ingested";
      if (status === "pending") return "status-pending";
      if (status === "retracted") return "status-retracted";
      return "";
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
  justify-content: center;
  align-items: center;
  min-height: 400px;
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
.btn-primary {
  background-color: #3b82f6;
  color: white;
}
.btn-secondary {
  background-color: #64748b;
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

/* Component-specific styles */
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
.labels-container {
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid var(--border-color);
  padding: 0.75rem;
  border-radius: 4px;
}
.label-category {
  margin-bottom: 0.75rem;
}
.label-item {
  display: flex;
  align-items: center;
  margin-top: 0.5rem;
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