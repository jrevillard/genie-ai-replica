<template>
  <div class="app-container">
    <!-- Main chatbot container -->
    <div class="chatbot-container" data-test-id="chatbot-container">
      <!-- New Chat Confirmation Dialog -->
      <ConfirmDialog
        :visible="showNewChatConfirm"
        :title="newChatDialog.title"
        :message="newChatDialog.message"
        :confirm-text="newChatDialog.confirmText"
        :cancel-text="newChatDialog.cancelText"
        :secondary-text="newChatDialog.secondaryText"
        @confirm="saveAndStartNewChat"
        @cancel="startNewChatConfirmed"
        @secondary="cancelNewChat"
      />

      <!-- Unsaved Changes Load Confirmation Dialog -->
      <ConfirmDialog
        :visible="showLoadConfirm"
        :title="loadConfirmDialog.title"
        :message="loadConfirmDialog.message"
        :confirm-text="loadConfirmDialog.confirmText"
        :cancel-text="loadConfirmDialog.cancelText"
        :secondary-text="loadConfirmDialog.secondaryText"
        @confirm="loadConversationConfirmed"
        @cancel="cancelLoadConversation"
        @secondary="saveAndLoadConversation"
      />

      <!-- Export PDF Dialog -->
      <modal-dialog v-if="exportDialog.visible" @close="exportDialog.visible = false">
        <template #header>
          <h3>{{ translate('chatbot.exportChat') }}</h3>
        </template>
        <template #body>
          <div class="form-group">
            <label for="exportFilename">{{ translate('chatbot.exportFilename') }}</label>
            <DsInput
              id="exportFilename"
              v-model="exportDialog.filename"
              type="text"
              :placeholder="translate('chatbot.exportFilenamePlaceholder')"
            />
          </div>
        </template>
        <template #footer>
          <DsButton variant="secondary" @click="exportDialog.visible = false">
            {{ translate('common.cancel') }}
          </DsButton>
          <DsButton variant="primary" :disabled="!exportDialog.filename.trim()" @click="exportChatToPDF">
            {{ translate('chatbot.exportButton') }}
          </DsButton>
        </template>
      </modal-dialog>

      <!-- The conversation header: names the open conversation and closes
           it. The close button runs startNewChat, whose confirm guards
           unsaved changes; saved history is never removed by closing. -->
      <div class="conversation-header">
        <span class="conversation-header__title" data-testid="conversation-header-title">
          {{ conversationTitle }}
        </span>
        <div class="conversation-header__actions">
          <button
            v-if="openMessages.length > 0"
            type="button"
            class="conversation-header__action"
            :title="translate('chatbot.saveChat')"
            :aria-label="translate('chatbot.saveChat')"
            :disabled="isSaving"
            data-testid="conversation-header-save"
            @click="saveChatToHistory"
          >
            <Save :size="16" aria-hidden="true" />
          </button>
          <button
            v-if="openMessages.length > 0"
            type="button"
            class="conversation-header__action"
            :title="translate('chatbot.exportChat')"
            :aria-label="translate('chatbot.exportChat')"
            data-testid="conversation-header-export"
            @click="openExportDialog"
          >
            <FileDown :size="16" aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          class="conversation-header__close"
          :title="translate('chatbot.closeConversation', 'Close conversation')"
          :aria-label="translate('chatbot.closeConversation', 'Close conversation')"
          data-testid="conversation-header-close"
          @click="startNewChat"
        >
          <X :size="16" aria-hidden="true" />
        </button>
      </div>
      <!-- Context Panel for selected tree nodes -->
      <div v-if="selectedContextItems.length > 0" class="context-panel">
        <div class="context-header">
          <span class="context-title">{{ translate('chatbot.queryContext') }}</span>
        </div>
        <div class="context-items">
          <DsPill v-for="(item, index) in selectedContextItems" :key="index">
            <span>{{ item.service }}</span>
            <DsButton
              variant="ghost"
              :small="true"
              :aria-label="translate('chatbot.removeItem')"
              @click="removeContextItem(index)"
            >
              ✕
            </DsButton>
          </DsPill>
        </div>
      </div>
      <!-- The scrollable chat window -->
      <div ref="chatWindow" class="chat-window" aria-live="polite">
        <div
          v-for="(msg, index) in openMessages"
          :key="`${msg.sender}-${msg.timestamp || ''}-${index}`"
          class="chat-message"
          :class="msg.sender"
        >
          <div
            v-if="msg.sender === 'bot'"
            class="message-avatar message-avatar--assistant"
            data-testid="assistant-avatar"
          >
            <img v-if="assistantIcon.type === 'file'" :src="assistantIcon.value" alt="" />
            <!-- eslint-disable-next-line vue/no-v-html -->
            <span v-else class="message-avatar__glyph" v-html="assistantIcon.value"></span>
          </div>
          <div v-else class="message-avatar message-avatar--user" data-testid="user-avatar">
            <img v-if="userAvatarUrl" :src="userAvatarUrl" alt="" />
            <span v-else-if="userInitials" class="message-avatar__initials">{{ userInitials }}</span>
            <span v-else class="message-avatar__silhouette" aria-hidden="true"><User :size="18" /></span>
          </div>
          <div class="message-wrapper">
            <!-- The assistant answer lives in one elevated card from the
                 first streaming frame; sources, actions and the confidence block
                 render inside it below the bubble. -->
            <div v-if="msg.sender === 'bot'" class="answer-card" data-testid="answer-card">
              <div v-if="msg.isError" class="answer-error" data-testid="answer-error">
                <AlertTriangle :size="16" aria-hidden="true" />
                <span>{{ translate('chatbot.errorUnableToComplete', 'Unable to complete the response.') }}</span>
                <button type="button" class="answer-retry" data-testid="answer-retry" @click="retryAnswer(index)">
                  <RotateCcw :size="14" aria-hidden="true" />
                  <span>{{ translate('chatbot.retry', 'Retry') }}</span>
                </button>
              </div>
              <div v-else class="message-bubble">
                <div v-if="msg.isStreaming && !msg.content" class="streaming-indicator">
                  <DsSpinner size="sm" />
                  <span>{{ translate('chatbot.thinking', 'Thinking...') }}</span>
                </div>
                <!-- Render bot messages as sanitized HTML for Markdown -->
                <!-- eslint-disable-next-line vue/no-v-html -->
                <div v-else v-html="renderMarkdown(msg.content)"></div>
              </div>
              <!-- Per-answer collapsible sources -->
              <div v-if="msg.sources && msg.sources.length" class="answer-sources" data-testid="answer-sources">
                <button
                  type="button"
                  class="answer-sources__toggle"
                  data-testid="answer-sources-toggle"
                  :aria-expanded="msg.sourcesOpen ? 'true' : 'false'"
                  @click="msg.sourcesOpen = !msg.sourcesOpen"
                >
                  <span>{{ $t('chatbot.relatedSources', { n: msg.sources.length }) }}</span>
                  <ChevronUp v-if="msg.sourcesOpen" :size="16" aria-hidden="true" />
                  <ChevronDown v-else :size="16" aria-hidden="true" />
                </button>
                <div v-show="msg.sourcesOpen" class="answer-sources__list">
                  <button
                    v-for="(d, di) in msg.sources"
                    :key="d.id"
                    type="button"
                    class="answer-source-card"
                    :data-testid="`answer-source-card-${di}`"
                    @click="openSourceDocument(d)"
                  >
                    <span class="file-type-badge" :data-tone="fileBadge(d).tone">{{ fileBadge(d).label }}</span>
                    <span class="answer-source-card__body">
                      <span class="answer-source-card__title">{{ d.title }}</span>
                      <span v-if="d._size" class="answer-source-card__size">{{ sourceSize(d) }}</span>
                    </span>
                    <ExternalLink :size="14" class="answer-source-card__open" aria-hidden="true" />
                  </button>
                </div>
              </div>
              <!-- Not grounded: the answer came from the LLM's own knowledge, not library documents -->
              <div v-if="msg.isGrounded === false" class="answer-warning" role="note">
                <AlertTriangle :size="15" aria-hidden="true" />
                <span>{{
                  translate('chatbot.aiGeneratedNoDocs', 'AI-generated — not based on library documents')
                }}</span>
              </div>
              <!-- The translation backend did not answer. The text above is the
                   original response, not a translation of it. -->
              <div v-if="msg.translationFailed" class="answer-warning" data-testid="translation-failed" role="note">
                <Languages :size="15" aria-hidden="true" />
                <span>
                  {{
                    translate(
                      'chatbot.translationUnavailable',
                      'Translation unavailable — this answer may contain untranslated text.'
                    )
                  }}
                </span>
              </div>
              <!-- Inline actions — thumbs, details, copy — with the
                   confidence percentage at the end of the row. -->
              <div v-if="msg.queryId" class="answer-actions" data-testid="answer-actions">
                <button
                  type="button"
                  class="answer-action"
                  data-testid="answer-thumb-up"
                  :data-rated="msg.userFeedback === 'up' ? 'true' : 'false'"
                  :aria-pressed="msg.userFeedback === 'up'"
                  :title="translate('feedback.helpful')"
                  @click="rateAnswer(index, 'up')"
                >
                  <ThumbsUp :size="15" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  class="answer-action"
                  data-testid="answer-thumb-down"
                  :data-rated="msg.userFeedback === 'down' ? 'true' : 'false'"
                  :aria-pressed="msg.userFeedback === 'down'"
                  :title="translate('feedback.notHelpful')"
                  @click="rateAnswer(index, 'down')"
                >
                  <ThumbsDown :size="15" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  class="answer-action"
                  data-testid="answer-details"
                  :title="translate('feedback.button')"
                  @click="openFeedbackDialog(index)"
                >
                  <MessageSquareQuote :size="15" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  class="answer-action"
                  :class="{ 'answer-action--done': msg.copied }"
                  data-testid="answer-copy"
                  :title="translate('chatbot.copyAnswer')"
                  @click="copyAnswer(msg)"
                >
                  <Check v-if="msg.copied" :size="15" aria-hidden="true" />
                  <Copy v-else :size="15" aria-hidden="true" />
                </button>
                <!-- The confidence percentage is a state, not an action —
                     parked at the end of the row. It steps aside when the
                     answer is ungrounded (no score to show). -->
                <span
                  v-if="msg.confidenceScore != null && msg.isGrounded !== false"
                  class="confidence-score"
                  data-testid="confidence-score"
                >
                  <Brain :size="14" aria-hidden="true" />
                  <span>{{ $t('chatbot.confidence') }}: {{ (msg.confidenceScore * 100).toFixed(0) }}%</span>
                </span>
              </div>
            </div>
            <div v-else class="message-bubble">
              <span>{{ msg.content }}</span>
            </div>
            <span class="message-time">{{ formatMessageTime(msg.timestamp) }}</span>
          </div>
        </div>
        <!-- Auto-scroll anchor element -->
        <div ref="messagesEnd"></div>
      </div>
      <!-- Quick Help Overlay -->
      <div v-if="showQuickHelp && selectedContextItems.length === 0 && !conversationStarted" class="quick-help-overlay">
        <!-- The banner is a real element so its height can grow with the
             heading + subtitle inside it (a content-aware box), and the
             heading reads as sitting inside the artwork instead of below
             a hard cut. With the Living Intelligence layer switched
             off, the banner has no special styling and the layout is
             identical to the legacy version: heading + subtitle stack
             above the composer / grid as ordinary block-flow children. -->
        <div class="quick-help-banner">
          <div class="quick-help-content">
            <i18n-t keypath="chatbot.whatCanIHelp" tag="h2" class="quick-help-heading">
              <template #brandwordmark>
                <span :class="brandWordmarkClass">{{ brandName }}</span>
              </template>
            </i18n-t>
            <p class="quick-help-subtitle">{{ translate('chatbot.quickHelpSubtitle') }}</p>
          </div>

          <!-- Mascot guide bubble (el-salvador): framed speech-bubble
               anchored bottom-right of the banner artwork — the farmer in
               the hero image appears to be speaking. Absolute inside the
               banner, which this component anchors itself. -->
          <div class="welcome-mascot-bubble" role="note">
            {{ translate('chatbot.mascotGreeting') }}
          </div>
        </div>

        <!-- The composer is the just-chat entry: between the banner and
             the grid, inside the overlay. A second composer is mounted
             at the chat-input slot under v-else, so the two positions
             share exactly one composer instance, never two. The leading
             slot carries the entry's chat-bubble icon; the parent
             gives it the localised title as accessible name. -->
        <div v-if="composerEntry" class="quick-help-composer">
          <ChatComposer
            v-model="newMessage"
            input-id="welcome-composer-input"
            :placeholder="translate('chatbot.composerPlaceholder')"
            :accessible-name="composerEntry.service"
            :tint="composerEntry.styles"
            :show-actions="true"
            :attach-title="translate('chatbot.composerAttachTitle')"
            :mic-title="translate('chatbot.composerMicTitle')"
            :send-title="translate('chatbot.composerSendTitle')"
            data-testid="welcome-composer"
            @send="handleWelcomeSend"
          >
            <template #leading>
              <Sparkles
                class="composer-leading-mark"
                :size="22"
                aria-hidden="true"
                data-testid="welcome-composer-leading-mark"
              />
            </template>
          </ChatComposer>
        </div>

        <div class="quick-help-grid">
          <DsCard
            v-for="button in tileButtons"
            :key="button.id"
            variant="flat"
            padding="md"
            :hoverable="true"
            class="quick-help-item"
            :class="{ 'just-chat': !button.category }"
            :style="buttonTintStyle(button)"
            @click="selectQuickHelpOption(button)"
          >
            <img class="quick-help-icon" :src="button.icon" alt="Quick Help Icon" />
            <div class="quick-help-text">{{ button.service }}</div>
          </DsCard>
        </div>

        <!-- Insights Section (el-salvador) -->
        <div class="insights-section">
          <div class="section-header">
            <h3 class="section-title">{{ translate('charts.insights') }}</h3>
          </div>
          <div class="insights-cards">
            <CropHealthSummaryCard @open-chart="openChart('crop-health')" />
            <PestAlertSummaryCard @open-chart="openChart('pest-alert')" />
          </div>
        </div>

        <!-- Market Prices Section (el-salvador). The closing tags for this
             section and the overlay are the shared lines that follow. -->
        <div class="market-prices-section">
          <div class="section-header">
            <h3 class="section-title">{{ translate('charts.market.sectionTitle') }}</h3>
          </div>
          <div class="market-cards">
            <MarketPriceSummaryCard category="maize" @open-chart="openChart('market-price', 'maize')" />
            <MarketPriceSummaryCard
              category="cropProtection"
              @open-chart="openChart('market-price', 'cropProtection')"
            />
            <MarketPriceSummaryCard category="vegetables" @open-chart="openChart('market-price', 'vegetables')" />
            <MarketPriceSummaryCard category="livestock" @open-chart="openChart('market-price', 'livestock')" />
            <MarketPriceSummaryCard category="fertilizer" @open-chart="openChart('market-price', 'fertilizer')" />
            <MarketPriceSummaryCard category="apiary" @open-chart="openChart('market-price', 'apiary')" />
            <MarketPriceSummaryCard category="aquaculture" @open-chart="openChart('market-price', 'aquaculture')" />
            <MarketPriceSummaryCard
              category="harvestStorage"
              @open-chart="openChart('market-price', 'harvestStorage')"
            />
          </div>
        </div>
      </div>

      <!-- Input Area -->
      <div v-else class="chat-input">
        <ChatComposer
          v-model="newMessage"
          input-id="chat-composer-input"
          :placeholder="translate('chatbot.placeholder')"
          :show-actions="true"
          :attach-title="translate('chatbot.composerAttachTitle')"
          :mic-title="translate('chatbot.composerMicTitle')"
          :max-lines="5"
          :send-title="translate('chatbot.composerSendTitle')"
          data-testid="chat-composer"
          @send="sendMessage"
          @focus="handleTextareaFocus"
        >
        </ChatComposer>
      </div>
      <!-- Chart Dialog -->
      <ChartDialog :visible="chartDialog.visible" :title="chartDialog.title" @close="closeChartDialog">
        <CropHealthChart v-if="chartDialog.type === 'crop-health'" />
        <PestAlertChart v-if="chartDialog.type === 'pest-alert'" />
        <MarketPriceChart v-if="chartDialog.type === 'market-price'" :category="chartDialog.category || 'maize'" />
      </ChartDialog>
      <!-- Feedback Dialog -->
      <chat-response-feedback-dialog
        v-if="feedbackDialog.visible"
        :visible="feedbackDialog.visible"
        :message="feedbackDialog.message"
        @close="closeFeedbackDialog"
        @submit="handleFeedbackSubmit"
      />
      <!-- Save Chat Dialog -->
      <modal-dialog
        v-if="saveChatDialog.visible"
        :close-on-click-modal="!isSaving"
        :close-on-press-escape="!isSaving"
        @close="isSaving ? null : (saveChatDialog.visible = false)"
      >
        <template #header>
          <h3>{{ translate('chatbot.saveChat') }}</h3>
        </template>
        <template #body>
          <div class="form-group">
            <label for="chatTitle">{{ translate('chatbot.chatTitle') }}</label>
            <DsInput
              id="chatTitle"
              v-model="saveChatDialog.title"
              type="text"
              :placeholder="translate('chatbot.chatTitlePlaceholder')"
              :disabled="isSaving"
            />
          </div>
          <div class="form-group">
            <label for="chatFolder">{{ translate('chatbot.selectFolder') }}</label>
            <DsSelect id="chatFolder" v-model="saveChatDialog.folderId" :disabled="isSaving">
              <option v-for="folder in folders" :key="folder.id" :value="folder.id">
                {{ folder.name }}
              </option>
            </DsSelect>
          </div>
          <!-- Loading Indicator -->
          <div v-if="isSaving" class="saving-indicator">
            <Loader2 :size="16" class="animate-spin" />
            <span>{{ translate('chatbot.savingConversation') }}</span>
          </div>
        </template>
        <template #footer>
          <DsButton variant="secondary" :disabled="isSaving" @click="saveChatDialog.visible = false">
            {{ translate('common.cancel') }}
          </DsButton>
          <DsButton variant="primary" :disabled="isSaving || !saveChatDialog.title.trim()" @click="handleSaveChat">
            <span v-if="isSaving">
              <Loader2 :size="16" class="animate-spin" />
              {{ translate('chatbot.saving') }}
            </span>
            <span v-else>{{ translate('common.save') }}</span>
          </DsButton>
        </template>
      </modal-dialog>
    </div>
    <!-- Right Sidebar - the width and collapsed state are owned here
         so both sidebars stay in sync via localStorage. The handle's
         on-panel edge replaces the old inline chevron button, but
         the gesture (collapse / expand) reads the same. -->
    <right-side-bar-component
      :current-locale="currentLocale"
      :related-documents="relatedDocuments"
      :width="rightSidebarWidth"
      :max-width="rightSidebarMaxWidth"
      :collapsed="rightSidebarCollapsed"
      :show-handle="showRightHandle"
      @open-document="handleOpenDocument"
      @update:width="onRightWidthChange"
      @update:collapsed="onRightCollapsedChange"
    />
  </div>
