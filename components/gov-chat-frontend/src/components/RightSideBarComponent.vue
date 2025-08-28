<template>
  <div class="sidebar" :class="{ collapsed: sidebarCollapsed }">
    <div class="sidebar-header">
      <h3 v-if="!sidebarCollapsed">{{ $t("sidebar.title") }}</h3>
      <button @click="toggleSidebar" class="sidebar-toggle">
        <i
          class="fas"
          :class="sidebarCollapsed ? 'fa-chevron-right' : 'fa-chevron-left'"
        ></i>
      </button>
    </div>

    <!-- Only show these sections when sidebar is not collapsed -->
    <div v-if="!sidebarCollapsed">
      <!-- Related Documents Section -->
      <div class="sidebar-section">
        <h4 class="section-title">
          <i class="fas fa-file-alt"></i>
          {{ $t("sidebar.relatedDocs") }}
        </h4>
        <div class="related-documents">
          <div
            v-for="doc in relatedDocuments"
            :key="doc.id"
            class="document-item"
          >
            <div class="document-header" @click="openDocument(doc)">
              <div class="document-icon">
                <i :class="documentIconClass(doc.type)"></i>
              </div>
              <div class="document-info">
                <div class="document-title">{{ doc.title }}</div>
                <div class="document-meta">
                  {{ doc.type }} • {{ formatFileSize(doc.size) }}
                </div>
              </div>
            </div>
            <div class="document-details">
              <div class="detail-item">
                <span class="detail-label">{{ $t("sidebar.id") }}:</span>
                <span class="detail-value">{{ doc.id }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">{{ $t("sidebar.labels") }}:</span>
                <span class="detail-value small-text">{{ formatLabels(doc) }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">{{ $t("sidebar.confidence") }}:</span>
                <span class="detail-value">{{ formatScore(doc.score) }}</span>
              </div>
            </div>
          </div>
          <div v-if="relatedDocuments.length === 0" class="empty-state">
            {{ $t("sidebar.noDocuments") }}
          </div>
        </div>
      </div>
      <!-- FAQ Section -->
      <div class="sidebar-section">
        <h4 class="section-title">
          <i class="fas fa-question-circle"></i>
          {{ $t("sidebar.faq") }}
        </h4>
        <div class="faq-list">
          <div
            v-for="(faq, index) in frequentlyAskedQuestions"
            :key="index"
            class="faq-item"
          >
            <div
              class="faq-question"
              @click="toggleFaq(index)"
              :class="{ active: expandedFaqs.includes(index) }"
            >
              {{ faq.question }}
              <i
                class="fas"
                :class="
                  expandedFaqs.includes(index)
                    ? 'fa-chevron-up'
                    : 'fa-chevron-down'
                "
              ></i>
            </div>
            <div class="faq-answer" v-if="expandedFaqs.includes(index)">
              {{ faq.answer }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: "RightSideBarComponent",

  props: {
    currentChatId: {
      type: String,
      default: null,
    },
    currentLocale: {
      type: String,
      default: "en",
    },
    relatedDocuments: {
      type: Array,
      default: () => [
        {
          id: "doc1",
          title: "Government Services FAQ",
          type: "PDF",
          size: 1240000,
          url: "#",
          categoryLabel: "General",
          serviceLabels: ["FAQ", "Services"],
          score: 0.95,
        },
        {
          id: "doc2",
          title: "Business Registration Form",
          type: "DOCX",
          size: 350000,
          url: "#",
          categoryLabel: "Business & Trade",
          serviceLabels: ["Business Registration"],
          score: 0.90,
        },
        {
          id: "doc3",
          title: "Tax Filing Guidelines 2024",
          type: "PDF",
          size: 2800000,
          url: "#",
          categoryLabel: "Taxation",
          serviceLabels: ["Filing", "Guidelines"],
          score: 0.85,
        },
        {
          id: "doc4",
          title: "ID Application Process",
          type: "PDF",
          size: 890000,
          url: "#",
          categoryLabel: "Identity & Civil Registration",
          serviceLabels: ["Birth Registration"],
          score: 0.92,
        },
      ]
    }
  },

  data() {
    return {
      sidebarCollapsed: false,
      expandedFaqs: [],

      // Sidebar content
      frequentlyAskedQuestions: [
        {
          question: "How do I reset my account password?",
          answer:
            'To reset your password, go to the login page and click "Forgot Password". Follow the instructions sent to your registered email.',
        },
        {
          question: "Where can I find my tax ID number?",
          answer:
            "Your tax ID number is listed on your tax registration certificate and on any correspondence from the tax authority.",
        },
        {
          question: "What documents are needed for ID application?",
          answer:
            "You need your birth certificate, proof of address (not older than 3 months), two passport photos, and a completed application form.",
        },
        {
          question: "How long does business registration take?",
          answer:
            "Standard business registration typically takes 3-5 business days after all required documents have been correctly submitted.",
        },
      ],
    };
  },

  methods: {
    toggleSidebar() {
      this.sidebarCollapsed = !this.sidebarCollapsed;
      this.$emit("sidebar-toggle", this.sidebarCollapsed);
    },

    toggleFaq(index) {
      if (this.expandedFaqs.includes(index)) {
        this.expandedFaqs = this.expandedFaqs.filter((i) => i !== index);
      } else {
        this.expandedFaqs.push(index);
      }
    },

    openDocument(doc) {
      // In a real application, this would open the document
      window.open(doc.url, "_blank");
      this.$emit("open-document", doc);
    },

    documentIconClass(type) {
      switch (type.toLowerCase()) {
        case "pdf":
          return "fas fa-file-pdf";
        case "docx":
        case "doc":
          return "fas fa-file-word";
        case "xlsx":
        case "xls":
          return "fas fa-file-excel";
        case "pptx":
        case "ppt":
          return "fas fa-file-powerpoint";
        case "txt":
          return "fas fa-file-alt";
        default:
          return "fas fa-file";
      }
    },

    formatFileSize(bytes) {
      if (bytes < 1024) return bytes + " B";
      if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
      return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    },

    formatScore(score) {
      if (typeof score !== 'number' || isNaN(score)) return this.$t("sidebar.unknown");
      return (score * 100).toFixed(2) + '%';
    },

    formatLabels(doc) {
      if (!doc.categoryLabel) return this.$t("sidebar.unknown");
      const services = doc.serviceLabels?.join(', ') || '';
      return `${doc.categoryLabel}${services ? ':' + services : ''}`;
    },
  },
};
</script>

<style scoped>
/* Sidebar Styles */
.sidebar {
  width: 320px;
  background: var(--bg-sidebar, #f8fafc);
  border-left: 1px solid var(--border-color, #e2e8f0);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  transition: width 0.3s ease;
}

.sidebar.collapsed {
  width: 50px;
  overflow: visible;
  /* Allow the toggle button to be visible */
}

.sidebar-header {
  padding: 16px;
  border-bottom: 1px solid var(--border-color, #e2e8f0);
  display: flex;
  justify-content: space-between;
  align-items: center;
  position: relative;
}

.sidebar.collapsed .sidebar-header {
  padding: 16px 0;
  justify-content: center;
  border-bottom: none;
}

.sidebar-toggle {
  background: none;
  border: none;
  color: var(--text-tertiary, #64748b);
  cursor: pointer;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all 0.2s ease;
  z-index: 10;
}

.sidebar-toggle:hover {
  background: var(--bg-tertiary, #e2e8f0);
  color: var(--text-secondary, #334155);
}

.sidebar-section {
  padding: 16px;
  border-bottom: 1px solid var(--border-color, #e2e8f0);
}

.section-title {
  margin: 0 0 16px 0;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text-primary, #475569);
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-title i {
  font-size: 0.9rem;
  color: var(--text-tertiary, #64748b);
}

/* Document styles */
.related-documents {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.document-item {
  background: var(--bg-card, #fff);
  border-radius: 6px;
  padding: 12px;
  transition: all 0.2s ease;
  border: 1px solid var(--border-light, #e5e7eb);
}

.document-header {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  margin-bottom: 8px;
}

.document-header:hover {
  color: var(--accent-color, #4e97d1);
}

.document-icon {
  font-size: 1.2rem;
  color: var(--text-tertiary, #64748b);
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.document-info {
  flex: 1;
  overflow: hidden;
}

.document-title {
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--text-primary, #334155);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 2px;
}

.document-meta {
  font-size: 0.75rem;
  color: var(--text-muted, #94a3b8);
}

.document-details {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.8rem;
  color: var(--text-secondary, #475569);
  padding-top: 8px;
  border-top: 1px solid var(--border-light, #e5e7eb);
}

.detail-item {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.detail-label {
  font-weight: 500;
  color: var(--text-primary, #334155);
  white-space: nowrap;
}

.detail-value {
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
}

.detail-value.small-text {
  font-size: 0.75rem;
}

/* FAQ styles */
.faq-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.faq-item {
  border: 1px solid var(--border-light, #e5e7eb);
  border-radius: 6px;
  overflow: hidden;
}

.faq-question {
  padding: 12px;
  background: var(--bg-card, #fff);
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--text-primary, #334155);
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.faq-question:hover,
.faq-question.active {
  background: var(--bg-tertiary, #f0f7ff);
}

.faq-question i {
  font-size: 0.8rem;
  color: var(--text-tertiary, #64748b);
}

.faq-answer {
  padding: 12px;
  font-size: 0.85rem;
  color: var(--text-secondary, #475569);
  background: var(--bg-tertiary, #f8fafc);
  border-top: 1px solid var(--border-light, #e2e8f0);
  line-height: 1.5;
}

.empty-state {
  text-align: center;
  padding: 16px;
  color: var(--text-muted, #94a3b8);
  font-size: 0.9rem;
  font-style: italic;
}

/* Mobile specific adjustments */
@media (max-width: 768px) {
  .sidebar {
    position: fixed;
    right: 0;
    top: 0;
    bottom: 0;
    z-index: 100;
    transform: translateX(100%);
  }

  .sidebar.visible {
    transform: translateX(0);
  }

  .sidebar.collapsed {
    transform: translateX(calc(100% - 50px));
  }
}

/* Additional fixes for dark theme visibility */
[data-theme="dark"] .section-title,
html[data-theme="dark"] .section-title {
  color: rgba(255, 255, 255, 0.9) !important;
}

[data-theme="dark"] .document-title,
html[data-theme="dark"] .document-title,
[data-theme="dark"] .faq-question,
html[data-theme="dark"] .faq-question,
[data-theme="dark"] .detail-label,
html[data-theme="dark"] .detail-label {
  color: rgba(255, 255, 255, 0.9) !important;
}

[data-theme="dark"] .detail-value,
html[data-theme="dark"] .detail-value,
[data-theme="dark"] .document-meta,
html[data-theme="dark"] .document-meta {
  color: rgba(255, 255, 255, 0.7) !important;
}

[data-theme="dark"] .empty-state,
html[data-theme="dark"] .empty-state {
  color: rgba(255, 255, 255, 0.6) !important;
}

[data-theme="dark"] .sidebar-header h3,
html[data-theme="dark"] .sidebar-header h3 {
  color: rgba(255, 255, 255, 0.9) !important;
}
</style>