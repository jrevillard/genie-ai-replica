<template>
    <div class="sidebar" :class="{ collapsed: sidebarCollapsed }">
        <div class="sidebar-header">
            <h3 v-if="!sidebarCollapsed">{{ translate('sidebar.title', 'Info & Resources') }}</h3>
            <button @click="toggleSidebar" class="sidebar-toggle">
                <i class="fas" :class="sidebarCollapsed ? 'fa-chevron-right' : 'fa-chevron-left'"></i>
            </button>
        </div>

        <!-- Only show these sections when sidebar is not collapsed -->
        <div v-if="!sidebarCollapsed">
            <!-- Chat History Section -->
            <div class="sidebar-section">
                <h4 class="section-title">
                    <i class="fas fa-history"></i>
                    {{ translate('sidebar.chatHistory', 'Recent Chats') }}
                </h4>
                <div class="chat-history">
                    <div v-for="chat in recentChats" :key="chat.id" class="history-item"
                        :class="{ active: currentChatId === chat.id }" @click="loadChatFromHistory(chat.id)">
                        <div class="history-item-title">{{ chat.title }}</div>
                        <div class="history-item-preview">{{ chat.preview }}</div>
                        <div class="history-item-date">{{ formatDate(chat.date) }}</div>
                    </div>
                    <div v-if="recentChats.length === 0" class="empty-state">
                        {{ translate('sidebar.noChats', 'No recent chats') }}
                    </div>
                </div>
            </div>
            <!-- Related Documents Section -->
            <div class="sidebar-section">
                <h4 class="section-title">
                    <i class="fas fa-file-alt"></i>
                    {{ translate('sidebar.relatedDocs', 'Related Documents') }}
                </h4>
                <div class="related-documents">
                    <div v-for="doc in relatedDocuments" :key="doc.id" class="document-item" @click="openDocument(doc)">
                        <div class="document-icon">
                            <i :class="documentIconClass(doc.type)"></i>
                        </div>
                        <div class="document-info">
                            <div class="document-title">{{ doc.title }}</div>
                            <div class="document-meta">{{ doc.type }} • {{ formatFileSize(doc.size) }}</div>
                        </div>
                    </div>
                    <div v-if="relatedDocuments.length === 0" class="empty-state">
                        {{ translate('sidebar.noDocuments', 'No related documents') }}
                    </div>
                </div>
            </div>
            <!-- FAQ Section -->
            <div class="sidebar-section">
                <h4 class="section-title">
                    <i class="fas fa-question-circle"></i>
                    {{ translate('sidebar.faq', 'Frequently Asked Questions') }}
                </h4>
                <div class="faq-list">
                    <div v-for="(faq, index) in frequentlyAskedQuestions" :key="index" class="faq-item">
                        <div class="faq-question" @click="toggleFaq(index)"
                            :class="{ active: expandedFaqs.includes(index) }">
                            {{ faq.question }}
                            <i class="fas"
                                :class="expandedFaqs.includes(index) ? 'fa-chevron-up' : 'fa-chevron-down'"></i>
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
    name: 'RightSideBarComponent',

    props: {
        currentChatId: {
            type: String,
            default: null
        },
        translations: {
            type: Object,
            required: true
        },
        currentLocale: {
            type: String,
            default: 'en'
        }
    },

    data() {
        return {
            sidebarCollapsed: false,
            expandedFaqs: [],

            // Sidebar content
            recentChats: [
                { id: 'chat1', title: 'Tax Filing Help', preview: 'How do I file my business taxes?', date: new Date('2025-03-06T14:23:00') },
                { id: 'chat2', title: 'License Renewal', preview: 'What documents do I need to renew my...', date: new Date('2025-03-04T09:15:00') },
                { id: 'chat3', title: 'Business Registration', preview: 'I want to register a new business', date: new Date('2025-03-01T16:45:00') }
            ],

            relatedDocuments: [
                { id: 'doc1', title: 'Government Services FAQ', type: 'PDF', size: 1240000, url: '#' },
                { id: 'doc2', title: 'Business Registration Form', type: 'DOCX', size: 350000, url: '#' },
                { id: 'doc3', title: 'Tax Filing Guidelines 2024', type: 'PDF', size: 2800000, url: '#' },
                { id: 'doc4', title: 'ID Application Process', type: 'PDF', size: 890000, url: '#' }
            ],

            frequentlyAskedQuestions: [
                {
                    question: 'How do I reset my account password?',
                    answer: 'To reset your password, go to the login page and click "Forgot Password". Follow the instructions sent to your registered email.'
                },
                {
                    question: 'Where can I find my tax ID number?',
                    answer: 'Your tax ID number is listed on your tax registration certificate and on any correspondence from the tax authority.'
                },
                {
                    question: 'What documents are needed for ID application?',
                    answer: 'You need your birth certificate, proof of address (not older than 3 months), two passport photos, and a completed application form.'
                },
                {
                    question: 'How long does business registration take?',
                    answer: 'Standard business registration typically takes 3-5 business days after all required documents have been correctly submitted.'
                }
            ]
        };
    },

    methods: {
        toggleSidebar() {
            this.sidebarCollapsed = !this.sidebarCollapsed;
            this.$emit('sidebar-toggle', this.sidebarCollapsed);
        },

        toggleFaq(index) {
            if (this.expandedFaqs.includes(index)) {
                this.expandedFaqs = this.expandedFaqs.filter(i => i !== index);
            } else {
                this.expandedFaqs.push(index);
            }
        },

        loadChatFromHistory(chatId) {
            this.$emit('load-chat', chatId);
        },

        openDocument(doc) {
            // In a real application, this would open the document
            window.open(doc.url, '_blank');
            this.$emit('open-document', doc);
        },

        translate(key, fallback) {
            // Try from local translations
            const localTranslation = this.translations[this.currentLocale]?.[key];
            if (localTranslation) {
                return localTranslation;
            }

            // Fall back to English translation or fallback
            return this.translations['en']?.[key] || fallback;
        },

        documentIconClass(type) {
            switch (type.toLowerCase()) {
                case 'pdf': return 'fas fa-file-pdf';
                case 'docx': case 'doc': return 'fas fa-file-word';
                case 'xlsx': case 'xls': return 'fas fa-file-excel';
                case 'pptx': case 'ppt': return 'fas fa-file-powerpoint';
                case 'txt': return 'fas fa-file-alt';
                default: return 'fas fa-file';
            }
        },

        formatDate(date) {
            // Returns relative time (Today, Yesterday) or formatted date
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);

            if (date >= today) {
                return 'Today';
            } else if (date >= yesterday) {
                return 'Yesterday';
            } else {
                return date.toLocaleDateString();
            }
        },

        formatFileSize(bytes) {
            if (bytes < 1024) return bytes + ' B';
            if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
            return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        }
    }
}
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