</template>

<script>
import {
  AlertTriangle,
  Brain,
  FileDown,
  Save,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Languages,
  Loader2,
  MessageSquareQuote,
  Sparkles,
  Check,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
  User,
  X
} from '@lucide/vue';
import { formatFileSize } from '../utils/fileUtils.js';
import { isStorableTurn, translateSources } from '../store/modules/conversation';
import { isExternalUrl, openRepositoryDocument, fileTypeBadge } from '../utils/document-opener.js';
import { eventBus } from '../eventBus.js';
import notificationService from '../services/notificationService';
import { mapGetters, mapActions } from 'vuex';
import { getUserId } from '../utils/userUtils';
import ChatResponseFeedbackDialog from './ChatResponseFeedbackDialog.vue';
import ModalDialog from './ModalDialog.vue';
import RightSideBarComponent from './RightSideBarComponent.vue';
import chatbotService, { THUMB_RATINGS } from '../services/chatbotService';
import { config as runtimeConfig } from '../config-loader';
import serviceTreeService from '../services/serviceTreeService'; // *** NEW: Import serviceTreeService
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import ChatComposer from './ChatComposer.vue';
import chatHistoryService from '../services/chatHistoryService';
import DsSpinner from './ds/Spinner.vue';
import DsPill from './ds/Pill.vue';
import {
  SIDEBAR_DEFAULTS,
  SIDEBAR_MIN_WIDTHS,
  SIDEBAR_INFLOW_MIN_WIDTH,
  computeMaxFor,
  clampWidth,
  persistWidth,
  persistOpen,
  readStoredWidth,
  readStoredOpen
} from '../composables/sidebarLayout.js';
import DsButton from './ds/Button.vue';
import DsCard from './ds/Card.vue';
import DsInput from './ds/Input.vue';
import DsSelect from './ds/Select.vue';
import ChartDialog from './charts/ChartDialog.vue';
import CropHealthSummaryCard from './charts/CropHealthSummaryCard.vue';
import PestAlertSummaryCard from './charts/PestAlertSummaryCard.vue';
import MarketPriceSummaryCard from './charts/MarketPriceSummaryCard.vue';
import CropHealthChart from './charts/CropHealthChart.vue';
import PestAlertChart from './charts/PestAlertChart.vue';
import MarketPriceChart from './charts/MarketPriceChart.vue';
import { marked, Renderer } from 'marked';
import DOMPurify from 'dompurify';
import jsPDF from 'jspdf';
import { resolveConfigText } from '../utils/configResolver';

// Tight-list renderer override: chat-tuned model output puts a parent
// label and its nested sub-list on adjacent lines in the markdown source,
// but GFM `marked` emits that as `<li><p>Label</p><ul>...</ul></li>` —
// the `<p>` wraps the label as a block element, which inserts a vertical
// margin between the label and its sub-list and reads as an extra blank
// line in the rendered chat. We split the listitem's children into
// inline-safe tokens (text/strong/em/link/...) and block tokens
// (heading/paragraph/blockquote/code/list/html/...), route the former
// through `parser.parseInline` (no `<p>` wrap) and the latter through
// `parser.parse`, so the output becomes
// `<li><strong>Label:</strong><ul>...</ul></li>` — tight list mode
// matching the source's structure.
//
// Routing block tokens to `parseInline` — e.g. when the model emits
// `### heading` inside a listitem — crashes with
// "Token with 'heading' type was not found." Routing by type fixes that
// while still preserving the tight layout for the common case.
//
// `marked.use({ renderer })` only picks up OWN properties of the supplied
// object — class-prototype methods are ignored. We merge our override
// onto a Renderer instance via `Object.assign` so `listitem` lands as an
// own property and is actually used by the parser.
const INLINE_TOKEN_TYPES = new Set([
  'text',
  'escape',
  'html',
  'link',
  'image',
  'strong',
  'em',
  'codespan',
  'br',
  'del',
  'tag'
]);
const BLOCK_TOKEN_TYPES = new Set([
  'paragraph',
  'heading',
  'code',
  'blockquote',
  'list',
  'table',
  'html',
  'def',
  'footnote',
  'hr'
]);

const tightListRenderer = Object.assign(new Renderer(), {
  listitem(token) {
    const children = (token.tokens || []).filter((t) => t.type !== 'space');
    const inline = [];
    const blocks = [];
    for (const child of children) {
      if (BLOCK_TOKEN_TYPES.has(child.type)) {
        blocks.push(child);
      } else if (INLINE_TOKEN_TYPES.has(child.type)) {
        inline.push(child);
      } else {
        // Unknown type — render as a block to avoid feeding a non-inline
        // token to parseInline and crashing the renderer.
        blocks.push(child);
      }
    }
    let html = '';
    if (inline.length > 0) {
      html += this.parser.parseInline(inline);
    }
    if (blocks.length > 0) {
      html += this.parser.parse(blocks);
    }
    const taskBox =
      token.task && token.checked
        ? '<input checked="" type="checkbox" disabled> '
        : token.task
          ? '<input type="checkbox" disabled> '
          : '';
    return `<li>${taskBox}${html}</li>\n`;
  }
});

marked.use({ renderer: tightListRenderer });

