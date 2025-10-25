<template>
  <div class="dialog-backdrop" @click="$emit('close')"></div>
  <div class="dialog-container">
    <div v-if="isLoading || isFetchingData" class="loading-overlay">
      <div class="loading-spinner"></div>
      <span>{{ translate("details.loading", "Loading File Details...") }}</span>
    </div>

    <template v-if="!isLoading && !isFetchingData && file">
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
                {{ translate("details.loadingLabels", "Loading labels...") }}
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
                    service.name /* Display the TRANSLATED name */
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
            <span :class="['status-tag', getStatusClass(file.dataprep.status)]">
              {{ file.dataprep.status }}
            </span>
          </div>
          <div class="info-item">
            <span class="info-label">{{
              translate("details.fileId", "File ID")
            }}</span>
            <span>{{ file.file_id }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">{{
              translate("details.fileType", "File Type")
            }}</span>
            <span>{{ file.file_type }}</span>
          </div>

          <div class="info-item" v-if="fileViewUrl">
            <span class="info-label">{{
              translate("details.viewFile", "View File")
            }}</span>
            <a
              href="#"
              @click.prevent="handleViewFile"
              rel="noopener noreferrer"
              class="file-view-link"
            >
              {{
                isExternalUrl(file.source_url)
                  ? translate("details.visitLink", "Visit External Link")
                  : translate("details.openFile", "Open file in new tab")
              }}
            </a>
          </div>
          <div class="info-item">
            <span class="info-label">{{
              translate("details.fileSize", "File Size")
            }}</span>
            <span>{{ formatFileSize(file.file_size) }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">{{
              translate("details.uploadDate", "Upload Date")
            }}</span>
            <span>{{ new Date(file.upload_date).toLocaleString() }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">{{
              translate("details.hash", "SHA256 Hash")
            }}</span>
            <span class="info-hash">{{ file.file_hash }}</span>
          </div>
        </div>
      </div>

      <div class="dialog-footer">
        <button
          class="btn btn-danger"
          @click="handleDelete"
          :disabled="file.dataprep.status === 'ingested'"
        >
          {{ translate("common.delete", "Delete") }}
        </button>
        <div class="footer-actions">
          <button class="btn btn-outline" @click="$emit('close')">
            {{ translate("common.cancel", "Cancel") }}
          </button>
          <button
            class="btn btn-secondary"
            @click="handleSave"
            :disabled="isSaveDisabled"
          >
            {{ translate("details.buttons.saveMetadata", "Save Metadata") }}
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
      isLoading: true, // Loading state for the whole dialog
      isFetchingData: true, // Specific state for async data fetching
      isHierarchyLoading: true, // Specific loading for hierarchy display
      file: null,
      editableFile: {
        file_name: "",
        author: "",
        labels: [], // Will store SELECTED TRANSLATED names from checkboxes
      },
      knowledgeHierarchy: [], // Stores hierarchy in CURRENT LOCALE for display
      englishKnowledgeHierarchy: [], // Stores hierarchy in ENGLISH for mapping back
      currentLocale: this.$i18n?.locale || 'en', // Get current locale
      areAllLabelsSelected: false,
    };
  },
  computed: {
    // ... (isSaveDisabled, isMetadataEditable, mainAction remain the same) ...
     isSaveDisabled() {
      if (!this.isMetadataEditable) return true;
      if (!this.editableFile.file_name || !this.editableFile.file_name.trim())
        return true;
      if (!this.editableFile.author || !this.editableFile.author.trim())
        return true;
      // Also disable if hierarchy data isn't loaded yet
      if (this.isHierarchyLoading || this.englishKnowledgeHierarchy.length === 0) return true;
      return false;
    },
    isMetadataEditable() {
      // Allow editing metadata only if file status is not 'ingested'
      return this.file && this.file.dataprep.status !== "ingested";
    },
    mainAction() {
      if (!this.file) return {};
      const status = this.file.dataprep.status;
      if (status === "ingested") {
        return {
          text: this.translate("details.buttons.retract", "Retract"),
          class: "btn btn-warning",
          handler: this.handleRetract,
        };
      }
      return {
        text: this.translate("details.buttons.ingest", "Ingest"),
        class: "btn btn-success",
        // Disable ingest if metadata is invalid or hierarchies not loaded
        disabled: this.isSaveDisabled,
        handler: this.handleIngest,
      };
    },

    /**
     * Creates a flat list of all possible service names from the CURRENT LOCALE hierarchy.
     */
    allLabelNames() {
      if (!this.knowledgeHierarchy) {
        return [];
      }
      // Assuming 'children' contains the services and each service has a 'name' property
      return this.knowledgeHierarchy.flatMap((category) =>
        category.children ? category.children.map((service) => service.name) : []
      );
    },

    fileViewUrl() {
      if (!this.file) return null;
      if (this.isExternalUrl(this.file.source_url)) {
        return this.file.source_url;
      }
      if (this.file.file_id) {
        return `/api/files/${this.file.file_id}/viewbrowser`;
      }
      return this.file.source_url || null;
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
    // Watch for locale changes to refetch hierarchy data
    '$i18n.locale'(newLocale) {
        if (newLocale && newLocale !== this.currentLocale) {
            this.currentLocale = newLocale;
            this.fetchData(this.fileId); // Refetch all data including hierarchies
        }
    },
    areAllLabelsSelected(newValue) {
      // Use the computed 'allLabelNames' which are based on the current locale hierarchy
      if (this.isMetadataEditable) { // Only change if editable
        this.editableFile.labels = newValue ? [...this.allLabelNames] : [];
      }
    },
    "editableFile.labels"(newLabels) {
      if (this.allLabelNames.length > 0) {
        // Check if all displayable labels are included in the selection
        const allSelected = this.allLabelNames.every(label => newLabels.includes(label));
        this.areAllLabelsSelected = allSelected && newLabels.length === this.allLabelNames.length;
      } else {
        this.areAllLabelsSelected = false;
      }
    },
  },
  methods: {
    translate(key, fallback) {
      if (this.$i18n && this.$i18n.t) {
        // Ensure locale is passed if needed, or rely on global setting
        const translation = this.$i18n.t(key, this.currentLocale);
        if (translation === key) {
          return fallback || key;
        }
        return translation;
      }
      return fallback || key;
    },

    isExternalUrl(url) {
      if (!url) return false;
      const isHttp = url.startsWith("http://") || url.startsWith("https://");
      // Added a check for common non-http protocols that might appear in source_url
      const isOtherProtocol = url.startsWith("file:") || url.startsWith("ftp:") || url.startsWith("smb:");
      const isPlaceholder = url.includes("<HOST>") || url.includes("<PORT>");
      return isHttp && !isPlaceholder && !isOtherProtocol;
    },

    async fetchData(id) {
        this.isFetchingData = true; // Start overall data fetching
        this.isLoading = true; // Keep main loading indicator active
        this.isHierarchyLoading = true; // Specifically indicate hierarchy loading
        try {
            // Fetch file metadata and both hierarchies concurrently
            const [fileResponse, hierarchyResponse, englishHierarchyResponse] = await Promise.all([
                documentFileService.getFileMetadata(id),
                serviceTreeService.getAdminCategories(this.currentLocale), // Fetch for current display locale
                serviceTreeService.getAdminCategories('en') // Fetch English version for mapping
            ]);

            this.file = fileResponse;
            // Initialize editableFile based on the fetched file data
            // Crucially, editableFile.labels should reflect the ENGLISH labels initially loaded
            // We need to map the file's existing English labels to the current locale for initial checkbox state
            const initialLabelsInCurrentLocale = this.mapEnglishToLocale(fileResponse.labels || [], hierarchyResponse, englishHierarchyResponse);
            this.editableFile = {
                file_name: this.file.file_name,
                author: this.file.author || '', // Handle potentially missing author
                labels: initialLabelsInCurrentLocale, // Start with translated labels for checkboxes
            };

            // Store both hierarchies
            this.knowledgeHierarchy = hierarchyResponse;
            this.englishKnowledgeHierarchy = englishHierarchyResponse;

        } catch (error) {
            console.error("Error fetching data for FileDetailsDialog:", error);
            this.showNotification(
                this.translate("details.notifications.loadError", "Failed to load file details."),
                "error"
            );
            this.$emit("close"); // Close dialog on critical data fetch error
        } finally {
            this.isLoading = false; // Stop main loading indicator
            this.isHierarchyLoading = false; // Stop hierarchy specific indicator
            this.isFetchingData = false; // Stop overall data fetching indicator
        }
    },


    // --- NEW HELPER: Map English labels to current locale labels ---
    mapEnglishToLocale(englishLabels, localeHierarchy, englishHierarchy) {
        if (!englishLabels || englishLabels.length === 0 || !localeHierarchy || !englishHierarchy) {
            return [];
        }

        const localeLabels = [];
        const englishServiceMap = new Map(); // Map: englishName -> localeName

        // Build the map by comparing keys or indices if keys are missing
        englishHierarchy.forEach((engCategory, catIndex) => {
            if (engCategory.children && localeHierarchy[catIndex] && localeHierarchy[catIndex].children) {
                engCategory.children.forEach((engService, servIndex) => {
                    const localeService = localeHierarchy[catIndex].children[servIndex];
                    if (localeService) {
                         // Prefer matching by _key if available, otherwise assume order matches
                         const keyToMatch = engService._key || `idx_${catIndex}_${servIndex}`;
                         const localeKey = localeService._key || `idx_${catIndex}_${servIndex}`;
                         if (keyToMatch === localeKey) {
                             englishServiceMap.set(engService.name, localeService.name);
                         }
                    }
                });
            }
        });

        englishLabels.forEach(engLabel => {
            if (englishServiceMap.has(engLabel)) {
                localeLabels.push(englishServiceMap.get(engLabel));
            } else {
                 console.warn(`Could not map English label "${engLabel}" to current locale "${this.currentLocale}". Using English name.`);
                 localeLabels.push(engLabel); // Fallback: keep English name if no map found
            }
        });

        return localeLabels;
    },


    // --- NEW HELPER: Map selected (translated) labels back to English ---
    getEnglishLabelNames(selectedLocaleLabels) {
      if (!selectedLocaleLabels || selectedLocaleLabels.length === 0 || this.englishKnowledgeHierarchy.length === 0 || this.knowledgeHierarchy.length === 0) {
        return [];
      }

      const englishLabels = [];
      const localeServiceMap = new Map(); // Map: localeName -> englishName

       // Build the map: locale name -> english name (using _key is more robust)
        this.knowledgeHierarchy.forEach((localeCategory) => {
            if (localeCategory.children) {
                 localeCategory.children.forEach((localeService) => {
                    // Find the corresponding English service
                    const englishService = this.findServiceInHierarchy(this.englishKnowledgeHierarchy, localeService._key, localeService.name);
                    if(englishService) {
                         localeServiceMap.set(localeService.name, englishService.name); // Store mapping
                    } else {
                         console.warn(`Could not find English equivalent for locale service: ${localeService.name} (Key: ${localeService._key})`);
                    }
                 });
            }
        });

      selectedLocaleLabels.forEach(localeLabel => {
        if (localeServiceMap.has(localeLabel)) {
          englishLabels.push(localeServiceMap.get(localeLabel));
        } else {
            // Fallback: If somehow a selected label isn't in our map, log warning and potentially keep it (or discard?)
            // Keeping it might be safer if the hierarchy loading had partial issues.
             console.warn(`Could not map selected locale label "${localeLabel}" back to English.`);
             // Decide on fallback behavior: maybe try finding by name directly in english list as last resort
             const directMatch = this.findServiceInHierarchy(this.englishKnowledgeHierarchy, null, localeLabel);
             if (directMatch) {
                 englishLabels.push(directMatch.name); // If name exists in English hierarchy directly
             } else {
                 englishLabels.push(localeLabel); // Or just keep the locale label as worst-case
             }
        }
      });

      return [...new Set(englishLabels)]; // Ensure uniqueness
    },

    // --- NEW HELPER: Find a service within a hierarchy by key or name ---
    findServiceInHierarchy(hierarchy, serviceKey, serviceName) {
        for (const category of hierarchy) {
            if (category.children) {
                for (const service of category.children) {
                     // Prioritize matching by key if provided and available
                    if (serviceKey && service._key && service._key === serviceKey) {
                        return service;
                    }
                    // Fallback to matching by name if key isn't provided or doesn't match
                     if (!serviceKey && service.name === serviceName) {
                         return service;
                     }
                }
            }
        }
        return null; // Not found
    },


    // --- UPDATED: handleSave now maps labels to English ---
    async handleSave() {
      if (this.isSaveDisabled) {
        this.showNotification(
          this.translate(
            "details.notifications.validationError",
            "File Name and Author are required, or labels are still loading." // Updated message
          ),
          "error"
        );
        return;
      }

      // Map selected translated labels back to English
      const englishLabelsToSave = this.getEnglishLabelNames(this.editableFile.labels);

      const updates = {
        file_name: this.editableFile.file_name.trim(),
        author: this.editableFile.author.trim(),
        labels: englishLabelsToSave, // Send ENGLISH labels to backend
      };
      try {
        await documentFileService.updateFile(this.fileId, updates);
        this.showNotification(
          this.translate(
            "details.notifications.saveSuccess",
            "Metadata updated successfully."
          ),
          "success"
        );
        // Important: Emit the ENGLISH labels that were saved
        this.$emit("file-updated", { fileId: this.fileId, ...updates });
        this.$emit("close");
      } catch (error) {
        this.showNotification(
          this.translate(
            "details.notifications.saveError",
            "Failed to save metadata."
          ),
          "error"
        );
      }
    },

    // ... (handleViewFile, handleIngest, handleRetract, handleDelete remain the same as they don't directly handle label names) ...
     async handleViewFile() {
      if (this.isExternalUrl(this.file?.source_url)) {
        console.log(`Opening external source URL: ${this.file.source_url}`);
        window.open(this.file.source_url, '_blank', 'noopener,noreferrer');
        return;
      }

      let token = null;
      try {
        const userDataString = localStorage.getItem('user');
        if (userDataString) {
          const userData = JSON.parse(userDataString);
          token = userData?.accessToken; // Use optional chaining
        }

        if (!token) {
           console.error("Authentication token not found in user data.");
          this.showNotification(
            this.translate(
              "details.notifications.tokenError",
              "Authentication token not found. Cannot view file." // Updated message
            ),
            "error"
          );
          return;
        }

        if (!this.fileViewUrl) {
             console.error("File view URL is not available.");
             this.showNotification(this.translate("details.notifications.viewError", "Could not determine file view URL."), "error");
             return;
        }


        const response = await fetch(this.fileViewUrl, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (!response.ok) {
           const errorText = await response.text();
          throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}. Response: ${errorText}`);
        }

        const blob = await response.blob();
        const fileURL = URL.createObjectURL(blob);
        window.open(fileURL, '_blank', 'noopener,noreferrer');
        // Consider revoking the object URL after some time if needed: URL.revokeObjectURL(fileURL);

      } catch (error) {
        console.error('Error viewing file:', error);
        this.showNotification(
          this.translate(
            "details.notifications.viewError",
            "Could not load file for viewing."
          ) + ` Error: ${error.message}`, // Add error message detail
          "error"
        );
      }
    },
     async handleIngest() {
      // First, ensure metadata is saved with potentially updated labels (in English)
       if(this.isSaveDisabled) {
            this.showNotification(this.translate("details.notifications.saveBeforeIngest", "Please correct validation errors before ingesting."), "warning");
            return;
       }
       // Save metadata first to ensure labels are up-to-date in the backend
       await this.handleSave();

       // Check if saving was successful (e.g., check if dialog is still open or add a flag)
       // If save failed, the dialog would likely still be open, so we don't proceed.
       // This assumes handleSave closes the dialog on success. If not, add explicit success check.


       // Proceed with ingest confirmation IF the dialog didn't close due to save error
       if (!this.$el) return; // Component might be unmounted if save closed it

      if (
        window.confirm(
          this.translate(
            "details.confirm.ingest",
            "Are you sure you want to ingest this file? This will start the data processing pipeline."
          )
        )
      ) {
        this.isLoading = true; // Use dialog's loading overlay for ingest action itself
        try {
          await documentFileService.ingestFile(this.fileId);
          this.showNotification(
            this.translate(
              "details.notifications.ingestSuccess",
              "File has been successfully queued for ingestion."
            ),
            "success"
          );
          this.$emit("action-triggered", { action: "ingest", fileId: this.fileId });
          // Close should happen *after* successful ingest API call if not closed by save
          this.$emit("close");

        } catch (error) {
          this.showNotification(
            this.translate(
              "details.notifications.ingestError",
              "Failed to start ingestion process."
            ) + ` Error: ${error.message}`,
            "error"
          );
        } finally {
          this.isLoading = false;
        }
      }
    },
     async handleRetract() {
      if (
        window.confirm(
          this.translate(
            "details.confirm.retract",
            "Are you sure you want to retract this file?"
          )
        )
      ) {
         this.isLoading = true; // Show loading for retract action
        try {
          // Retracting might involve multiple files in API, but here we use single ID in array
          await documentFileService.retractMultipleFiles([this.file.file_id]);
          this.showNotification(
            this.translate(
              "details.notifications.retractSuccess",
              "File has been retracted."
            ),
            "success"
          );
          this.$emit("action-triggered", {
            action: "retract",
            fileId: this.file.file_id,
          });
          this.$emit("close");
        } catch (error) {
          this.showNotification(
            this.translate(
              "details.notifications.retractError",
              "Failed to retract file."
            ) + ` Error: ${error.message}`,
            "error"
          );
        } finally {
            this.isLoading = false;
        }
      }
    },
     async handleDelete() {
      if (
        window.confirm(
          this.translate(
            "details.confirm.delete",
            "Are you sure you want to permanently delete this file? This action cannot be undone."
          )
        )
      ) {
         this.isLoading = true; // Show loading for delete action
        try {
          await documentFileService.deleteFile(this.file.file_id);
          this.showNotification(
            this.translate(
              "details.notifications.deleteSuccess",
              "File deleted successfully."
            ),
            "success"
          );
          this.$emit("action-triggered", {
            action: "delete",
            fileId: this.file.file_id,
          });
          this.$emit("close");
        } catch (error) {
          this.showNotification(
            this.translate(
              "details.notifications.deleteError",
              "Failed to delete file."
            ) + ` Error: ${error.message}`,
            "error"
          );
        } finally {
             this.isLoading = false;
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
      if (bytes == null || bytes === 0) return "0 Bytes"; // Added null check
      const k = 1024;
      const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
       if (bytes < 1) return `${bytes} Bytes`; // Handle potential sub-byte values if necessary
      const i = Math.floor(Math.log(bytes) / Math.log(k));
       // Ensure index is within bounds
      const index = Math.min(i, sizes.length - 1);
      return parseFloat((bytes / Math.pow(k, index)).toFixed(2)) + " " + sizes[index];
    },
    showNotification(message, type = "success") {
      eventBus.$emit("notification:show", { message, type });
    },
  },
};
</script>

<style scoped>
/* Styles remain the same */
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
  /* Ensure overlay covers the entire dialog content area if needed */
  position: absolute; /* Changed from flex */
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(255, 255, 255, 0.8); /* Optional: semi-transparent background */
  display: flex; /* Keep flex for centering content */
  flex-direction: column;
  justify-content: center;
  align-items: center;
  min-height: 400px; /* Or adjust as needed */
  gap: 1rem;
  z-index: 10; /* Ensure it's above other content */
}

/* Dark mode for overlay */
[data-theme="dark"] .loading-overlay {
    background-color: rgba(30, 41, 59, 0.8); /* Darker background */
    color: var(--text-primary); /* Ensure text is visible */
}


.loading-spinner {
  width: 40px;
  height: 40px;
  border: 4px solid var(--border-color, rgba(0, 0, 0, 0.1)); /* Use variable */
  border-top-color: var(--primary, #3b82f6); /* Use variable */
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

[data-theme="dark"] .loading-spinner {
     border: 4px solid rgba(255, 255, 255, 0.2);
     border-top-color: var(--primary);
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
  margin: 0; /* Remove default margin */
}
.dialog-close-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-secondary);
  padding: 0.25rem; /* Add padding for easier clicking */
  line-height: 1; /* Prevent extra space */
}
.dialog-body {
  padding: 1.5rem;
  overflow-y: auto;
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 2rem;
}

/* Responsive grid for smaller screens */
@media (max-width: 768px) {
    .dialog-body {
        grid-template-columns: 1fr; /* Stack columns on smaller screens */
        gap: 1.5rem;
    }
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
  font-weight: 500; /* Added font-weight */
  cursor: pointer;
  transition: all 0.2s;
  display: inline-flex; /* Align text/icons */
  align-items: center;
  justify-content: center;
  line-height: 1.2; /* Adjust line height */
}
.btn:disabled {
  opacity: 0.6; /* Slightly less opaque */
  cursor: not-allowed;
  background-color: var(--bg-button-disabled, #ccc); /* Optional disabled background */
  border-color: var(--border-button-disabled, #ccc); /* Optional disabled border */
  color: var(--text-button-disabled, #666); /* Optional disabled text */
}

/* Specific button styles */
.btn-primary {
  background-color: var(--primary, #3b82f6);
  color: white;
}
.btn-primary:hover:not(:disabled) {
    background-color: var(--primary-dark, #2563eb); /* Darker on hover */
}

.btn-secondary {
  background-color: var(--secondary, #64748b);
  color: white;
}
.btn-secondary:hover:not(:disabled) {
    background-color: #475569; /* Darker secondary */
}

.btn-success {
  background-color: var(--success, #10b981);
  color: white;
}
.btn-success:hover:not(:disabled) {
    background-color: #059669; /* Darker success */
}

.btn-warning {
  background-color: var(--warning, #f59e0b);
  color: #1f2937; /* Darker text for better contrast on yellow */
}
 .btn-warning:hover:not(:disabled) {
     background-color: #d97706; /* Darker warning */
 }

.btn-danger {
  background-color: var(--danger, #ef4444);
  color: white;
}
 .btn-danger:hover:not(:disabled) {
     background-color: #dc2626; /* Darker danger */
 }


.btn-outline {
  background-color: transparent;
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
}
.btn-outline:hover:not(:disabled) {
  background-color: var(--bg-section);
  border-color: var(--border-color-hover, #cbd5e1); /* Slightly darker border on hover */
}

/* Adjust disabled state specifically for outline */
.btn-outline:disabled {
    background-color: transparent;
    border-color: var(--border-button-disabled, #ccc);
    color: var(--text-button-disabled, #999);
}

/* Dark mode adjustments for buttons */
[data-theme="dark"] .btn-warning {
    color: #1f2937; /* Keep dark text on warning in dark mode */
}
[data-theme="dark"] .btn-outline {
    color: var(--text-secondary-dark, #cbd5e1);
    border-color: var(--border-color-dark, #4b5563);
}
[data-theme="dark"] .btn-outline:hover:not(:disabled) {
    background-color: var(--bg-section-dark, #374151);
    border-color: var(--border-color-hover-dark, #6b7280);
}
[data-theme="dark"] .btn:disabled {
    background-color: var(--bg-button-disabled-dark, #4b5563);
    border-color: var(--border-button-disabled-dark, #4b5563);
    color: var(--text-button-disabled-dark, #9ca3af);
}
[data-theme="dark"] .btn-outline:disabled {
    background-color: transparent;
    border-color: var(--border-button-disabled-dark, #4b5563);
    color: var(--text-button-disabled-dark, #6b7280);
}



.form-group {
  margin-bottom: 1.5rem;
}
.form-group label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 500;
   color: var(--text-secondary); /* Ensure label color */
}
.form-input {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid var(--border-input, var(--border-color)); /* Use input border variable */
  border-radius: 4px;
   background-color: var(--bg-input, #fff); /* Use input background variable */
   color: var(--text-primary); /* Use text color */
   transition: border-color 0.2s, box-shadow 0.2s; /* Add transition */
}
 .form-input:focus {
     outline: none;
     border-color: var(--primary);
     box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3); /* Focus ring */
 }

.form-input:disabled {
  background-color: var(--bg-input-disabled, var(--bg-section)); /* Use disabled input bg */
  color: var(--text-tertiary); /* Dimmer text when disabled */
  cursor: not-allowed;
  border-color: var(--border-input-disabled, var(--border-color));
}
.form-input.is-invalid {
  border-color: var(--danger, #ef4444);
  box-shadow: 0 0 0 1px var(--danger, #ef4444);
}
.info-section {
  background-color: var(--bg-section);
  border-radius: 8px;
  padding: 1.5rem;
  border: 1px solid var(--border-color); /* Add subtle border */
}
.info-item {
  display: flex;
  flex-direction: column;
  margin-bottom: 1rem;
   font-size: 0.9rem; /* Slightly larger base font */
}
.info-label {
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 0.25rem;
  text-transform: uppercase; /* Uppercase label */
   letter-spacing: 0.05em; /* Add letter spacing */
}

/* Ensure info value text color */
.info-item > span:not(.info-label):not(.status-tag) {
    color: var(--text-primary);
}


.info-hash {
  word-break: break-all;
  font-family: monospace;
  font-size: 0.85rem; /* Slightly larger mono font */
  background-color: var(--bg-code, #f3f4f6); /* Code background */
  padding: 0.2rem 0.4rem;
  border-radius: 4px;
  color: var(--text-code, #374151); /* Code text color */
   border: 1px solid var(--border-code, var(--border-color)); /* Code border */
}

[data-theme="dark"] .info-hash {
    background-color: var(--bg-code-dark, #374151);
    color: var(--text-code-dark, #e5e7eb);
    border-color: var(--border-code-dark, #4b5563);
}

.select-all-container {
  display: flex;
  align-items: center;
  margin-bottom: 0.75rem;
   cursor: pointer; /* Make the whole area clickable */
}
.select-all-container input[type="checkbox"] {
  margin-right: 0.5rem;
  cursor: pointer;
  height: 1rem; /* Standardize checkbox size */
  width: 1rem;
}
.select-all-container label {
  margin-bottom: 0; /* Override default form-group label margin */
  font-weight: 600; /* Bold */
  color: var(--text-primary);
  cursor: pointer;
  user-select: none; /* Prevent text selection */
}
.select-all-container input[type="checkbox"]:disabled + label {
    color: var(--text-tertiary);
    cursor: not-allowed;
}


.labels-container {
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid var(--border-input, var(--border-color)); /* Use input border */
  padding: 0.75rem;
  border-radius: 4px;
  background-color: var(--bg-input, #fff); /* Use input background */
}
.loading-state-small {
  font-style: italic;
  color: var(--text-secondary);
   text-align: center;
   padding: 1rem;
}
.label-category {
  margin-bottom: 0.75rem;
}
.label-category strong {
  font-size: 0.9rem;
   color: var(--text-primary);
   display: block; /* Ensure it takes full width */
   margin-bottom: 0.25rem; /* Space below category title */
}
.label-item {
  display: flex;
  align-items: center;
  margin-top: 0.5rem;
  padding-left: 0.5rem; /* Indent items */
  cursor: pointer; /* Make items clickable */
}
.label-item input[type="checkbox"] {
  margin-right: 0.5rem;
  cursor: pointer;
  height: 1rem;
  width: 1rem;
}
.label-item label {
   margin-bottom: 0;
   color: var(--text-secondary);
   cursor: pointer;
   user-select: none;
   font-size: 0.9rem;
}

.label-item input[type="checkbox"]:disabled + label {
    color: var(--text-tertiary);
    cursor: not-allowed;
}

.status-tag {
  display: inline-block;
  padding: 0.2rem 0.6rem;
  border-radius: 1rem;
  font-size: 0.75rem; /* Slightly smaller */
  font-weight: 600;
  line-height: 1.2; /* Adjust line height */
  text-transform: uppercase; /* Uppercase status */
  border: 1px solid transparent; /* Base border */
}
.status-ingested {
  background-color: rgba(16, 185, 129, 0.1);
  color: var(--success, #10b981);
  border-color: rgba(16, 185, 129, 0.3);
}
.status-pending {
  background-color: rgba(245, 158, 11, 0.1);
  color: var(--warning, #f59e0b);
  border-color: rgba(245, 158, 11, 0.3);
}
.status-retracted {
  background-color: rgba(100, 116, 139, 0.1);
  color: var(--secondary, #64748b);
  border-color: rgba(100, 116, 139, 0.3);
}

/* Dark mode adjustments for status tags */
[data-theme="dark"] .status-ingested {
    background-color: rgba(16, 185, 129, 0.2);
    border-color: rgba(16, 185, 129, 0.5);
}
[data-theme="dark"] .status-pending {
    background-color: rgba(245, 158, 11, 0.2);
    border-color: rgba(245, 158, 11, 0.5);
}
[data-theme="dark"] .status-retracted {
    background-color: rgba(100, 116, 139, 0.2);
    border-color: rgba(100, 116, 139, 0.5);
}


.file-view-link {
  color: var(--primary, #3b82f6); /* Use primary color variable */
  text-decoration: none;
  font-weight: 500;
  word-break: break-all;
  cursor: pointer;
  transition: color 0.2s; /* Add transition */
}
.file-view-link:hover {
  text-decoration: underline;
  color: var(--primary-dark, #2563eb); /* Use darker primary on hover */
}
</style>