/* Chat History styles */
.chat-history {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.history-item {
    background: var(--bg-card, #fff);
    border-radius: 6px;
    padding: 10px 12px;
    cursor: pointer;
    transition: all 0.2s ease;
    border: 1px solid var(--border-light, #e5e7eb);
}

.history-item:hover,
.history-item.active {
    background: var(--bg-tertiary, #f0f7ff);
    border-color: var(--accent-color, #bcdcff);
}

.history-item-title {
    font-weight: 500;
    font-size: 0.9rem;
    margin-bottom: 4px;
    color: var(--text-primary, #334155);
}

.history-item-preview {
    font-size: 0.8rem;
    color: var(--text-tertiary, #64748b);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-bottom: 4px;
}

.history-item-date {
    font-size: 0.75rem;
    color: var(--text-muted, #94a3b8);
    text-align: right;
}

/* Document styles */
.related-documents {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.document-item {
    display: flex;
    align-items: center;
    background: var(--bg-card, #fff);
    border-radius: 6px;
    padding: 10px 12px;
    cursor: pointer;
    transition: all 0.2s ease;
    border: 1px solid var(--border-light, #e5e7eb);
    gap: 12px;
}

.document-item:hover {
    background: var(--bg-tertiary, #f0f7ff);
    border-color: var(--accent-color, #bcdcff);
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

[data-theme="dark"] .history-item-title,
html[data-theme="dark"] .history-item-title,
[data-theme="dark"] .document-title,
html[data-theme="dark"] .document-title,
[data-theme="dark"] .faq-question,
html[data-theme="dark"] .faq-question {
    color: rgba(255, 255, 255, 0.9) !important;
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