export default {
  name: 'ChatBotComponent',
  components: {
    AlertTriangle,
    FileDown,
    Save,
    Brain,
    ChevronDown,
    ChevronUp,
    ExternalLink,
    Loader2,
    Sparkles,
    User,
    X,
    RotateCcw,
    Check,
    ThumbsUp,
    ThumbsDown,
    MessageSquareQuote,
    Copy,
    Languages,
    ChatResponseFeedbackDialog,
    ModalDialog,
    RightSideBarComponent,
    ConfirmDialog,
    ChatComposer,
    DsPill,
    DsSpinner,
    DsButton,
    DsCard,
    DsInput,
    DsSelect,
    ChartDialog,
    CropHealthSummaryCard,
    PestAlertSummaryCard,
    MarketPriceSummaryCard,
    CropHealthChart,
    PestAlertChart,
    MarketPriceChart
  },

  data() {
    return {
      newMessage: '',
      feedbackDialog: {
        visible: false,
        message: null
      },
      saveChatDialog: {
        visible: false,
        title: '',
        folderId: 'default'
      },
      exportDialog: {
        visible: false,
        filename: ''
      },
      currentChatId: null,
      cachedConfig: null,
      currentLocale: (navigator.language || 'en').split('-')[0],
      showQuickHelp: true,
      currentCategoryId: null,
      serviceCategories: [], // This will now hold the transformed tree data
      chatHistoryService: chatHistoryService,
      quickHelpButtons: [],
      showNewChatConfirm: false,
      newChatDialog: {
        title: '',
        message: '',
        confirmText: '',
        cancelText: ''
      },
      showLoadConfirm: false,
      loadConfirmDialog: {
        title: '',
        message: '',
        confirmText: '',
        cancelText: '',
        secondaryText: ''
      },
      pendingConversationId: null,
      isLoading: false, // Loading state for spinner
      isSaving: false, // Loading state for save operation to prevent double-save
      lastSaveSucceeded: false, // The save's own verdict for the leave arms
      loadSeq: 0, // Incremented per conversation load; stale responses are dropped
      hiddenPromptForNextMessage: null, // Stores hidden prompt for dual-prompt mechanism
      // Right sidebar width / collapsed state, both persisted in
      // localStorage and restored clamped against the current viewport.
      rightSidebarWidth: SIDEBAR_DEFAULTS.right,
      rightSidebarCollapsed: false,
      // The left sidebar's width, mirrored here so the max computed
      // has a reactive dependency. App.vue is the single writer.
      leftWidthSnapshot: SIDEBAR_DEFAULTS.left,
      // rAF handle for the resize coalescing; 0 = no pending frame.
      resizeRaf: 0,
      // el-salvador agri charts: the dialog the Insights / Market cards open.
      chartDialog: { visible: false, type: null, title: '', category: null }
    };
  },

  computed: {
    ...mapGetters('conversation', ['openConversation']),
    openMessages() {
      return this.openConversation.messages;
    },
    selectedContextItems() {
      return this.openConversation.selectedContextItems;
    },
    relatedDocuments() {
      return this.openConversation.relatedDocuments;
    },
    lastSavedState() {
      return this.openConversation.lastSavedState;
    },
    isStreaming() {
      return this.openConversation.isStreaming;
    },
    streamingQueryId() {
      return this.openConversation.streamingQueryId;
    },
    conversationId() {
      return this.openConversation.conversationId;
    },
    currentChatTitle() {
      return this.openConversation.conversationId ? this.openConversation.title : '';
    },
    ...mapGetters('chatHistory', ['getAllFolders', 'getChatById']),
    assistantIcon() {
      // The product icon, the same one the navbar renders; the default is
      // the navbar's own until the runtime config has loaded.
      return this.cachedConfig?.app?.icon || runtimeConfig?.app?.icon;
    },
    authUser() {
      // The auth getters are root-level, not namespaced (the settings page
      // reads them the same way).
      return this.$store.getters.currentUser || {};
    },
    userAvatarUrl() {
      return this.authUser.avatarUrl || '';
    },
    // The assistant's reachability lives app-wide (the navbar pill renders
    // it on every page); the chat is usually the component that learns it.
    systemStatus() {
      return this.$store.getters['status/status'];
    },

    conversationTitle() {
      // A saved conversation keeps its title; a QuickHelp-driven chat takes
      // the option's own name; the plain just-chat surface keeps its label.
      if (this.currentChatTitle) return this.currentChatTitle;
      const item = this.selectedContextItems.find((i) => i.source === 'quickHelp');
      if (item) return item.service;
      return this.translate('chatbot.justChat', 'Just Chat');
    },

    userName() {
      return this.authUser.name || this.authUser.preferred_username || '';
    },
    userInitials() {
      const parts = this.userName.trim().split(/\s+/).filter(Boolean);
      if (!parts.length) return '';
      return parts
        .slice(0, 2)
        .map((p) => p[0].toUpperCase())
        .join('');
    },

    // The heading's brand comes from the runtime config through a slot,
    // never through an HTML string, so the operator-editable title is
    // rendered as escaped text and stays translatable in place.
    brandName() {
      return this.cachedConfig?.app?.title || '';
    },

    // As in the navbar, only the GENIE.AI brand carries the gradient.
    brandWordmarkClass() {
      return this.brandName === 'GENIE.AI' ? 'brand-wordmark' : '';
    },

    folders() {
      return this.getAllFolders;
    },

    chatPreview() {
      // A failed exchange is never stored, so it is never the preview.
      const userMessage = this.openMessages.find((msg) => msg.sender === 'user' && !msg.isError);
      if (userMessage) {
        return userMessage.content.length > 50 ? userMessage.content.substring(0, 47) + '...' : userMessage.content;
      }
      return 'New conversation';
    },

    // A conversation in progress owns the view: the welcome overlay must
    // not cover it. The transcript lives in the store, so this survives
    // the remount a navigation causes — the overlay's own flag does not
    // (it is component state, and comes back true on every mount).
    conversationStarted() {
      return this.openMessages.some((msg) => msg.sender === 'user');
    },

    // The dynamic max the right handle clamps against. The left sidebar's
    // current width is the other input, and it lives in App.vue — a
    // different subtree from this one. It is mirrored into
    // `leftWidthSnapshot` on mount, on resize, on the eventBus signal
    // App.vue emits when the left is dragged, and on a cross-tab
    // `storage` event; reading it here gives the computed a dependency
    // to invalidate on.
    rightSidebarMaxWidth() {
      return computeMaxFor('right', this.leftWidthSnapshot, window.innerWidth);
    },
    showRightHandle() {
      // The handle only exists where the sidebar is an in-flow
      // reservation — the same threshold App.vue applies on the left.
      return typeof window !== 'undefined' && window.innerWidth >= SIDEBAR_INFLOW_MIN_WIDTH;
    },

    // The welcome composer is whichever config entry opts into the
    // `placement: "composer"` slot. `placement` is the explicit signal —
    // the brief forbade inferring "this is the just-chat entry" from
    // the absence of a category and an action, because a second
    // such entry on a deployment would silently share the slot and
    // make the deployment's mistake look like a feature. When several
    // entries declare `placement: "composer"`, the first one in the
    // button list wins — the grid's `tileButtons` filter reads the
    // same field, so both sides agree on the routing by construction.
    composerEntry() {
      return this.quickHelpButtons.find((b) => b && b.placement === 'composer') || null;
    },
    // The grid keeps every entry whose placement is not the composer —
    // again, the explicit field, not a heuristic from category / action
    // presence. The seven product configs only ever set this on the
    // well-known just-chat entry; any deployment that adds a second one
    // gets the second routed to the grid (default placement is `tile`,
    // no schema change needed for that).
    tileButtons() {
      return this.quickHelpButtons.filter((b) => b && b.placement !== 'composer');
    }
  },

  watch: {
    // The stream writes from the store while this view may not even be
    // mounted; the watcher keeps the autoscroll and surfaces failures.
    openConversation: {
      deep: true,
      handler() {
        if (this.isStreaming) this.scrollToBottom();
        const last = this.openMessages.at(-1);
        if (last && last.sender === 'bot' && last.isError && last.timestamp !== this._lastNotifiedErrorAt) {
          this._lastNotifiedErrorAt = last.timestamp;
          // The failure's reason was chosen by the store (refused request
          // vs. dead deployment vs. server prose); the key rides on the
          // message so the notification renders in this view's locale.
          notificationService.error(
            last.errorKey ? this.translate(last.errorKey) : this.translate('chatbot.streamingError')
          );
        }
      }
    },
    currentLocale: function () {
      this.updateDialogTexts();
    },
    '$i18n.locale'(newLocale) {
      this.currentLocale = newLocale;
      this.loadQuickHelpButtons();
    }
  },

  created() {
    // A failure restored from storage was already surfaced in the session
    // it died in: seed the watcher's guard so the restored turn does not
    // re-notify on the first unrelated mutation after the reload.
    const restored = this.openMessages.at(-1);
    if (restored && restored.isError) this._lastNotifiedErrorAt = restored.timestamp;
    eventBus.$on('chat-deleted', (deletedChatId) => {
      // The in-flight window has conversationId nulled and the target in
      // currentChatId — the deleted chat must be recognised in both.
      if (this.conversationId === deletedChatId || this.currentChatId === deletedChatId) {
        this.$store.dispatch('conversation/abortStream');
        // The conversation is gone: an in-flight load must not land.
        this.loadSeq++;
        this.currentChatId = null;
        this.currentCategoryId = null;
        this.newMessage = '';
        this.resetToWelcome();
      }
    });

    eventBus.$on('load-conversation', (conversationId) => {
      // Same conversation, already on or loading it — no need to load
      // again (this also swallows a double-click while a load is in
      // flight: the target id is set before the fetch).
      if (conversationId === this.currentChatId || conversationId === this.conversationId) {
        return;
      }
      if (this.hasUnsavedChanges()) {
        this.pendingConversationId = conversationId;
        this.showLoadConfirm = true;
      } else {
        this.loadExistingConversation(conversationId);
      }
    });
  },

  mounted() {
    // Restore the right sidebar's persisted width and collapsed state.
    // The width is clamped on the way IN, not just on drag: a value
    // saved at 1920 px must not be applied blind at 1400 px, where it
    // would push the centre below its usable floor.
    this.leftWidthSnapshot = readStoredWidth('left');
    this.rightSidebarWidth = clampWidth('right', readStoredWidth('right'), this.leftWidthSnapshot, window.innerWidth);
    this.rightSidebarCollapsed = !readStoredOpen('right', true);
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('storage', this.handleStorage);
    // Bound, because the eventBus invokes handlers as bare functions —
    // an unbound method reference arrives with `this` undefined and the
    // `$emit` swallows the resulting TypeError into a console error.
    // The wrapper is kept on the instance so `beforeUnmount` can remove
    // exactly what it added.
    this.onLeftWidthChanged = (width) => this.refreshLeftWidth(width);
    eventBus.$on('sidebar-left-width-changed', this.onLeftWidthChanged);
    // Announce the width actually in force on first paint, so the left
    // sidebar clamps against this rather than against a stored value
    // it may never be able to use at this viewport.
    eventBus.$emit('sidebar-right-width-changed', this.rightSidebarWidth);

    if (this.openMessages.length === 0) {
      this.$store.commit('conversation/appendBotMessage', {
        sender: 'bot',
        content: this.getWelcomeMessage()
      });
    }

    if (this.$root.$i18n) {
      this.currentLocale = this.$root.$i18n.locale;
      this.$watch(
        () => this.$root.$i18n.locale,
        (newLocale) => {
          this.currentLocale = newLocale;
          // Update context labels when locale changes
          this.$store.commit(
            'conversation/setContextItems',
            this.selectedContextItems.map((item) => ({
              ...item,
              service: this.safeTranslate(item.serviceKey || item.service)
            }))
          );
          this.loadServiceCategories(); // Reload categories for the new locale
        }
      );
    }

    eventBus.$on('treeNodeSelected', this.handleTreeNodeSelected);
    this.scrollToBottom();
    this.loadQuickHelpButtons();
    this.loadServiceCategories(); // Fetch categories on mount

    // Removed the statusUpdateInterval
    this.updateDialogTexts();
  },

  beforeUnmount() {
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('storage', this.handleStorage);
    eventBus.$off('sidebar-left-width-changed', this.onLeftWidthChanged);
    eventBus.$off('treeNodeSelected', this.handleTreeNodeSelected);
    eventBus.$off('chat-deleted'); // Clean up the chat-deleted listener
    // Removed clearInterval
    eventBus.$off('load-conversation');
  },

  methods: {
    // The badge of a source card, from the file's own extension — the
    // repository type label when the fetch landed, the name otherwise.
    fileBadge(doc) {
      return fileTypeBadge(doc.fileName || doc.title || doc._type || doc.type);
    },

    // The file size, when the repository answered the metadata fetch.
    sourceSize(d) {
      return formatFileSize(d._size);
    },

    // The repository serves files behind Bearer auth, so a plain link
    // cannot carry the session — internal sources open through the same
    // fetch-blob flow the related-documents sidebar uses.
    async openSourceDocument(doc) {
      if (isExternalUrl(doc.url)) {
        window.open(doc.url, '_blank', 'noopener');
        return;
      }
      try {
        await openRepositoryDocument(doc.id, this.$store.getters.accessToken || null);
      } catch {
        notificationService.error(this.translate('chatbot.documentOpenError', 'Could not open the document'));
      }
    },

    ...mapActions('chatHistory', ['createChat', 'updateChat']),

    // --- Right sidebar resize + collapse ---
    onRightWidthChange(value) {
      const clamped = Math.max(SIDEBAR_MIN_WIDTHS.right, Math.min(this.rightSidebarMaxWidth, value));
      this.rightSidebarWidth = clamped;
      // A user gesture is the one thing that writes storage: the
      // clamped result IS what the user asked for, within the bounds
      // the current viewport allows.
      persistWidth('right', clamped);
      // The left sidebar lives outside this subtree (App.vue), so it
      // cannot see this component's reactive state. The event bus is
      // the in-tab signal that its maximum moved — without it,
      // widening the right would let the left keep a width that no
      // longer leaves the centre its floor.
      eventBus.$emit('sidebar-right-width-changed', clamped);
    },
    onRightCollapsedChange(value) {
      this.rightSidebarCollapsed = value;
      persistOpen('right', !value);
    },
    handleResize() {
      // Coalesced onto a single animation frame — a window-edge drag
      // fires resize dozens of times per second and the re-clamp
      // below does not need that cadence.
      if (this.resizeRaf) return;
      this.resizeRaf = requestAnimationFrame(() => {
        this.resizeRaf = 0;
        this.refreshLeftWidth(this.leftWidthSnapshot);
        // `refreshLeftWidth` already rebinds, but the viewport itself
        // also moved — and that is the viewport half of "the clamp
        // applies on restore, not only on drag". Storage is
        // deliberately NOT rewritten: a width the user chose at a wide
        // viewport comes back when they widen the window again.
      });
    },
    handleStorage(e) {
      // Cross-tab only: the left sidebar's width landed from another
      // tab, which changes this side's maximum.
      if (e.key === 'sidebarWidthLeft') {
        this.refreshLeftWidth();
      }
    },
    refreshLeftWidth(inForce) {
      // The left sidebar's width is the one input to this side's
      // maximum that lives in another component. It is mirrored into
      // reactive state (rather than read inside the computed) so the
      // computed has a dependency to invalidate on.
      //
      // The argument is the width the left is CURRENTLY painting. It
      // matters that it is the in-force width and not the stored one:
      // clamping against the stored value over-reserves when both
      // sides hold a width neither can currently use, and the
      // over-reservation is per-viewport — which is exactly what made
      // the centre narrow from 648 px at 1400 to 496 px at 1600 as
      // the window widened. The fallback covers the cross-tab
      // `storage` path and first paint, where there is no payload.
      this.leftWidthSnapshot = typeof inForce === 'number' ? inForce : readStoredWidth('left');
      this.rebindRightWidth();
    },
    // The mirror of App.vue's `rebindLeftWidth`: the rendered width is
    // recomputed from the STORED width against whatever the left is
    // currently painting, rather than carried forward from the previous
    // clamp. Storage is not written here — only a user-driven change
    // (a drag, a keyboard step, a double-click reset) writes it, so a
    // panel squeezed down at a narrow viewport comes back when the
    // window widens again.
    rebindRightWidth() {
      if (this.rightSidebarCollapsed) return;
      const next = clampWidth('right', readStoredWidth('right'), this.leftWidthSnapshot, window.innerWidth);
      if (next === this.rightSidebarWidth) return;
      this.rightSidebarWidth = next;
      eventBus.$emit('sidebar-right-width-changed', next);
    },

    formatMessageTime(timestamp) {
      if (!timestamp) return '';
      const date = new Date(timestamp);
      const locale = this.$i18n?.locale || undefined;
      return date.toLocaleTimeString([locale], { hour: '2-digit', minute: '2-digit' });
    },

    /**
     * Returns CSS custom-property bindings for the per-button tint —
     * `--qh-bg`, `--qh-hover`, `--qh-outline` — read from the button's
     * styles block. Properties whose value is absent are omitted, and the
     * method returns undefined entirely when nothing is declared, so the
     * template emits no style attribute and the theme layer's accent
     * fallback takes over.
     */
    buttonTintStyle(button) {
      const styles = button.styles;
      if (!styles) return undefined;
      const bindings = {
        '--qh-bg': styles.backgroundColor,
        '--qh-hover': styles.hoverColor,
        '--qh-outline': styles.outlineColor
      };
      const defined = Object.entries(bindings).filter(([, value]) => value);
      if (!defined.length) return undefined;
      return Object.fromEntries(defined);
    },

    // *** UPDATED: Use serviceTreeService to load and transform categories ***
    async loadServiceCategories() {
      try {
        // Use the service which handles transformation and localization
        this.serviceCategories = await serviceTreeService.getAllCategories(this.currentLocale);
      } catch (error) {
        console.error('[ChatBotComponent] Failed to load service categories:', error);
        notificationService.error('Could not load service categories.');
      }
    },

    // *** UPDATED: Find category label by its key in the transformed tree data ***
    getCategoryLabelById(id) {
      if (id === null || id === undefined) {
        // Just-Chat and other no-category selections: no category filter.
        // Returning null (not 'General') keeps it consistent with the backend,
        // which now preserves null instead of defaulting to 'General'. 'General'
        // is not a real KB label and would match no chunk under the retriever filter.
        return null;
      }

      // The service returns `catKey` which corresponds to the numeric ID
      const category = this.serviceCategories.find((cat) => cat.catKey == id.toString());
      if (category) {
        // The service already provides the localized name in the `name` property
        return category.name || null;
      }

      return null; // Unknown category — null means "no category filter" (do NOT send a `Category NN` string to the retriever)
    },

    checkContextConfig(context) {
      // Returns false when the query MUST be blocked (applies to ALL users).
      // Emits an informational warning to admins only.
      const user = this.$store.getters.currentUser;
      const isAdmin = !!(user && (user.roles || []).map((r) => r.toLowerCase()).includes('admin'));

      const warnings = [];

      // Block conditions (all users):
      // 1. categoryLabel is a raw unresolved `Category NN` string — would filter to zero
      //    (a prior bug sent the fallback id string as a label; this guards against regressions)
      // 2. user has context items selected but they resolved to NO labels — a misconfig
      //    symptom (button clicked, but its serviceLabels/category are empty). A genuinely
      //    empty context (Just Chat, no items selected) is NOT blocked — it's an unfiltered query.
      let blocked = false;
      if (context.categoryLabel && /^Category \d+$/.test(context.categoryLabel)) {
        blocked = true;
        warnings.push(this.translate('chatbot.categoryNotFound', '').replace('{label}', context.categoryLabel));
      }
      const hasServiceFilter = Array.isArray(context.serviceLabels) && context.serviceLabels.length > 0;
      const isJustChat = this.selectedContextItems.some((item) => item.id === 'just-chat');
      if (this.selectedContextItems.length > 0 && !hasServiceFilter && !context.categoryLabel && !isJustChat) {
        blocked = true;
        warnings.push(this.translate('chatbot.noFilterWarning', 'No context filter active.'));
      }

      // Mismatch check: each service label must be a known KB label (in some item's
      // serviceLabels array OR equal to an item's serviceKey). Catches misconfigured
      // buttons whose title leaks into the filter. Uses array membership, not service===.
      if (hasServiceFilter) {
        for (const label of context.serviceLabels) {
          const matched = this.selectedContextItems.some(
            (item) => (item.serviceLabels || []).includes(label) || item.serviceKey === label
          );
          if (!matched) {
            warnings.push(this.translate('chatbot.serviceLabelMismatch', '').replace('{label}', label));
          }
        }
      }

      if (warnings.length > 0 && isAdmin) {
        notificationService.warning(
          this.translate('chatbot.configMismatchWarning', '').replace('{warnings}', warnings.join('; ')),
          8000
        );
      }
      return !blocked;
    },

    // Safely translate a key, with mapping for static strings
    safeTranslate(key) {
      try {
        const serviceKeyMap = {
          'Layanan Pelanggan': 'context.customerService',
          Pembayaran: 'context.payment',
          Pengiriman: 'context.shipping',
          'Layanan Kesehatan': 'context.healthService',
          Perumahan: 'context.housing',
          Imigrasi: 'context.immigration',
          Pendidikan: 'context.education',
          Pajak: 'context.tax',
          Pensiun: 'context.retirement',
          'Lainnya - Pribadi': 'context.personalOther'
        };
        const mappedKey = serviceKeyMap[key];
        if (mappedKey) {
          return this.$t(mappedKey);
        }
        if (typeof key === 'string' && key.includes('.')) {
          return this.$t(key);
        }
        return key || '';
      } catch {
        return key || '';
      }
    },

    // Render Markdown safely
    renderMarkdown(content) {
      try {
        const html = marked.parse(content);
        return DOMPurify.sanitize(html);
      } catch (error) {
        console.error('Error rendering Markdown:', error);
        return DOMPurify.sanitize(content);
      }
    },

    async loadQuickHelpButtons() {
      try {
        const loadConfig = (await import('../config-loader')).default;
        const config = await loadConfig();
        this.cachedConfig = config;
        const buttons = config?.features?.chat?.quickHelp?.buttons || [];
        const locale = this.currentLocale;

        // Filter hidden buttons (no matching corpus content) and resolve display text.
        // serviceLabels (explicit English KB labels) drives the FILTER only:
        //   - service       = localized display name (title, resolved per locale) — render only
        //   - serviceKey    = stable English KB label (first of serviceLabels, or id/title fallback)
        //   - serviceLabels = full English label array sent as the retriever filter
        // Display (service) and filter (serviceKey/serviceLabels) are DECOUPLED: the button always
        // shows its localized title, while the filter always uses English KB labels.
        // Buttons without serviceLabels fall back to title-based behavior (backward compat).
        this.quickHelpButtons = buttons
          .filter((button) => !button.hidden)
          .map((button) => {
            const title = resolveConfigText(button.title, locale);
            const visibleText = resolveConfigText(button.action?.visibleText, locale);
            const hiddenPrompt = resolveConfigText(button.action?.hiddenPrompt, locale);
            const explicitLabels = Array.isArray(button.serviceLabels) ? button.serviceLabels : null;

            return {
              service: title,
              serviceLabels: explicitLabels,
              serviceKey: explicitLabels ? explicitLabels[0] : button.id || title,
              textKey: button.title,
              visibleText: visibleText,
              hiddenPrompt: hiddenPrompt,
              icon: button.icon?.value,
              category: button.category,
              styles: button.styles,
              // Pass the placement field through so the tile / composer
              // routing in the welcome panel can read it directly.
              placement: button.placement,
              id: button.id
            };
          });
      } catch (error) {
        console.error('[ChatBotComponent] Failed to load Quick Help config:', error);
        this.quickHelpButtons = [];
      }
    },

    getWelcomeMessage() {
      const configWelcome = this.cachedConfig?.features?.chat?.welcomeMessage;
      if (configWelcome) {
        return resolveConfigText(configWelcome, this.currentLocale);
      }
      return this.translate('chatbot.welcomeMessage');
    },

    // formatUptime method removed

    handleOpenDocument(_doc) {
      // Document opened
    },

    translate(key, fallback) {
      const value = this.$t(key);
      return value !== key ? value : fallback || key;
    },

    openChart(type, category) {
      const titles = {
        'crop-health': this.translate('charts.cropHealthTitle', 'Crop Health - NDVI Index'),
        'pest-alert': this.translate('charts.pestAlertTitle', 'Pest & Disease Alerts'),
        'market-price': this.translate('charts.market.sectionTitle', 'Market Prices')
      };
      this.chartDialog = { visible: true, type, title: titles[type] || type, category };
    },
    closeChartDialog() {
      this.chartDialog.visible = false;
    },

    selectQuickHelpOption(option) {
      const rawOption = option && option.__v_isReactive ? { ...option } : option || {};
      if (!rawOption.service) {
        return;
      }
      const categoryId = rawOption.category || (rawOption.id !== 'just-chat' ? 'general' : null);

      // Quick Help is a mode switch: replace any prior Quick Help selection.
      // Sidebar items (source !== 'quickHelp') are additive and survive.
      // Also dedup: if the same Quick Help option is already selected, keep it as-is.
      const existingIdx = this.selectedContextItems.findIndex(
        (item) => item.source === 'quickHelp' && item.id === rawOption.id
      );
      if (existingIdx >= 0) {
        return; // already selected — no-op (preserves prior dedup behavior)
      }
      const quickHelpItem =
        rawOption.id === 'just-chat'
          ? {
              // "Just Chat" clears all label filters so the retriever
              // searches across all documents without restriction. The
              // item stays in context so conversation history is
              // preserved for follow-up queries.
              service: rawOption.service,
              serviceLabels: [],
              serviceKey: rawOption.serviceKey || rawOption.id || rawOption.service,
              source: 'quickHelp',
              id: rawOption.id,
              category: null,
              selected: true
            }
          : {
              service: rawOption.service,
              serviceLabels: rawOption.serviceLabels || null,
              serviceKey: rawOption.serviceKey || rawOption.id || rawOption.service,
              source: 'quickHelp',
              id: rawOption.id,
              category: categoryId,
              selected: true
            };
      this.$store.commit('conversation/replaceQuickHelpItem', quickHelpItem);
      this.currentCategoryId = rawOption.id === 'just-chat' ? null : categoryId;

      this.showQuickHelp = false;
      if (rawOption.hiddenPromptKey || rawOption.hiddenPrompt) {
        // Display the visible text in the chat (what user sees)
        const visibleMessage = rawOption.visibleText || this.$t(rawOption.visibleTextKey);
        this.newMessage = visibleMessage;

        // Store the hidden prompt to send to backend (what LLM sees)
        this.hiddenPromptForNextMessage = rawOption.hiddenPrompt || this.$t(rawOption.hiddenPromptKey);
        this.sendMessage();
      }
    },

    handleTextareaFocus() {
      this.showQuickHelp = false;
    },

    // Enter / send in the welcome composer. Mirrors selectQuickHelpOption
    // for the just-chat branch (clears prior quickHelp context, pushes
    // the just-chat item with empty serviceLabels — no label filter, an
    // unfiltered query) then steps into the chat view and sends. The
    // existing sendMessage path then reads the empty-array serviceLabels
    // and selects no label filter, matching the previous "Just Chat"
    // tile behaviour.
    handleWelcomeSend() {
      const entry = this.composerEntry;
      // Only a real knowledge-area entry becomes a context chip — the plain
      // just-chat surface is not a domain, and a chip would promise one.
      if (entry && entry.category) {
        this.$store.commit('conversation/replaceQuickHelpItem', {
          service: entry.service,
          serviceLabels: [],
          serviceKey: entry.serviceKey || entry.id || entry.service,
          source: 'quickHelp',
          id: entry.id,
          category: entry.category,
          selected: true
        });
      } else {
        this.$store.commit(
          'conversation/setContextItems',
          this.selectedContextItems.filter((i) => i.source !== 'quickHelp')
        );
      }
      this.currentCategoryId = null;
      this.showQuickHelp = false;
      this.sendMessage();
    },

    handleTreeNodeSelected(item) {
      if (!item || typeof item !== 'object' || !item.service) {
        return;
      }

      if (item.selected) {
        const exists = this.selectedContextItems.some(
          (existing) => existing.service === this.safeTranslate(item.service) && existing.category === item.category
        );
        if (!exists) {
          this.$store.commit('conversation/addContextItem', {
            service: this.safeTranslate(item.service),
            serviceKey: item.service,
            category: item.category || 'general',
            selected: true
          });
          notificationService.info(this.translate('chatbot.contextAdded'), 1500);
          if (!this.currentCategoryId) {
            this.currentCategoryId = item.category || null;
          }
        }
      } else {
        const index = this.selectedContextItems.findIndex(
          (existing) => existing.service === this.safeTranslate(item.service) && existing.category === item.category
        );
        if (index !== -1) {
          const removedItem = this.selectedContextItems[index];
          this.$store.commit('conversation/removeContextItem', index);
          notificationService.info(this.translate('chatbot.contextRemoved'), 1500);
          eventBus.$emit('contextItemRemoved', removedItem);
          if (this.selectedContextItems.length === 0) {
            this.currentCategoryId = null;
          }
        }
      }
    },

    removeContextItem(index) {
      if (this.selectedContextItems.length > index) {
        this.$store.commit('conversation/removeContextItem', index);
      }
      if (this.selectedContextItems.length === 0 && this.currentCategoryId) {
        const quickHelpOption = this.quickHelpButtons.find((option) => option.category === this.currentCategoryId);
        if (quickHelpOption) {
          this.$store.commit('conversation/setContextItems', [
            {
              service: quickHelpOption.service,
              serviceLabels: quickHelpOption.serviceLabels || null,
              serviceKey: quickHelpOption.serviceKey || quickHelpOption.id || quickHelpOption.service,
              source: 'quickHelp',
              id: quickHelpOption.id,
              category: this.currentCategoryId,
              selected: true
            }
          ]);
        } else {
          this.currentCategoryId = null;
        }
      }
    },

    async sendMessage() {
      const content = this.newMessage.trim();
      if (!content) return;
      await this.sendMessageFromText(content);
    },

    // The one send pathway: takes the query text (and what the user saw, for
    // the dual-prompt case) and runs it. The composer and the retry share it.
    async sendMessageFromText(content) {
      if (!content) return;

      // For dual-prompt mechanism: use hidden prompt for backend, visible text for display
      const messageForBackend = this.hiddenPromptForNextMessage || content;
      const messageForDisplay = content;

      const useConversationContext = this.selectedContextItems.length > 0;
      const contextOption = useConversationContext ? 'conversation-with-labels' : 'single-message';
      let queryData;
      const categoryLabel = this.getCategoryLabelById(this.currentCategoryId);
      // The retriever filter is built from English KB labels: sidebar items
      // carry a stable English serviceKey (the localized `service` must
      // never reach the filter); Quick Help items carry an explicit
      // serviceLabels array — multi-label, or explicitly empty (Just Chat,
      // which contributes no filter).
      const serviceLabels = useConversationContext
        ? this.selectedContextItems.flatMap((item) =>
            Array.isArray(item.serviceLabels)
              ? item.serviceLabels.length > 0
                ? item.serviceLabels
                : []
              : [item.serviceKey || item.service]
          )
        : [];
      // checkContextConfig returns false when the query must be blocked
      // (unresolved category id, or no filter active) — before any turn
      // is committed, so a blocked send leaves no orphan placeholder.
      const probeQuery = useConversationContext
        ? { categoryLabel: categoryLabel, serviceLabels }
        : { language: this.currentLocale.toUpperCase() };
      if (this.checkContextConfig(probeQuery) === false) {
        return;
      }

      // A previous stream still running is replaced by the new one —
      // aborted BEFORE the new turns are pushed, so the interruption
      // marks the turn the old fetch was writing, not the new one.
      this.$store.dispatch('conversation/abortStream');

      this.$store.commit('conversation/appendUserMessage', {
        sender: 'user',
        content: messageForDisplay,
        timestamp: new Date().toISOString(),
        isSaved: false
      });

      this.newMessage = '';
      this.showQuickHelp = false;
      this.isLoading = false;
      // Clear hidden prompt after use
      this.hiddenPromptForNextMessage = null;

      // Placeholder bot message for streaming content; the outgoing query
      // text stays on the message so a failed turn can retry itself.
      this.$store.commit('conversation/appendBotMessage', {
        sender: 'bot',
        content: '',
        _query: messageForBackend,
        timestamp: new Date().toISOString(),
        isSaved: false,
        metadata: {},
        isStreaming: true,
        translationFailed: false
      });

      if (contextOption === 'conversation-with-labels') {
        // Storable turns only: streaming placeholders are UI stubs, and
        // a synthesized greeting (no queryId) or a failed exchange never
        // delivered model output — none of it enters the model's context.
        const baseMessages = this.openMessages
          .filter((msg) => msg && !msg.isStreaming && isStorableTurn(msg))
          .map((msg) => ({
            role: msg.sender === 'user' ? 'user' : 'assistant',
            content: msg.content
          }));

        const lastUserMsgIndex = baseMessages.map((m) => m.role).lastIndexOf('user');
        // Dual-prompt swap: send the hidden prompt to OPEA as the last user
        // message so the LLM gets the persona + domain context, while
        // `messageForDisplay` is what the user actually clicked/typed.
        if (lastUserMsgIndex !== -1 && messageForBackend !== messageForDisplay) {
          baseMessages[lastUserMsgIndex].content = messageForBackend;
        }

        queryData = {
          conversationId: this.conversationId,
          sessionId: this.currentSessionId || 'new-session',
          messages: baseMessages,
          userQuestion: messageForDisplay,
          context: {
            categoryLabel: categoryLabel,
            serviceLabels: serviceLabels,
            language: this.currentLocale.toUpperCase()
          },
          contextOption: 'conversation-with-context-labels',
          timestamp: new Date().toISOString()
        };
      } else {
        queryData = {
          sessionId: this.currentSessionId || 'new-session',
          text: messageForBackend,
          userQuestion: messageForDisplay,
          context: {
            language: this.currentLocale.toUpperCase()
          },
          contextOption: contextOption,
          timestamp: new Date().toISOString()
        };
      }

      this.$store.dispatch('conversation/sendStream', queryData);
      this.scrollToBottom();
      if (this.currentChatId) {
        this.updateChatInHistory();
      }
    },

    openFeedbackDialog(index) {
      this.feedbackDialog = {
        visible: true,
        message: this.openMessages[index]
      };
    },

    closeFeedbackDialog() {
      this.feedbackDialog.visible = false;
    },

    // The one place a rating reaches the service — the feedback dialog and
    // the inline thumbs share it, so analytics keeps its 1-5 scale.
    // Resolves true only when the submission succeeded.
    async submitFeedbackPayload(message, rating, comment) {
      const queryId = message.queryId;
      if (!queryId) {
        notificationService.error(this.translate('chatbot.feedbackMissingQueryId'));
        return false;
      }
      try {
        await chatbotService.submitFeedback(queryId, {
          rating,
          comment: comment || '',
          providedAt: new Date().toISOString()
        });
        return true;
      } catch (error) {
        console.error('Error submitting feedback for queryId:', queryId, error);
        notificationService.error(this.translate('chatbot.feedbackError'));
        return false;
      }
    },

    async handleFeedbackSubmit(feedback) {
      const rating = feedback.rating || THUMB_RATINGS[feedback.thumbFeedback] || feedback.rating;
      const ok = await this.submitFeedbackPayload(feedback.message, rating, feedback.text || '');
      if (ok) notificationService.success(this.translate('chatbot.feedbackSubmitted'));
      this.closeFeedbackDialog();
    },

    async rateAnswer(index, value) {
      const msg = this.openMessages[index];
      const rating = THUMB_RATINGS[value];
      const ok = await this.submitFeedbackPayload(msg, rating, '');
      if (ok) {
        this.$store.commit('conversation/setMessageProperty', [index, 'userFeedback', value]);
        notificationService.success(this.translate('chatbot.feedbackSubmitted'));
      }
    },

    retryAnswer(index) {
      const msg = this.openMessages[index];
      const q = msg._query;
      // The failed turn is its question plus the failed answer — replaced,
      // not stacked. The visible text lives on the user turn being dropped.
      const before = this.openMessages[index - 1];
      const dropUser = before && before.sender === 'user';
      const display = dropUser ? before.content : q;
      this.$store.commit('conversation/spliceMessages', [dropUser ? index - 1 : index, dropUser ? 2 : 1]);
      this.sendMessageFromText(q);
      if (display !== q) {
        // The retry re-runs the hidden-prompt query, but shows what the user
        // saw — the display text rides the same mechanism the composer uses.
        this.$store.commit('conversation/setMessageProperty', [this.openMessages.length - 2, 'content', display]);
      }
    },

    async copyAnswer(msg) {
      const holder = document.createElement('div');
      holder.innerHTML = this.renderMarkdown(msg.content);
      const text = holder.textContent || '';
      try {
        await navigator.clipboard.writeText(text);
        // The clipboard gives no feedback of its own — the check mark is
        // the acknowledgement, reverted after a beat.
        msg.copied = true;
        setTimeout(() => {
          msg.copied = false;
        }, 1500);
      } catch {
        notificationService.error(this.translate('chatbot.copyFailed', 'Could not copy'));
      }
    },

    scrollToBottom() {
      this.$nextTick(() => {
        const container = this.$refs.chatWindow;
        if (container) {
          container.scrollTop = container.scrollHeight;
        }
      });
    },

    async loadExistingConversation(conversationId) {
      // Loading another conversation orphans the open generation — stop
      // it rather than letting its frames land in the wrong transcript.
      this.$store.dispatch('conversation/abortStream');
      // The loaded chat replaces the open one wholesale — and the
      // replacement starts NOW, before the fetch: if the load fails, the
      // next question must not carry the previous conversation's id, its
      // context chip, its sources or its transcript.
      this.$store.commit('conversation/setConversationId', null);
      this.$store.commit('conversation/setContextItems', []);
      this.$store.commit('conversation/setRelatedDocuments', []);
      this.$store.commit('conversation/setMessages', []);
      this.$store.commit('conversation/setSavedState');
      this.currentChatId = conversationId;
      this.currentCategoryId = null;
      // A slower load must never overwrite a newer one.
      const token = ++this.loadSeq;
      try {
        const conversation = await this.chatHistoryService.getConversation(conversationId);

        if (token !== this.loadSeq) {
          return; // a newer load superseded this one
        }
        if (!conversation) {
          throw new Error('Conversation not found');
        }
        // The fetch window was long enough for the user to send a
        // question into the cleared transcript — that generation belongs
        // to the replaced conversation, and dies with it.
        this.$store.dispatch('conversation/abortStream');

        this.$store.commit('conversation/setConversationId', conversation._key);
        this.currentChatId = conversation._key;
        this.$store.commit('conversation/setTitle', conversation.title || this.generateChatTitle());
        this.currentCategoryId = conversation.categoryId || null;

        // Populate related documents from history (files property from
        // backend) — the same sidebar-card shape the live stream builds.
        if (conversation.files && Array.isArray(conversation.files)) {
          this.$store.commit('conversation/setRelatedDocuments', translateSources(conversation.files));
        } else {
          this.$store.commit('conversation/setRelatedDocuments', []);
        }

        // Whatever the live path sets on a message (onMetadata), the
        // reload path sets too — the restored conversation speaks the
        // same states. One commit per collection: history can be long.
        const messages = conversation.messages || [];
        const restoredMessages = messages.map((msg) => ({
          sender: msg.sender === 'user' ? 'user' : 'bot',
          content: msg.content,
          timestamp: msg.timestamp || new Date().toISOString(),
          queryId: msg.queryId || null,
          confidenceScore: msg.metadata?.confidence_score ?? msg.queryInfo?.confidenceScore ?? null,
          metadata: msg.metadata || null,
          isGrounded: msg.metadata?.is_grounded,
          userFeedback: msg.metadata?.userFeedback || null,
          isSaved: true
        }));
        if (restoredMessages.length === 0) {
          restoredMessages.push({
            sender: 'bot',
            content: this.getWelcomeMessage(),
            timestamp: new Date().toISOString(),
            queryId: null,
            isSaved: true
          });
        }
        this.$store.commit('conversation/setMessages', restoredMessages);

        let restoredContextItems = [];
        if (conversation.tags && Array.isArray(conversation.tags)) {
          restoredContextItems = conversation.tags.map((tag) => ({
            service: this.safeTranslate(tag || `category.${this.currentCategoryId || 'general'}`),
            serviceKey: tag || `category.${this.currentCategoryId || 'general'}`,
            category: this.currentCategoryId || 'general',
            selected: true
          }));
        } else if (this.currentCategoryId) {
          restoredContextItems = [
            {
              service: this.getCategoryLabelById(this.currentCategoryId),
              serviceKey: `category.${this.currentCategoryId}`,
              category: this.currentCategoryId,
              selected: true
            }
          ];
        }
        this.$store.commit('conversation/setContextItems', restoredContextItems);

        this.$store.commit('conversation/setSavedState');

        this.newMessage = '';
        this.showQuickHelp = false;
        this.scrollToBottom();

        this.updateChatInHistory();

        notificationService.success(this.translate('chatbot.conversationLoaded'));
      } catch (error) {
        console.error('Error loading conversation:', error);
        // Only the newest load owns the view's target: a stale failure
        // must not clear a newer load's id, and must not notify — the
        // newer load already owns the screen.
        if (token === this.loadSeq) {
          this.currentChatId = null;
          // The fetch window may have opened a generation into the
          // cleared transcript: it dies here, together with the
          // transcript it was writing into.
          this.$store.dispatch('conversation/abortStream');
          this.resetToWelcome();
          notificationService.error(this.translate('chatbot.loadError'));
        }
      }
    },

    hasUnsavedChanges() {
      // A failed exchange is deliberately never persisted, so it is not
      // a pending change either.
      if (!this.conversationId && !this.currentChatId) {
        const hasUserMessages = this.openMessages.some((msg) => msg.sender === 'user' && !msg.isError);
        const hasContextItems = this.selectedContextItems.length > 0;
        return hasUserMessages || hasContextItems;
      }

      const hasNewMessages = this.openMessages.some((msg) => !msg.isSaved && isStorableTurn(msg));
      if (hasNewMessages) {
        return true;
      }

      if (this.selectedContextItems.length !== this.lastSavedState.contextItems.length) {
        return true;
      }
      for (let i = 0; i < this.selectedContextItems.length; i++) {
        if (
          this.selectedContextItems[i].service !== this.lastSavedState.contextItems[i]?.service ||
          this.selectedContextItems[i].category !== this.lastSavedState.contextItems[i]?.category
        ) {
          return true;
        }
      }

      return false;
    },

    async loadConversationConfirmed() {
      this.showLoadConfirm = false;
      // The discard arm performs no save — by definition it always loads.
      if (this.pendingConversationId) {
        await this.loadExistingConversation(this.pendingConversationId);
        this.pendingConversationId = null;
      }
    },

    cancelLoadConversation() {
      this.showLoadConfirm = false;
      this.pendingConversationId = null;
    },

    async saveAndLoadConversation() {
      this.showLoadConfirm = false;
      // The leave arm owns the whole save half — verdict reset, the
      // update-vs-create decision, the naming dialog and its await.
      const saved = await this.saveCurrentChatBeforeLeave();
      if (!this.pendingConversationId) {
        return;
      }
      // A canceled naming dialog keeps the draft: the pending load is
      // abandoned with it, mirroring the start-new arm.
      if (!saved) {
        this.pendingConversationId = null;
        return;
      }
      await this.loadExistingConversation(this.pendingConversationId);
      this.pendingConversationId = null;
    },

    saveChatToHistory() {
      // Only the persisted id decides update-vs-create — an in-flight
      // load target is not saved anywhere yet.
      if (this.conversationId) {
        this.updateExistingChat();
      } else {
        this.saveChatDialog = {
          visible: true,
          title: this.generateChatTitle(),
          folderId: 'default'
        };
      }
    },

    getContextTags() {
      return this.selectedContextItems.map((item) => item.serviceKey || item.service).filter((tag) => tag);
    },

    async handleSaveChat() {
      // Prevent double-save; lastSaveSucceeded carries the verdict.
      if (this.isSaving) {
        return;
      }

      this.isSaving = true;
      // The save's own verdict — an id alone is not one: the
      // conversation can exist server-side while a later step failed.
      this.lastSaveSucceeded = false;

      try {
        const currentUser = this.$store.getters.currentUser;
        if (!currentUser || !getUserId(currentUser)) {
          throw new Error('User not authenticated');
        }

        // The first user question that ever got an answer rides as the
        // conversation's initialMessage — a failed first exchange is
        // left out entirely, so it cannot reopen looking answered.
        const firstUserIndex = this.openMessages.findIndex((m) => m.sender === 'user' && !m.isError);
        const firstUserMessage = firstUserIndex >= 0 ? this.openMessages[firstUserIndex].content : '';

        const conversationData = {
          title: this.saveChatDialog.title || this.generateChatTitle(),
          initialMessage: firstUserMessage,
          categoryId: this.currentCategoryId || null,
          tags: this.getContextTags()
        };

        if (this.conversationId) {
          throw new Error('handleSaveChat should not be called for existing conversations');
        }

        // Every turn is a failed exchange: creating the conversation
        // would store an empty chat that previews content it does not
        // hold.
        const hasPersistableTurn = this.openMessages.some(isStorableTurn);
        if (!hasPersistableTurn) {
          notificationService.info(this.translate('chatbot.nothingToSave'));
          this.saveChatDialog.visible = false;
          return false;
        }

        const conversation = await this.chatHistoryService.createConversation(conversationData);
        // A fresh conversation replaces whatever load was in flight.
        this.loadSeq++;
        this.$store.commit('conversation/setConversationId', conversation._key);

        // Matched by position, not content, so a later message that
        // repeats the same text is still stored normally.
        for (const [messageIndex, message] of this.openMessages.entries()) {
          if (
            (message.sender === 'bot' && !message.queryId) ||
            (message.sender === 'user' && messageIndex === firstUserIndex && !message.isSaved)
          ) {
            // Mark it saved so hasUnsavedChanges() settles and the next
            // save pass skips it instead of adding it a second time. The
            // streaming placeholder stays unsaved: it is not storable yet.
            if (message.sender === 'user') {
              this.$store.commit('conversation/setMessageProperty', [messageIndex, 'isSaved', true]);
            }
            continue;
          }

          // A failed exchange is never persisted: its question would
          // reopen later looking answered, with no dead answer beside it.
          if (isStorableTurn(message) && message.content) {
            const messageData = {
              conversationId: conversation._key,
              content: message.content,
              sender: message.sender === 'user' ? 'user' : 'assistant',
              queryId: message.queryId || null,
              metadata: message.metadata || {}
            };
            await this.chatHistoryService.addMessage(messageData);
            this.$store.commit('conversation/setMessageProperty', [messageIndex, 'isSaved', true]);
          }
        }

        const chatData = {
          id: conversation._key,
          title: conversationData.title,
          preview: this.chatPreview,
          folderId: this.saveChatDialog.folderId || 'default',
          messageCount: this.openMessages.filter(isStorableTurn).length
        };
        await this.$store.dispatch('chatHistory/createChat', chatData);

        if (this.saveChatDialog.folderId && this.saveChatDialog.folderId !== 'default') {
          await this.chatHistoryService.addConversationToFolder(this.saveChatDialog.folderId, conversation._key);
          await this.$store.dispatch('chatHistory/addChatToFolder', {
            chatId: conversation._key,
            folderId: this.saveChatDialog.folderId
          });
        }

        this.currentChatId = conversation._key;
        this.$store.commit('conversation/setTitle', conversationData.title);
        this.$store.commit('conversation/setSavedState');
        this.updateChatInHistory();

        this.lastSaveSucceeded = true;
        notificationService.success(this.translate('chatbot.chatSaved'));
        this.saveChatDialog.visible = false;

        eventBus.$emit('conversation-saved', conversation._key);
      } catch (error) {
        console.error('Error saving chat:', error);
        notificationService.error('Failed to save chat. Please try again.');
        // The dialog stays open so the save can be retried; the failure
        // never escapes as an exception (the dialog's Save button calls
        // this directly), and the flag carries the verdict.
        this.lastSaveSucceeded = false;
      } finally {
        this.isSaving = false;
      }
    },

    async updateExistingChat() {
      try {
        const currentUser = this.$store.getters.currentUser;
        if (!currentUser || !getUserId(currentUser)) {
          throw new Error('User not authenticated');
        }

        if (!this.conversationId) {
          throw new Error('Conversation ID is required for updating an existing chat');
        }

        const updateData = {
          title: this.currentChatTitle || this.generateChatTitle(),
          categoryId: this.currentCategoryId || null,
          tags: this.getContextTags(),
          isStarred: false,
          isArchived: false
        };
        await this.chatHistoryService.updateConversation(this.conversationId, updateData);

        for (const [messageIndex, message] of this.openMessages.entries()) {
          if (message.isSaved) {
            continue;
          }
          // A failed exchange is never persisted (and is not a pending
          // change either): its question would reopen later looking
          // answered, with no dead answer beside it.
          if (isStorableTurn(message) && message.content) {
            const messageData = {
              conversationId: this.conversationId,
              content: message.content,
              sender: message.sender === 'user' ? 'user' : 'assistant',
              queryId: message.queryId || null,
              metadata: message.metadata || {}
            };
            await this.chatHistoryService.addMessage(messageData);
            this.$store.commit('conversation/setMessageProperty', [messageIndex, 'isSaved', true]);
          }
        }

        this.currentChatId = this.conversationId;
        this.$store.commit('conversation/setSavedState');
        this.updateChatInHistory();

        notificationService.success(this.translate('chatbot.chatUpdated'));
      } catch (error) {
        console.error('Error updating chat:', error);
        notificationService.error('Failed to update chat. Please try again.');
        throw error;
      }
    },

    updateChatInHistory() {
      if (this.currentChatId) {
        this.updateChat({
          chatId: this.currentChatId,
          preview: this.chatPreview,
          fullChatData: JSON.stringify(this.openMessages)
        });
      }
    },

    generateChatTitle() {
      // Consistent with the preview: failed exchanges are not metadata.
      const userMessage = this.openMessages.find((msg) => msg.sender === 'user' && !msg.isError);
      if (userMessage) {
        return userMessage.content.length > 20 ? userMessage.content.substring(0, 17) + '...' : userMessage.content;
      }
      const now = new Date();
      return `Chat - ${now.toLocaleDateString()}`;
    },

    startNewChat() {
      if (this.hasUnsavedChanges()) {
        this.showNewChatConfirm = true;
        this.newChatDialog = {
          title: this.translate('chatbot.newChatTitle'),
          message: this.translate('chatbot.unsavedChanges'),
          confirmText: this.translate('chatbot.saveAndStartNew'),
          cancelText: this.translate('chatbot.discardAndStartNew'),
          secondaryText: this.translate('common.cancel')
        };
      } else {
        this.startNewChatConfirmed();
      }
    },

    // One definition of "back to the welcome screen": a pristine entry
    // holding only the welcome turn, snapshotted as saved.
    resetToWelcome() {
      this.$store.commit('conversation/resetForNewConversation');
      this.$store.commit('conversation/appendBotMessage', {
        sender: 'bot',
        content: this.getWelcomeMessage(),
        timestamp: new Date().toISOString(),
        isSaved: true
      });
      this.$store.commit('conversation/setSavedState');
    },

    async saveAndStartNewChat() {
      this.showNewChatConfirm = false;
      const saved = await this.saveCurrentChatBeforeLeave();
      // A canceled naming dialog keeps the draft on screen.
      if (saved) {
        this.startNewChatConfirmed();
      }
    },

    startNewChatConfirmed() {
      this.showNewChatConfirm = false;
      this.$store.dispatch('conversation/abortStream');
      // The welcome screen replaces the conversation: an in-flight load
      // of another chat must not land after this.
      this.loadSeq++;
      this.resetToWelcome();
      this.currentChatId = null;
      this.newMessage = '';
      this.currentCategoryId = null;
      this.showQuickHelp = true;
      this.$store.commit('conversation/setSavedState');
      this.$nextTick(() => {
        this.scrollToBottom();
      });
      notificationService.info(this.translate('chatbot.newChatStarted'), 1500);
    },

    cancelNewChat() {
      this.showNewChatConfirm = false;
    },

    // The leave-confirm "save" arm: an existing conversation updates in
    // place; a never-saved one opens the naming dialog and the navigation
    // resumes when the save completes.
    async saveCurrentChatBeforeLeave() {
      // The verdict must describe THIS flow: a success from an earlier
      // save must never answer this arm's question.
      this.lastSaveSucceeded = false;
      // Only the persisted id decides update-vs-create — an in-flight
      // load target is not saved anywhere yet.
      if (this.conversationId) {
        try {
          await this.updateExistingChat();
          this.lastSaveSucceeded = true;
          return true;
        } catch {
          return false;
        }
      }
      this.saveChatDialog = {
        visible: true,
        title: this.generateChatTitle(),
        folderId: 'default'
      };
      // The navigation must wait for the naming dialog: resetting the
      // transcript before the save completes would persist an empty
      // chat. A canceled dialog resolves too — with nothing saved.
      await new Promise((resolve) => {
        const unwatch = this.$watch('saveChatDialog.visible', (newVal) => {
          if (!newVal) {
            unwatch();
            resolve();
          }
        });
      });
      return this.lastSaveSucceeded;
    },

    openExportDialog() {
      this.exportDialog = {
        visible: true,
        filename: this.generateChatTitle()
      };
    },

    _processInlineTokens(tokens) {
      const parts = [];
      if (!tokens) {
        return parts;
      }

      tokens.forEach((token) => {
        switch (token.type) {
          case 'strong': {
            const boldParts = this._processInlineTokens(token.tokens);
            boldParts.forEach((p) => (p.style = 'bold'));
            parts.push(...boldParts);
            break;
          }
          case 'em': {
            const italicParts = this._processInlineTokens(token.tokens);
            italicParts.forEach((p) => (p.style = 'italic'));
            parts.push(...italicParts);
            break;
          }
          case 'codespan':
            parts.push({ text: token.text, style: 'code' });
            break;
          case 'link': {
            const linkParts = this._processInlineTokens(token.tokens);
            linkParts.forEach((p) => (p.style = 'link'));
            parts.push(...linkParts);
            break;
          }
          case 'text':
            parts.push({ text: token.text, style: 'normal' });
            break;
          default:
            if (token.text) {
              parts.push({ text: token.text, style: 'normal' });
            }
            break;
        }
      });
      return parts;
    },

    parseMarkdownForPDF(markdown) {
      try {
        const tokens = marked.lexer(markdown);
        const result = [];
        let listCounter = 0;
        let listOrdered = false;

        tokens.forEach((token) => {
          switch (token.type) {
            case 'space':
              result.push({ type: 'space' });
              break;
            case 'hr':
              result.push({ type: 'hr' });
              break;
            case 'heading': {
              const headingParts = this._processInlineTokens(token.tokens);
              headingParts.forEach((p) => (p.style = `h${token.depth}`));
              result.push({ type: 'line', indent: 0, content: headingParts });
              break;
            }
            case 'paragraph':
              result.push({
                type: 'line',
                indent: 0,
                content: this._processInlineTokens(token.tokens)
              });
              break;
            case 'list':
              listOrdered = token.ordered;
              listCounter = token.start ? token.start - 1 : 0;
              token.items.forEach((item) => {
                listCounter++;
                const prefix = listOrdered ? `${listCounter}. ` : '- ';
                const itemContent = this._processInlineTokens(item.tokens[0].tokens);
                itemContent.unshift({ text: prefix, style: 'normal' });
                result.push({ type: 'line', indent: 15, content: itemContent });
              });
              break;
            case 'code': {
              const codeLines = token.text.split('\n');
              codeLines.forEach((line) => {
                result.push({
                  type: 'line',
                  indent: 10,
                  content: [{ text: line, style: 'code' }]
                });
              });
              break;
            }
            case 'blockquote': {
              const quoteContent = token.tokens.map((tok) => this._processInlineTokens(tok.tokens));
              quoteContent.forEach((lineContent) => {
                result.push({
                  type: 'line',
                  indent: 20,
                  isQuote: true,
                  content: lineContent
                });
              });
              break;
            }
          }
        });

        return result;
      } catch (error) {
        console.error('Error parsing markdown for PDF:', error);
        return [
          {
            type: 'line',
            indent: 0,
            content: [{ text: markdown, style: 'normal' }]
          }
        ];
      }
    },

    exportChatToPDF() {
      try {
        const doc = new jsPDF();
        let yOffset = 20;
        const pageHeight = doc.internal.pageSize.height;
        const topMargin = 20;
        const bottomMargin = 20;
        const leftMargin = 15;
        const rightMargin = doc.internal.pageSize.width - 15;

        const checkPageBreak = (neededHeight = 10) => {
          if (yOffset + neededHeight > pageHeight - bottomMargin) {
            doc.addPage();
            yOffset = topMargin;
          }
        };

        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text(this.currentChatTitle || this.generateChatTitle(), leftMargin, yOffset);
        yOffset += 15;

        this.openMessages.forEach((msg) => {
          checkPageBreak(20);
          yOffset += 5;

          doc.setFontSize(10);
          doc.setFont('helvetica', 'bold');
          const sender = msg.sender === 'user' ? 'User' : 'Bot';
          const timestamp = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : new Date().toLocaleString();
          doc.text(`${sender} (${timestamp}):`, leftMargin, yOffset);
          yOffset += 6;

          const parsedContent =
            msg.sender === 'bot' && msg.content
              ? this.parseMarkdownForPDF(msg.content)
              : [
                  {
                    type: 'line',
                    content: [{ text: msg.content || '', style: 'normal' }],
                    indent: 0
                  }
                ];

          parsedContent.forEach((block) => {
            checkPageBreak();

            if (block.type === 'space') {
              yOffset += 5;
              return;
            }
            if (block.type === 'hr') {
              doc.setDrawColor(150);
              doc.line(leftMargin, yOffset + 2, rightMargin, yOffset + 2);
              yOffset += 6;
              return;
            }
            if (!block.content || block.content.length === 0) {
              yOffset += 3;
              return;
            }

            let xOffset = leftMargin + (block.indent || 0);

            if (block.isQuote) {
              doc.setFillColor(230, 230, 230);
              doc.rect(leftMargin, yOffset - 4, 3, 6, 'F');
            }

            const linePartsQueue = [...block.content];

            while (linePartsQueue.length > 0) {
              const part = linePartsQueue.shift();
              const availableWidth = rightMargin - xOffset;

              doc.setFontSize(12);
              let fontStyle = 'normal';
              if (part.style === 'bold') fontStyle = 'bold';
              if (part.style === 'italic') fontStyle = 'italic';
              doc.setFont('helvetica', fontStyle);

              if (part.style && part.style.startsWith('h')) {
                const level = parseInt(part.style.replace('h', '')) || 1;
                doc.setFontSize(12 + (6 - level) * 2);
                doc.setFont('helvetica', 'bold');
              } else if (part.style === 'code') {
                doc.setFont('courier', 'normal');
                doc.setFontSize(10);
              }

              const splitText = doc.splitTextToSize(part.text, availableWidth);

              doc.text(splitText[0], xOffset, yOffset);
              xOffset += (doc.getStringUnitWidth(splitText[0]) * doc.getFontSize()) / doc.internal.scaleFactor;

              if (splitText.length > 1) {
                const remainingText = splitText.slice(1).join(' ');
                linePartsQueue.unshift({
                  text: remainingText,
                  style: part.style
                });

                yOffset += 6;
                checkPageBreak();
                xOffset = leftMargin + (block.indent || 0);
                if (block.isQuote) {
                  doc.setFillColor(230, 230, 230);
                  doc.rect(leftMargin, yOffset - 4, 3, 6, 'F');
                }
              }
            }
            yOffset += 6;
          });
        });

        let filename = this.exportDialog.filename.trim();
        if (!filename.toLowerCase().endsWith('.pdf')) {
          filename += '.pdf';
        }
        filename = filename.replace(/[^a-zA-Z0-9\-_.]/g, '_');

        doc.save(filename);
        notificationService.success(this.translate('chatbot.exportSuccess'));
        this.exportDialog.visible = false;
      } catch (error) {
        console.error('Error exporting chat to PDF:', error);
        notificationService.error(this.translate('chatbot.exportError'));
      }
    },

    updateDialogTexts() {
      this.newChatDialog = {
        title: this.translate('chatbot.newChatTitle'),
        message: this.translate('chatbot.unsavedChanges'),
        confirmText: this.translate('chatbot.saveAndStartNew'),
        cancelText: this.translate('chatbot.discardAndStartNew'),
        secondaryText: this.translate('common.cancel')
      };
      this.loadConfirmDialog = {
        title: this.translate('chatbot.loadConfirmTitle'),
        message: this.translate('chatbot.loadConfirmMessage'),
        confirmText: this.translate('chatbot.loadAndDiscard'),
        cancelText: this.translate('common.cancel'),
        secondaryText: this.translate('chatbot.saveAndLoad')
      };
    }
  }
};
</script>

<style scoped>
.animate-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* No `gap` — see the note on `.main-container` in App.vue. A flex gap
   sits between the items, so a collapsed right rail was separated
   from the content by a channel it should not have had; the spacing
   is the panel's own margin, and a collapsed panel drops it. */
.app-container {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

.chatbot-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  position: relative;
  flex: 1;
  overflow: hidden;
}

/* The per-turn avatars: the assistant carries the product icon in a
   36px rounded tile, the user a photo, initials in an accent circle, or a
   silhouette when even the name is absent. */
.message-avatar {
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  border-radius: 999px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.message-avatar--assistant {
  border: 1px solid var(--border-light);
  background: var(--surface);
}

.message-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.message-avatar__initials {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: inherit;
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--accent-fg-strong);
  /* One accent ground for everyone — the reference shows the user's
     circle in the brand accent, not a per-name hash. */
  background: var(--accent);
}

.message-avatar__silhouette {
  color: var(--muted);
}

/* The conversation header strip. */
.conversation-header {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-xs) var(--space-md);
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

.conversation-header__title {
  flex: 1 1 auto;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conversation-header__actions {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3xs, 4px);
}

.conversation-header__action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.conversation-header__action:hover:not(:disabled) {
  background: var(--accent-muted);
  color: var(--fg);
}

.conversation-header__action:disabled {
  opacity: 0.5;
  cursor: default;
}

.conversation-header__close {
  margin-left: var(--space-xs);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.conversation-header__close:hover {
  background: var(--accent-muted);
  color: var(--fg);
}

/* System Status Panel */

/* Context Panel Styles */
.context-panel {
  background: var(--surface);
  border-bottom: 1px solid var(--border-light);
  padding: var(--space-sm) var(--space-sm);
  font-size: var(--text-base);
}

.context-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: var(--space-sm);
}

.context-title {
  font-weight: 600;
  color: var(--fg);
}

.context-items {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
}

.context-remove-btn {
}

/* Chat Window Styles */
.chat-window {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-sm);
  background: var(--surface);
}

.chat-message {
  margin-bottom: var(--space-md);
  display: flex;
  align-items: flex-start;
}

.chat-message.user {
  justify-content: flex-end;
}

.chat-message.bot {
  justify-content: flex-start;
}

.message-bubble {
  background: var(--bg);
  color: var(--fg);
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  font-size: var(--text-base);
  line-height: 1.5;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.chat-message.user .message-bubble {
  background: var(--accent);
  color: var(--accent-fg);
  border: none;
  border-bottom-right-radius: var(--radius-sm);
}

.chat-message.bot .message-bubble {
  border-bottom-left-radius: var(--radius-sm);
}

/* One elevated card per answer; the bubble loses its own chrome inside it. */
.answer-card {
  background: var(--surface-raised);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  padding: var(--space-md);
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  min-width: 0;
}

.answer-card .message-bubble {
  background: transparent;
  border: none;
  padding: 0;
  border-radius: 0;
}

/* The ungrounded warning and the retryable error — both amber,
   never red: an error is a state, not an accusation. */
.answer-warning {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  margin-top: var(--space-sm);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  background: var(--warning-bg);
  color: var(--warning-ink);
  font-size: var(--text-xs);
}

.answer-error {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm);
  border-radius: var(--radius-sm);
  background: var(--warning-bg);
  color: var(--warning-ink);
  font-size: var(--text-sm);
}

.answer-retry {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  border: 1px solid var(--warning-ink);
  background: transparent;
  color: var(--warning-ink);
  padding: 2px var(--space-sm);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  cursor: pointer;
}

.answer-retry:hover {
  background: var(--warning-bg);
}

/* The inline actions row — thumbs, details, copy, confidence. */
.answer-actions {
  display: flex;
  gap: var(--space-sm);
  align-items: center;
  margin-top: var(--space-sm);
  padding-top: var(--space-sm);
  border-top: 1px solid var(--border-light);
}

.answer-action {
  border: none;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  display: inline-flex;
  padding: 4px;
  border-radius: var(--radius-sm);
}

.answer-action:hover {
  color: var(--fg);
  background: var(--accent-muted);
}

.answer-action[data-rated='true'] {
  color: var(--accent);
  background: var(--accent-muted);
}

/* The per-answer collapsible sources. */
.answer-sources {
  border-top: 1px solid var(--border-light);
  padding-top: var(--space-sm);
}

.answer-sources__toggle {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  background: none;
  border: none;
  padding: 0;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--fg);
  cursor: pointer;
}

.answer-sources__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  margin-top: var(--space-xs);
}

.answer-source-card {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-xs) var(--space-sm);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--fg);
  text-decoration: none;
}

.answer-source-card:hover {
  border-color: var(--accent);
}

.answer-source-card__body {
  /* The free span between the badge and the open icon: the title starts
     at the same left edge on every card, whatever its length. */
  display: flex;
  align-items: baseline;
  gap: var(--space-sm);
  flex: 1 1 auto;
  min-width: 0;
}

.answer-source-card__title {
  font-size: var(--text-sm);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.answer-source-card__size {
  font-size: var(--text-xs);
  color: var(--muted);
  flex: 0 0 auto;
}

.answer-source-card__open {
  margin-left: auto;
  color: var(--muted);
  flex: 0 0 auto;
}

.message-wrapper {
  display: flex;
  align-items: flex-end;
  gap: var(--space-sm);
  max-width: 85%;
}

.chat-message.user .message-wrapper {
  flex-direction: row-reverse;
}

.message-time {
  font-size: var(--text-xs);
  color: var(--time-ink);
  white-space: nowrap;
  padding: 1px var(--space-sm);
  border-radius: 999px;
  background: var(--surface);
}

/* Markdown Styles within Message Bubble */
.message-bubble :deep(h1),
.message-bubble :deep(h2),
.message-bubble :deep(h3),
.message-bubble :deep(h4),
.message-bubble :deep(h5),
.message-bubble :deep(h6) {
  font-weight: 600;
  margin: 0.5em 0;
  color: var(--fg);
}

.message-bubble :deep(h1) {
  font-size: 1.5em;
}
.message-bubble :deep(h2) {
  font-size: 1.3em;
}
.message-bubble :deep(h3) {
  font-size: 1.2em;
}
.message-bubble :deep(h4) {
  font-size: 1.1em;
}
.message-bubble :deep(h5) {
  font-size: 1em;
}
.message-bubble :deep(h6) {
  font-size: 0.9em;
}

.message-bubble :deep(p) {
  margin: 0.5em 0;
  color: var(--fg);
}

.message-bubble :deep(ul),
.message-bubble :deep(ol) {
  margin: 0.5em 0;
  padding-left: 1.5em;
}

.message-bubble :deep(li) {
  margin-bottom: 0.3em;
  color: var(--fg);
}

.message-bubble :deep(a) {
  color: var(--accent);
  text-decoration: underline;
}

.message-bubble :deep(a:hover) {
  color: var(--accent-hover);
}

.message-bubble :deep(code) {
  background: var(--bg);
  padding: 0.2em 0.4em;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  color: var(--fg);
}

.message-bubble :deep(pre) {
  background: var(--bg);
  padding: 0.8em;
  border-radius: var(--radius-sm);
  overflow-x: auto;
  font-family: var(--font-mono);
  color: var(--fg);
}

.message-bubble :deep(blockquote) {
  border-left: 3px solid var(--border);
  padding-left: 0.8em;
  margin: 0.5em 0;
  color: var(--muted);
}

.message-bubble :deep(table) {
  border-collapse: collapse;
  margin: 0.5em 0;
  width: 100%;
}

.message-bubble :deep(th),
.message-bubble :deep(td) {
  border: 1px solid var(--border);
  padding: 0.4em 0.8em;
  color: var(--fg);
}

.message-bubble :deep(th) {
  background: var(--bg);
  font-weight: 600;
}

.message-bubble :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: var(--radius-sm);
}

/* Streaming Indicator — shown inside bot bubble while waiting for first chunk */
.streaming-indicator {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  color: var(--muted);
  font-size: var(--text-sm);
  padding: var(--space-xs) 0;
}

.confidence-score {
  font-size: var(--text-sm);
  color: var(--muted-soft);
  background: var(--surface);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  /* The score parks at the end of the actions row instead of taking a
     row of its own. */
  margin-left: auto;
}

/* Quick Help Overlay */
.quick-help-overlay {
  /* The narrow-panel adaptation below .quick-help-content is a container
     query on this element, so the container has to exist whether the Living
     Intelligence layer is on or off — otherwise the layer's presence would
     decide the app's layout. The layer declares the same property on the same
     element for its own art query; the two agree, and the app's declaration is
     the one that is always there. */
  container-type: inline-size;
  /* Every welcome constant is declared here, on the one element that
     contains all three of its consumers — the veil's content box, the
     composer wrapper and the card row — so each of them resolves
     against a single declaration instead of a literal of its own.

     --qh-measure is the resulting four-column cap (4 cards + 3 gaps),
     964 px at the default tokens. The grid's auto-fit bound and both
     max-widths read these two, so a deployment that overrides
     --space-xl or the card minimum moves the row, the wrapper and the
     bar's inset in step.

     --qh-card-min is a component-local extension point (the same shape
     as the Living Intelligence layer's per-button --qh-bg / --qh-hover
     tokens) rather than a new token in theme-variables.css: 217 px is
     the card width measured off the reference mockup.

     --qh-veil-pad is the landing ground for the veil's horizontal
     ramp. The Living Intelligence layer fades that ramp over
     min(24px, this padding) of its own naming (--qh-veil-ramp), so the
     ramp is exhausted here and never eats a glyph. --space-xl holds
     it at 32 px, 8 px wider than the ramp on each side; the
     container query below .quick-help-content steps it down to 8 px
     for a narrow panel, and the ramp follows it there.

     --qh-heading-scale multiplies the heading's type size. It is 1 at
     every width the reference covers, and the narrow-panel query
     below steps it down.

     --qh-composer-ratio insets the bar from the row it sits above; see
     .quick-help-composer below.

     These values are mirrored rather than shared on the JavaScript
     side: composables/sidebarLayout.js derives CENTRE_MIN_WIDTH
     (480 px) from the same 217 px + 32 px arithmetic in prose, because
     a module-scope constant cannot read a custom property off an
     element that does not exist yet. Change one and the other has to be
     changed with it. */
  --qh-card-min: 217px;
  --qh-measure: calc(4 * var(--qh-card-min) + 3 * var(--space-xl));
  --qh-veil-pad: var(--space-xl);
  --qh-heading-scale: 1;
  --qh-composer-ratio: 81%;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--surface);
  z-index: 10;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-lg);
  /* The banner's full-bleed reaches past the overlay's content box
     on purpose: the artwork has to touch the panel's edges, not sit
     centred inside them. It bleeds by a fixed --space-lg (24 px) a side
     at every viewport. Above 1300 px the overlay's padding is that same
     24 px, so the bleed is absorbed by it and the banner's edges land on
     the panel's. Below 1300 px the padding is stripped, there is nothing
     to bleed into, and the banner overshoots by 24 px a side — which is
     what this clip absorbs. The wave ::after spans the padding box
     exactly and never overshoots. The clip is what keeps the banner's
     overshoot from becoming a horizontal scrollbar, which is the
     property that decides whether one is drawn. */
  overflow-y: auto;
  overflow-x: hidden;
}

/* At narrow viewports the chat column is too small to spare a 24 px
   gutter on each side of the grid — that 48 px would otherwise eat
   the panel below the 466 px needed for two cards at the reference's
   card width. Stripping the overlay's padding at viewports below
   1300 px gives the grid the full chat column (panel ≈ vw − 794,
   so panel ≈ 506 − 48 = 458 right at the threshold) and lets auto-fit
   deliver 2 cols at 1280 px (panel 486 px), 1 col at 1024 px (panel
   230 px), and 1 col at 769 px (panel 311 px) without any further
   rule. The hero's full-bleed negative margin still uses --space-lg
   (24 px) at every width, so the banner extends the same distance
   past the visible edge regardless of viewport — the banner art
   and its container query are unaffected. Above 1300 px the padding
   is restored and the grid keeps the same gutter as before (the
   reference's own look at 1920 px). */
@media (max-width: 1299px) {
  .quick-help-overlay {
    padding: 0;
  }
}

.quick-help-content {
  /* The veil wraps the title and its subtitle instead of spanning the
     banner: the reference carries the text directly on the artwork, and
     a band across the whole width washes the icon tiles as well. The
     padding is the landing ground for the veil's horizontal ramp, which
     the Living Intelligence layer fades over min(24px, this padding), so
     the ramp is spent before it reaches a glyph whatever the title's
     length. The box's height is unchanged — the layer's padding is what
     sets it — so the title stays where it is relative to the artwork's
     fade. */
  width: fit-content;
  /* The padding sits outside the text's own box: with the global
     border-box it would eat the title's line and wrap it. The max-width
     is the banner's width less the two paddings, so the veil never
     overflows the artwork it covers. Both read --qh-veil-pad, so one
     declaration moves the padding and its cap together and the cap can
     never admit a veil the banner cannot hold. */
  box-sizing: content-box;
  max-width: calc(100% - 2 * var(--qh-veil-pad));
  margin-inline: auto;
  padding-inline: var(--qh-veil-pad);
}

/* The narrow panel. With both sidebars in flow the centre column is at
   its narrowest at the breakpoint itself — 630 px of panel at a 1400 px
   viewport — and widens from there, while below 1400 px the sidebars go
   off-canvas and the panel IS the viewport. So a panel narrower than
   about 675 px of content is the whole narrow-panel window: no wrap in
   the shipped locales, and nothing for the veil's 32 px of padding to
   spend on either.

   Two things give, both read from the same container — the overlay is
   this component's own `container-type: inline-size` element, so the
   query keys on the panel and not on the viewport, it fires
   identically whether the panel is narrow because the viewport is or
   because a sidebar is collapsed, and it fires identically whether the
   Living Intelligence layer is on or off. Above the threshold nothing
   here applies and the render is the reference's.

     --qh-veil-pad 32 -> 8 px. The veil has to be as wide as its widest
       child plus twice this, and 32 px of it is 64 px the title cannot
       have: 630 - 64 = 566 px of content, which the French title
       (578.3 px) overruns by 12 and Manx (659.1 px) by 93. At 8 px
       the content is 614 px, which clears Manx outright.

     --qh-heading-scale 1 -> 0.92. The padding alone leaves Manx 45 px
       over the 614 px it has, and no padding can close that without
       taking the veil's margin to nothing; 45 px is 6.8 % of the
       longest shipped title, so an 8 % step clears it — measured, the
       title lands at 606.3 px and 7.7 px to spare. This is the long
       tail Option B buys — it is locale-blind, so it steps the English
       title too, in the narrow panel only, where the panel is at its
       narrowest and a display size is the one thing with room to give.

   Both tokens are declared on .quick-help-content, the element that
   reads the padding and the common ancestor of the heading that reads
   the scale; the base values live on .quick-help-overlay, so both
   resolve for every descendant of the overlay whether or not the veil
   is rendered. */
@container (max-width: 675px) {
  .quick-help-content {
    --qh-veil-pad: 8px;
    --qh-heading-scale: 0.92;
  }
.quick-help-overlay > :last-child {
  margin-bottom: auto;
}

/* The heading and the subtitle under it share one gap: the heading
   gives up all but --space-sm and the subtitle carries the rest down to
   the card row, so the pair needs no negative margin to sit tight.

   The typography is declared here as well as in the Living Intelligence
   layer (genie-visual-effects.css, on its own selector at a higher
   specificity, with the same two values). The app owns the pair because
   the narrow-panel scale above is calibrated against this heading's
   measured width: a title 5 % wider — because the layer was off, or
   because a deployment set the theme's --font-display differently — is
   a title the scale was not measured against, and it wraps where the
   scale says it fits. The layer's rule stays as the redundant-but-equal
   declaration, the shape this component already uses for the veil's
   padding. */
.quick-help-heading {
  position: relative;
  z-index: 2;
  text-align: center;
  font-family: var(--font-display);
  font-size: calc(var(--text-xl) * var(--qh-heading-scale));
  font-weight: 600;
  letter-spacing: -0.025em;
  margin-bottom: var(--space-sm);
  color: var(--fg);
}

.quick-help-subtitle {
  text-align: center;
  font-size: var(--text-md);
  /* The subtitle's `margin: 0 0 var(--space-lg)` is load-bearing:
     the welcome scrim (.quick-help-content) is bottom-anchored in
     the banner's art box, so changing the subtitle's bottom margin
     moves the scrim and the heading inside or outside of the
     banner's mask fade (which starts at 72% of the banner's
     height). Keeping the original gap here also keeps the
     composer→grid rhythm that the composer wrapper's own margin
     carries on its own — the overlay stays gap-less so the
     subtitle's natural margin is what positions the rest. */
  margin: 0 0 var(--space-lg);
  /* A brand tint, not the neutral grey --muted carries: 60% of the
     heading's --fg mixed into the theme's --accent. It reads as the
     brand colour the subtitle is meant to carry (a navy in light, a
     light blue in dark) where --muted reads grey, and in the dark theme
     it does not read dim: dark --muted is derived from --brand at
     L 0.58, whose luminance (0.196) sits barely above the scrim's
     (0.031), which puts that ink at 3.05:1 against the artwork behind
     it, under the 4.5:1 floor WCAG AA sets for 16px/400 text.
     Lightening the scrim does not rescue it: at alpha 0.50 the same ink
     measures 2.32:1 in dark and 3.98:1 in light, because the veil's own
     contribution is what darkens the backdrop the dim ink sits on. This
     mix measures 9.95:1 light / 8.91:1 dark — and the 40% of --accent
     in it is what keeps the subtitle a visible step below the heading
     instead of a second heading. */
  color: color-mix(in oklch, var(--fg) 60%, var(--accent));
}

/* el-salvador agri sections (Insights / Market Prices) — they render
   under the quick-help grid in the welcome overlay. */
.quick-help-banner {
  /* App-owned anchor for the mascot bubble: the Living Intelligence
     layer also positions this banner when it is switched on, but the
     bubble must hold bottom-right whether that layer is on or off. */
  position: relative;
}

.welcome-mascot-bubble {
  position: absolute;
  right: 4%;
  bottom: 14%;
  width: clamp(180px, 36%, 340px);
  padding: clamp(6px, 0.9cqw, 12px) clamp(10px, 1.5cqw, 20px);
  background: var(--surface);
  color: var(--fg);
  border: 2px solid var(--accent-gold, var(--accent));
  border-radius: 16px;
  font-size: clamp(14px, 1.8cqw, 22px);
  font-weight: 600;
  line-height: 1.3;
  text-align: center;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.35);
}

.welcome-mascot-bubble::after {
  content: '';
  position: absolute;
  top: -7px;
  left: 16%;
  transform: rotate(45deg);
  width: 14px;
  height: 14px;
  background: var(--surface);
  border-top: 2px solid var(--accent-gold, var(--accent));
  border-left: 2px solid var(--accent-gold, var(--accent));
}

.insights-section,
.market-prices-section {
  width: 100%;
  max-width: 800px;
  margin-inline: auto;
  margin-bottom: var(--space-lg);
}

.section-header {
  margin-bottom: var(--space-md);
}

.section-title {
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--fg);
  margin: 0;
}

.insights-cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-sm);
  margin-bottom: var(--space-sm);
}

.insights-cards > * {
  grid-column: span 2;
}

.market-cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-sm);
}

/* The welcome composer shares the grid's measured width — same cap,
   same auto-margin centering — so the bar and the card row present
   one visual strip rather than a shrinking pill next to a wide grid.
   Without `width: 100%`, the flex shrink-to-fit on a column with
   `align-items: center` would collapse the bar to its intrinsic width
   and contradict the panel-rhythm the composer is meant to belong to.

   The `margin: var(--space-lg) 0` is the composer's own spacing to its
   siblings: the overlay's flex `gap` is zero and the subtitle above
   carries its own bottom margin, so the composer is the one child here
   that has to state its spacing. */
.quick-help-composer {
  width: 100%;
  max-width: var(--qh-measure);
  margin: var(--space-lg) auto;
}

/* The bar itself is inset from the row it sits above, and the inset is
   measured against the CARD ROW, not against the wrapper: the
   reference's bar spans 805 px of a 989 px card row — 0.81 — at both
   themes. The wrapper already carries the row's own measure (both caps
   read --qh-measure and both are width: 100% of the same overlay
   content box), so 81 % of the wrapper is 81 % of the row at every
   viewport: where the cap binds the two are equal by construction, and
   where it does not the wrapper is simply the overlay's content width
   on both sides.

   The ratio travels as --composer-width, the shared composer's own
   escape hatch, rather than as a `width` on this selector. The
   composer keeps ownership of the property and a consumer supplies a
   value; neither side has to out-specify the other to get a number. */
.quick-help-composer .chat-composer {
  --composer-width: var(--qh-composer-ratio);
  margin-inline: auto;
}

/* The welcome composer's leading mark is the reference's sparkles, drawn
   in the accent's light blue rather than in the text colour. */
.composer-leading-mark {
  color: var(--accent);
  flex: 0 0 auto;
}

/* The chat view's leading control is the new-chat button, in the
   reference's rounded square. */
.composer-leading-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  background: transparent;
  border: 1px solid transparent;
  color: var(--fg);
  cursor: pointer;
}
.composer-leading-btn:hover {
  background: var(--accent-muted);
}

/* The grid's column count is driven by container queries on the panel
   width below. The base rule is the single-column fallback used when
   the panel is too narrow for two columns. */

.quick-help-item {
  display: flex;
  align-items: center;
}

.quick-help-item:hover {
  --ds-card-border-color: var(--accent-hover);
}

.quick-help-icon {
  margin-right: var(--space-md);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 40px;
}

.quick-help-icon img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.quick-help-text {
  font-size: var(--text-base);
  color: var(--fg);
  font-weight: 500;
}

/* el-salvador agri sections responsive — the quick-help grid is NOT
   listed here: it is auto-fit against the panel width (see the grid
   block below), so viewport steps would fight it. */
@media (max-width: 1024px) {
  .insights-cards,
  .market-cards {
    grid-template-columns: repeat(3, 1fr);
  }

  .insights-cards > * {
    grid-column: span 3;
  }
}

@media (max-width: 768px) {
  .insights-cards,
  .market-cards {
    grid-template-columns: repeat(2, 1fr);
  }

  .insights-cards > * {
    grid-column: span 2;
  }
}

@media (max-width: 480px) {
  .insights-cards,
  .market-cards {
    grid-template-columns: 1fr;
  }

  .insights-cards > * {
    grid-column: span 1;
  }
}

/* Chat Input Styles — the chat-view composer sits in this wrapper.
   The composer itself owns its internal layout; this block is just
   the panel that hugs the bottom of the chatbot container and
   inherits the existing top border / background. */
.chat-input {
  background: transparent;
  border-top: none;
  padding: var(--space-sm) var(--space-md);
}

/* Form Styles for Save Dialog */
.form-group {
  margin-bottom: var(--space-md);
}

.form-group label {
  display: block;
  margin-bottom: var(--space-sm);
  font-weight: 500;
  color: var(--fg);
}

/* The grid follows its container, not the viewport. The two fixed
   sidebars reserve ~770 px of horizontal space from the 768 px
   breakpoint up, so a viewport-driven grid breaks at 1280 px and
   below. The grid uses auto-fit minmax() so the column count tracks
   the panel width at every size, and a max-width cap so a wider
   panel never grows a fifth column — the reference mocks exactly
   four.

   auto-fit's lower bound and the cap both read --qh-card-min and
   --qh-measure, declared on .quick-help-overlay — the common ancestor
   of this grid and the composer wrapper — so a deployment that changes
   either token gets a grid that recomputes its column count, a cap and
   a composer wrapper in step. Changing --space-xl does NOT require
   updating these rules. */
.quick-help-grid {
  display: grid;
  width: 100%;
  gap: var(--space-xl);
  grid-template-columns: repeat(auto-fit, minmax(var(--qh-card-min), 1fr));
  /* The four-column cap, shared with the composer wrapper. */
  max-width: var(--qh-measure);
  margin-inline: auto;
}

@media (max-width: 480px) {
  /* Weight, not size: at --text-lg the heading is 20px, which is under
     WCAG's 24px limb for large text, so the brand ramp inside it has to
     clear 4.5:1 rather than the 3:1 large-text allowance. 20px at weight
     700 is large text, and the ramp's worst stop is 3.99:1 against the
     white panel this viewport renders. Sizes assume --font-scale: 1;
     the operator's typography.fontScale scales --text-lg with the rest
     of the tokens, so a deployment that drops it below ~0.93 (18.66px
     at weight 700 — the WCAG threshold above which the mark qualifies
     as large text and gets the 3:1 allowance, below which it has to
     clear 4.5:1 and the worst 3.99:1 stop fails) takes the
     responsibility itself rather than getting a non-scaling floor. */
  .quick-help-heading {
    font-size: var(--text-lg);
    font-weight: 700;
  }
}

/* Saving Indicator Styles */
.saving-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-sm);
  margin-top: var(--space-md);
  padding: var(--space-md);
  background-color: var(--bg);
  border-radius: var(--radius-sm);
  color: var(--muted);
  font-size: var(--text-base);
}

.saving-indicator :deep(svg) {
  color: var(--accent);
}
</style>
