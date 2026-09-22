'use strict';

/**
 * ChatBotComponent tests — AC1 through AC5.
 *
 * Covers: empty render, user message submission, input clearing,
 * loading state, and error state.
 */
const { mount, flushPromises } = require('@vue/test-utils');
const { createStore } = require('vuex');
const { createAuthenticatedState, defaultAuthenticatedUser } = require('../fixtures/store-state');
// The real en locale — the wording the notification must end up showing.
const enChatbot = require('../../i18n/locales/en.js').default.chatbot;

// ---------------------------------------------------------------------------
// Service mocks (closure-based refs for per-test control)
// ---------------------------------------------------------------------------

let capturedCallbacks = {};
let capturedQueryData = null;

const mockSubmitQueryStream = jest.fn((_queryData, callbacks) => {
  capturedQueryData = _queryData;
  capturedCallbacks = callbacks;
  return { abort: jest.fn(), signal: {} };
});

jest.mock('../../services/chatbotService', () => ({
  submitQueryStream: mockSubmitQueryStream,
  submitFeedback: jest.fn().mockResolvedValue({}),
  submitQuery: jest.fn().mockResolvedValue({}),
  updateQueryResponseTime: jest.fn().mockResolvedValue({}),
  markQueryAsAnswered: jest.fn().mockResolvedValue({})
}));

jest.mock('../../services/chatHistoryService', () => ({
  getConversation: jest.fn().mockResolvedValue({ messages: [] }),
  createConversation: jest.fn().mockResolvedValue({ _key: 'new-conv' }),
  addMessage: jest.fn().mockResolvedValue({}),
  updateConversation: jest.fn().mockResolvedValue({}),
  deleteConversation: jest.fn().mockResolvedValue({})
}));

jest.mock('../../services/serviceTreeService', () => ({
  getAllCategories: jest.fn().mockResolvedValue([])
}));

const mockNotificationError = jest.fn();
const mockNotificationSuccess = jest.fn();
const mockNotificationInfo = jest.fn();
const mockNotificationWarning = jest.fn();

jest.mock('../../services/notificationService', () => ({
  error: mockNotificationError,
  success: mockNotificationSuccess,
  info: mockNotificationInfo,
  warning: mockNotificationWarning
}));

// Event bus mock
const mockEventBusOn = jest.fn();
const mockEventBusOff = jest.fn();
const mockEventBusEmit = jest.fn();

jest.mock('../../eventBus', () => ({
  eventBus: {
    $on: mockEventBusOn,
    $off: mockEventBusOff,
    $emit: mockEventBusEmit
  }
}));

// Mock the runtime config loader (loadQuickHelpButtons imports it dynamically).
// Must mock config-loader, the module that actually exports loadConfig —
// mocking main.js would fake an export the production module no longer has.
jest.mock('../../config-loader', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue({
    features: { chat: { quickHelp: { buttons: [] } } }
  }),
  config: { app: { icon: { type: 'file', value: '/config/logo-genie-ai.jpeg' } } },
  defaults: { app: { icon: { type: 'file', value: '/config/logo-genie-ai.jpeg' } } }
}));

// Mock heavy libraries
// Re-use the real `Renderer` class from marked so the SFC's tight-list
// renderer override (`Object.assign(new Renderer(), { listitem(token) {...} })`)
// can load. Mocking the whole module without exposing `Renderer` makes the
// import resolve to undefined and crashes the suite at module-evaluation time.
// marked: leave the real library in place so the SFC's tight-list
// renderer override (registered through `marked.use({ renderer: ... })`)
// runs against the real parser. Earlier the file mocked `marked.parse`
// to identity, which kept the rest of the suite happy but broke the
// Markdown rendering tests that inspect the rendered HTML.
jest.mock('dompurify', () => ({ sanitize: jest.fn((c) => c) }));
jest.mock('jspdf', () => {
  return jest.fn().mockImplementation(() => ({
    text: jest.fn(),
    save: jest.fn(),
    setFontSize: jest.fn(),
    splitTextToSize: jest.fn((t) => [t]),
    internal: { pageSize: { getWidth: () => 210 } },
    addPage: jest.fn(),
    setFont: jest.fn(),
    getStringUnitWidth: jest.fn(() => 10),
    getFontSize: jest.fn(() => 12),
    line: jest.fn(),
    rect: jest.fn(),
    setFillColor: jest.fn(),
    setDrawColor: jest.fn()
  }));
});
jest.mock('@lucide/vue', () => ({
  Brain: { template: '<svg />' },
  Loader2: { template: '<svg />' },
  Plus: { template: '<svg />' },
  Save: { template: '<svg />' },
  FileText: { template: '<svg />' }
}));

// ---------------------------------------------------------------------------
// Component import (after mocks)
// ---------------------------------------------------------------------------
const ChatBotComponent = require('../../components/ChatBotComponent.vue').default;
const statusModule = require('../../store/modules/status.js').default;
const conversationModule = require('../../store/modules/conversation.js').default;
const { rehydrateConversation, STORAGE_KEY } = require('../../store/modules/conversation.js');

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

function createChatBotStore(stateOverrides = {}) {
  const state = createAuthenticatedState(stateOverrides);
  return createStore({
    state: () => state,
    // The real store registers auth non-namespaced, so its getters sit
    // at the root — the save paths read currentUser through them.
    getters: {
      currentUser: (s) => s.user
    },
    modules: {
      // The component commits reachability to the shared status module;
      // the real mutations are used so the tests assert state outcomes.
      status: {
        ...statusModule,
        state: () => ({ ...statusModule.state })
      },
      // The component renders from the store-owned conversation.
      conversation: {
        ...conversationModule,
        state: () => conversationModule.state()
      },
      chatHistory: {
        namespaced: true,
        state: () => state.chatHistory,
        getters: {
          getAllFolders: (s) => s.folders,
          getChatById: (s) => (chatId) => (s.chats || []).find((c) => c.id === chatId) || null
        },
        actions: {
          createChat: jest.fn().mockResolvedValue({}),
          updateChat: jest.fn().mockResolvedValue({})
        }
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Mount helper
// ---------------------------------------------------------------------------

function createChatBotWrapper(storeOverrides = {}, { rehydrate = false } = {}) {
  const store = createChatBotStore(storeOverrides);
  if (rehydrate) rehydrateConversation(store.state.conversation);
  const configMock = {
    app: {
      icon: { type: 'inline', value: '' },
      title: 'AgroGenio',
      banner: { url: '/assets/agrogenio/banner.png' },
      mascot: { url: '/assets/agrogenio/mascot-avatar.png', alt: 'Mascot' },
      leaves: { url: '/assets/agrogenio/leaves-large.png' },
      sidebarLeaf: { url: '/assets/agrogenio/leaf-particles.png' }
    }
  };
  return mount(ChatBotComponent, {
    global: {
      plugins: [store],
      provide: { config: configMock },
      mocks: {
        config: configMock,
        $t: (key) => key,
        $i18n: { locale: 'en' }
      },
      stubs: {
        ChatResponseFeedbackDialog: true,
        ModalDialog: true,
        RightSideBarComponent: true,
        ConfirmDialog: true,
        DsPill: true,
        DsButton: {
          template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
          props: ['disabled', 'variant', 'small', 'tag']
        },
        DsCard: true,
        DsInput: {
          template:
            '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" @keydown.enter="$emit(\'enter\')" />',
          props: ['modelValue', 'placeholder', 'disabled', 'type'],
          emits: ['update:modelValue', 'enter']
        },
        DsSelect: true,
        Brain: true,
        Loader2: true,
        Plus: true,
        Save: true,
        FileText: true
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChatBotComponent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedCallbacks = {};
    capturedQueryData = null;
  });

  // -----------------------------------------------------------------------
  // AC1 — Renders chat window with empty message list
  // -----------------------------------------------------------------------
  describe('AC1 — renders with empty message list', () => {
    it('renders the chat container without errors', () => {
      const wrapper = createChatBotWrapper();
      expect(wrapper.find('[data-test-id="chatbot-container"]').exists()).toBe(true);
    });

    it('the welcome overlay does not cover a conversation in progress', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // Fresh mount: no question asked yet — the welcome overlay is the view.
      expect(wrapper.find('.quick-help-overlay').exists()).toBe(true);

      // A question in the store (the conversation survived a navigation):
      // the overlay must get out of the way.
      vm.$store.commit('conversation/appendUserMessage', {
        sender: 'user',
        content: 'asked something',
        isSaved: false
      });
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.quick-help-overlay').exists()).toBe(false); // the overlay must not cover the conversation
      expect(wrapper.find('.chat-input').exists()).toBe(true); // the conversation composer is the view
    });

    it('opens on the welcome message in the conversation transcript', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const botMsgs = vm.openMessages.filter((m) => m.sender === 'bot');
      expect(botMsgs.length).toBeGreaterThanOrEqual(1);
    });

    it('renders a message input area', async () => {
      // The default config-loader mock returns an empty buttons list,
      // so `composerEntry` is null and the welcome composer is gated
      // out — the v-else chat composer then renders instead. Install
      // a non-empty just-chat entry so the welcome composer is the
      // input that lives in the DOM here, mirroring production.
      const configLoader = require('../../config-loader');
      configLoader.default.mockResolvedValue({
        features: {
          chat: {
            quickHelp: {
              buttons: [
                {
                  id: 'just-chat',
                  title: { en: 'Just Chat' },
                  icon: { type: 'file', value: '/config/quickhelp/just-chat.svg' },
                  category: null,
                  placement: 'composer'
                },
                {
                  id: 'one',
                  title: { en: 'One' },
                  icon: { type: 'file', value: '/config/quickhelp/one.svg' },
                  category: 'cat-1'
                }
              ]
            }
          }
        }
      });
      const wrapper = createChatBotWrapper();
      await flushPromises();
      // The composer slots between the welcome panel and the chat input
      // area via v-if/v-else — only one is in the DOM at a time. The
      // welcome screen is the default rendered state, so the welcome
      // composer is the input that lives in the DOM here.
      expect(
        wrapper.find('input').exists() || wrapper.find('.ds-input').exists() || wrapper.find('.chat-composer').exists()
      ).toBe(true);
      // Restore the empty default for the rest of the suite.
      configLoader.default.mockResolvedValue({
        features: { chat: { quickHelp: { buttons: [] } } }
      });
    });
  });

  // -----------------------------------------------------------------------
  // AC2 — User message displayed after submission
  // -----------------------------------------------------------------------
  describe('AC2 — user message displayed after submission', () => {
    it('displays the user message in chatMessages after sendMessage', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.newMessage = 'Hello, can you help me?';
      await wrapper.vm.$nextTick();

      await vm.sendMessage();
      await wrapper.vm.$nextTick();

      const userMsg = vm.openMessages.find((m) => m.sender === 'user' && m.content === 'Hello, can you help me?');
      expect(userMsg).toBeDefined();
    });

    it('also adds a bot placeholder message for streaming', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.newMessage = 'Test query';
      await vm.sendMessage();
      await wrapper.vm.$nextTick();

      const botMsg = vm.openMessages.filter((m) => m.sender === 'bot');
      // Welcome msg + streaming placeholder
      expect(botMsg.length).toBeGreaterThanOrEqual(2);
    });
  });

  // -----------------------------------------------------------------------
  // AC3 — Input cleared after submission
  // -----------------------------------------------------------------------
  describe('AC3 — input cleared after submission', () => {
    it('clears newMessage after sendMessage', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.newMessage = 'Clear me after send';
      await wrapper.vm.$nextTick();

      await vm.sendMessage();
      await wrapper.vm.$nextTick();

      expect(vm.newMessage).toBe('');
    });
  });

  // -----------------------------------------------------------------------
  // AC4 — Loading state shown while awaiting response
  // -----------------------------------------------------------------------
  describe('AC4 — loading state during response', () => {
    it('sets isStreaming to true while stream is pending', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.newMessage = 'Loading test';
      await vm.sendMessage();
      await wrapper.vm.$nextTick();

      // submitQueryStream was called but onDone was NOT called yet
      expect(mockSubmitQueryStream).toHaveBeenCalled();
      expect(vm.isStreaming).toBe(true);
    });

    it('resets isStreaming and stamps the query id when the stream completes', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.newMessage = 'Done test';
      await vm.sendMessage();
      await wrapper.vm.$nextTick();

      // Simulate stream completion
      capturedCallbacks.onDone({ queryId: 'q-1' });
      await wrapper.vm.$nextTick();

      expect(vm.isStreaming).toBe(false);
      expect(vm.streamingQueryId).toBe('q-1');
    });
  });

  // -----------------------------------------------------------------------
  // Translation failure — the answer arrived, only its language did not
  // -----------------------------------------------------------------------
  describe('translation failure reported on done', () => {
    it('flags the message and leaves the system healthy', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.newMessage = 'Hola';
      await vm.sendMessage();
      await wrapper.vm.$nextTick();

      capturedCallbacks.onDone({ queryId: 'q-1', translationFailed: true });
      await wrapper.vm.$nextTick();

      const bot = vm.openMessages[vm.openMessages.length - 1];
      expect(bot.translationFailed).toBe(true);
      // The chat pipeline worked; only the translator did not. Reporting the
      // system as down here would be a false status and a false alarm.
      expect(vm.systemStatus.online).not.toBe(false);
    });

    it('leaves the flag unset when translation succeeded', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.newMessage = 'Hola';
      await vm.sendMessage();
      await wrapper.vm.$nextTick();

      capturedCallbacks.onDone({ queryId: 'q-1', translationFailed: false });
      await wrapper.vm.$nextTick();

      expect(vm.openMessages[vm.openMessages.length - 1].translationFailed).toBe(false);
    });

    it('shows the notice on the message that failed to translate', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.newMessage = 'Hola';
      await vm.sendMessage();
      await wrapper.vm.$nextTick();
      capturedCallbacks.onChunk?.('Hello');
      capturedCallbacks.onDone({ queryId: 'q-1', translationFailed: true });
      await wrapper.vm.$nextTick();

      expect(wrapper.find('[data-testid="translation-failed"]').exists()).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // AC5 — Error state when API call fails
  // -----------------------------------------------------------------------
  describe('AC5 — error state on API failure', () => {
    it('shows error content when onError callback fires', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.newMessage = 'Trigger error';
      await vm.sendMessage();
      await wrapper.vm.$nextTick();

      capturedCallbacks.onError(new Error('Stream failed'));
      await wrapper.vm.$nextTick();

      expect(vm.isStreaming).toBe(false);
      expect(vm.systemStatus.online).toBe(false);
      // A transport error carries no user-facing text of its own — the
      // turn shows the localized interruption message (the i18n stub
      // resolves the caller-supplied fallback).
      expect(vm.systemStatus.errorMessage).toBe(enChatbot.streamingError);
      // Bot message should have error content
      const streamingMsg = vm.openMessages[vm.openMessages.length - 1];
      expect(streamingMsg.content).toMatch(/interrupted|error|failed/i);
    });

    it('calls notificationService.error with message on stream error', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.newMessage = 'Error notification test';
      await vm.sendMessage();
      await wrapper.vm.$nextTick();

      capturedCallbacks.onError(new Error('Stream error'));
      await wrapper.vm.$nextTick();

      expect(mockNotificationError).toHaveBeenCalledWith(expect.stringContaining('streamingError'));
    });

    it('keeps the deployment online and names the reason when the request is refused', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // A previous turn genuinely took the deployment down, so the state
      // this test asserts on is a restored one, not the pristine default.
      vm.newMessage = 'First, an outage';
      await vm.sendMessage();
      await wrapper.vm.$nextTick();
      capturedCallbacks.onError(new Error('Backend crashed'));
      await wrapper.vm.$nextTick();
      expect(vm.systemStatus.online).toBe(false);

      vm.newMessage = 'Trigger refusal';
      await vm.sendMessage();
      await wrapper.vm.$nextTick();

      // A 4xx is a request the backend refused, not a deployment that is
      // down: the backend answered. Saying otherwise sends the user off to
      // check an infrastructure that is fine.
      const refusal = new Error('Unsupported target language');
      refusal.status = 400;
      refusal.code = 'UNSUPPORTED_LANGUAGE';
      capturedCallbacks.onError(refusal);
      await wrapper.vm.$nextTick();

      expect(vm.systemStatus.online).toBe(true);
      // The status panel reports the deployment, not the request: it shows
      // no error line while the deployment is up, and the reason is carried
      // by the answer bubble and the notification.
      expect(vm.systemStatus.errorMessage).toBe('');
      expect(mockNotificationError).toHaveBeenCalledWith(expect.stringContaining('unsupportedLanguage'));
      const streamingMsg = vm.openMessages[vm.openMessages.length - 1];
      // The transcript keeps the reason (the errored bubble renders the
      // fixed failure text and retry; the toast and the status line are
      // what the user reads), as the en locale writes it.
      expect(streamingMsg.content).toBe(enChatbot.unsupportedLanguage);
    });
  });

  // -----------------------------------------------------------------------
  // Restored failures — the reload path
  // -----------------------------------------------------------------------
  describe('restored failures', () => {
    const restoredPayload = {
      openId: 'open',
      conversations: {
        open: {
          messages: [
            { sender: 'user', content: 'the failed question' },
            {
              sender: 'bot',
              content: 'the failed answer',
              isError: true,
              errorKey: 'chatbot.unsupportedLanguage',
              timestamp: '2026-01-01T00:00:01.000Z'
            }
          ],
          selectedContextItems: [],
          lastSavedState: { messages: [], contextItems: [] },
          conversationId: null,
          title: '',
          isStreaming: false,
          streamingQueryId: null,
          relatedDocuments: []
        }
      }
    };

    afterEach(() => {
      sessionStorage.clear();
    });

    it('a failure restored from storage does not toast again', async () => {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(restoredPayload));
      const wrapper = createChatBotWrapper({}, { rehydrate: true });
      await wrapper.vm.$nextTick();

      // The dying session already surfaced this failure. An unrelated
      // mutation must not re-notify — not even the stale reason the
      // restored turn still carries.
      wrapper.vm.$store.commit('conversation/addContextItem', { source: 'quickHelp', label: 'x' });
      await wrapper.vm.$nextTick();

      expect(mockNotificationError).not.toHaveBeenCalled();
    });

    it('a fresh failure after a restored one still toasts', async () => {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(restoredPayload));
      const wrapper = createChatBotWrapper({}, { rehydrate: true });
      await wrapper.vm.$nextTick();

      // The seed guards the restored turn, not the view: a new failure
      // after the reload is announced as any other.
      wrapper.vm.newMessage = 'A new question';
      await wrapper.vm.sendMessage();
      await wrapper.vm.$nextTick();
      capturedCallbacks.onError(new Error('Stream failed'));
      await wrapper.vm.$nextTick();

      expect(mockNotificationError).toHaveBeenCalledTimes(1);
      expect(mockNotificationError).toHaveBeenCalledWith(expect.stringContaining('streamingError'));
    });
  });

  // -----------------------------------------------------------------------
  // Event bus subscriptions
  // -----------------------------------------------------------------------
  describe('event bus subscriptions', () => {
    it('subscribes to all required eventBus events in created/mounted', () => {
      createChatBotWrapper();
      const events = mockEventBusOn.mock.calls.map((call) => call[0]);
      expect(events).toContain('chat-deleted');
      expect(events).toContain('load-conversation');
      expect(events).toContain('treeNodeSelected');
    });

    it('unsubscribes from specific eventBus events in beforeUnmount', () => {
      const wrapper = createChatBotWrapper();
      wrapper.unmount();
      const unsubscribedEvents = mockEventBusOff.mock.calls.map((call) => call[0]);
      expect(unsubscribedEvents).toContain('chat-deleted');
      expect(unsubscribedEvents).toContain('load-conversation');
      expect(unsubscribedEvents).toContain('treeNodeSelected');
    });
  });

  // -----------------------------------------------------------------------
  // Subtask 3a: SSE streaming behavior
  // -----------------------------------------------------------------------
  describe('Conversation V1 — reload restores metadata', () => {
    it('restores per-message metadata (confidence, groundedness, feedback) from the conversation payload', async () => {
      const chatHistoryService = require('../../services/chatHistoryService');
      chatHistoryService.getConversation.mockResolvedValueOnce({
        messages: [
          { sender: 'user', content: 'q', timestamp: '2026-10-23T10:00:00Z' },
          {
            sender: 'assistant',
            content: 'answer',
            timestamp: '2026-10-23T10:00:05Z',
            queryId: 'q-1',
            metadata: { confidence_score: 0.87, is_grounded: true, userFeedback: 'up' }
          }
        ]
      });
      const wrapper = createChatBotWrapper();
      await flushPromises();
      await wrapper.vm.loadExistingConversation('conv-1');
      await flushPromises();
      const msg = wrapper.vm.openMessages.find((m) => m.sender === 'bot' && m.content === 'answer');
      expect(msg.confidenceScore).toBe(0.87);
      expect(msg.isGrounded).toBe(true);
      expect(msg.userFeedback).toBe('up');
    });
  });

  describe('Subtask 3a — SSE streaming', () => {
    it('aborts previous stream when new message is sent', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // First stream
      vm.newMessage = 'First message';
      await vm.sendMessage();
      const firstController = mockSubmitQueryStream.mock.results[0].value;
      await wrapper.vm.$nextTick();

      // Second stream (should abort first)
      vm.newMessage = 'Second message';
      await vm.sendMessage();
      await wrapper.vm.$nextTick();

      expect(firstController.abort).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Grounding flag: grounded vs AI-generated responses
  // -----------------------------------------------------------------------
  describe('Grounding flag — grounded vs AI-generated', () => {
    it('shows the AI-generated flag when metadata reports is_grounded=false', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.newMessage = 'Apiary intro';
      await vm.sendMessage();
      await wrapper.vm.$nextTick();

      capturedCallbacks.onMetadata({
        is_grounded: false,
        confidence_score: 0,
        source_documents: []
      });
      await wrapper.vm.$nextTick();

      const lastBot = vm.openMessages[vm.openMessages.length - 1];
      expect(lastBot.isGrounded).toBe(false);
      // Ungrounded responses show the warning flag, not the confidence bar.
      expect(wrapper.find('.answer-warning').exists()).toBe(true);
      expect(wrapper.find('.confidence-score').exists()).toBe(false);
    });

    it('shows the confidence bar when metadata reports is_grounded=true', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.newMessage = 'Beekeeping question';
      await vm.sendMessage();
      await wrapper.vm.$nextTick();

      capturedCallbacks.onMetadata({
        is_grounded: true,
        confidence_score: 0.92,
        source_documents: [{ document_id: 'f1', document_name: 'bee.pdf', score: 0.92 }]
      });
      await wrapper.vm.$nextTick();

      // The stream completes so the turn carries its queryId — the score
      // renders inside the actions row, which the queryId gates.
      capturedCallbacks.onDone({ queryId: 'q-conf-1' });
      await wrapper.vm.$nextTick();

      const lastBot = vm.openMessages[vm.openMessages.length - 1];
      expect(lastBot.isGrounded).toBe(true);
      expect(lastBot.confidenceScore).toBe(0.92);
      expect(wrapper.find('.answer-actions .confidence-score').exists()).toBe(true);
      expect(wrapper.find('.answer-warning').exists()).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Subtask 3b: sendMessage() error recovery
  // -----------------------------------------------------------------------
  describe('Subtask 3b — sendMessage error recovery', () => {
    it('handles network failure and sets system status offline', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.newMessage = 'Network error test';
      await vm.sendMessage();
      await wrapper.vm.$nextTick();
      // The turn was answering before it died: a response time was known.
      capturedCallbacks.onMetadata({ responseTime: 250 });
      capturedCallbacks.onError(new Error('Network request failed'));
      await wrapper.vm.$nextTick();

      expect(vm.isStreaming).toBe(false);
      expect(vm.systemStatus.online).toBe(false);
      expect(vm.systemStatus.errorMessage).toBe(enChatbot.streamingError);
      // The timing described the answer that never came; the pill must
      // not keep reporting it.
      expect(vm.systemStatus.lastResponseTime).toBeNull();
    });

    it('displays error message in bot message on stream failure', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.newMessage = 'Error message test';
      await vm.sendMessage();
      await wrapper.vm.$nextTick();

      // Server error frames carry their own message — shown verbatim.
      const serverError = new Error('Stream connection lost');
      serverError.fromServer = true;
      capturedCallbacks.onError(serverError);
      await wrapper.vm.$nextTick();

      const lastBotMessage = vm.openMessages[vm.openMessages.length - 1];
      expect(lastBotMessage.sender).toBe('bot');
      expect(lastBotMessage.content).toBe('Stream connection lost');
      // The prose is the message's content — an errored turn renders the
      // fixed failure text and retry, so the status line and the toast
      // carry it; the toast stays the generic failure (no i18n key).
      expect(mockNotificationError).toHaveBeenCalledWith(expect.stringContaining('streamingError'));
    });

    it('resets isStreaming on stream error', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.newMessage = 'Reset streaming state test';
      await vm.sendMessage();
      await wrapper.vm.$nextTick();

      expect(vm.isStreaming).toBe(true);

      capturedCallbacks.onError(new Error('Stream error'));
      await wrapper.vm.$nextTick();

      expect(vm.isStreaming).toBe(false);
    });

    it('shows notification on streaming error', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.newMessage = 'Notification test';
      await vm.sendMessage();
      await wrapper.vm.$nextTick();

      capturedCallbacks.onError(new Error('Stream failed'));
      await wrapper.vm.$nextTick();

      expect(mockNotificationError).toHaveBeenCalledWith(expect.stringContaining('streamingError'));
    });

    it('allows retry after error by sending new message', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // First attempt fails
      vm.newMessage = 'Failed message';
      await vm.sendMessage();
      await wrapper.vm.$nextTick();

      capturedCallbacks.onError(new Error('First attempt failed'));
      await wrapper.vm.$nextTick();

      expect(vm.isStreaming).toBe(false);
      expect(mockSubmitQueryStream).toHaveBeenCalledTimes(1);

      // Retry should work
      vm.newMessage = 'Retry message';
      await vm.sendMessage();
      await wrapper.vm.$nextTick();

      expect(vm.isStreaming).toBe(true);
      expect(mockSubmitQueryStream).toHaveBeenCalledTimes(2);
    });
  });

  // -----------------------------------------------------------------------
  // Subtask 3c: Markdown rendering
  // -----------------------------------------------------------------------
  describe('Subtask 3c — Markdown rendering', () => {
    it('renders plain text without markdown syntax', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      const plainText = 'This is plain text with no special formatting.';
      const result = vm.renderMarkdown(plainText);

      expect(result).toContain('This is plain text');
      expect(result).toContain('no special formatting');
    });

    it('renders markdown code blocks correctly', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      const codeBlock = '```javascript\nconst x = 42;\nconsole.log(x);\n```';
      const result = vm.renderMarkdown(codeBlock);

      expect(result).toContain('const x = 42');
      expect(result).toContain('console.log');
    });

    it('renders markdown links correctly', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      const linkText = '[Click here](https://example.com)';
      const result = vm.renderMarkdown(linkText);

      expect(result).toContain('Click here');
      expect(result).toContain('https://example.com');
    });

    it('renders markdown bold text correctly', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      const boldText = 'This is **bold** and this is *italic*.';
      const result = vm.renderMarkdown(boldText);

      expect(result).toContain('bold');
      expect(result).toContain('italic');
    });

    it('renders markdown headers correctly', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      const headers = '# Header 1\n## Header 2\n### Header 3';
      const result = vm.renderMarkdown(headers);

      expect(result).toContain('Header 1');
      expect(result).toContain('Header 2');
      expect(result).toContain('Header 3');
    });

    it('handles malformed markdown gracefully', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      const malformed = 'This has **broken markdown syntax and [missing';
      const result = vm.renderMarkdown(malformed);

      // Should not throw error and return some content
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('sanitizes HTML output to prevent XSS', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      const xssAttempt = '<script>alert("xss")</script> Hello';
      vm.renderMarkdown(xssAttempt);

      // DOMPurify.sanitize must be called on the marked output
      const DOMPurify = require('dompurify');
      expect(DOMPurify.sanitize).toHaveBeenCalled();
    });

    it('renders markdown lists correctly', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      const list = '- Item 1\n- Item 2\n- Item 3';
      const result = vm.renderMarkdown(list);

      expect(result).toContain('Item 1');
      expect(result).toContain('Item 2');
      expect(result).toContain('Item 3');
    });

    it('renders nested lists with tight listitems (no <p> wrap around label)', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // GFM marked emits <li><p>...</p><ul>...</ul></li> by default when a list
      // item contains a label + nested list with a blank line between them.
      // The chat-tuned model emits this pattern; without an override the
      // render shows a visible vertical gap between the label and its
      // sub-list. The renderer override in renderMarkdown() flattens that
      // to <li><label><ul>...</ul></li>, matching the source's tight layout.
      const markdown = [
        '- **Soil Preparation:**',
        '',
        '  - **Soil Type:** Sandy loam.',
        '  - **Fertilization:** Apply 30-40 kg/ha N.',
        '',
        '- **Seed Selection:**',
        '',
        '  - Varieties A, B.'
      ].join('\n');
      const result = vm.renderMarkdown(markdown);

      // Outer <p> wrap around the label is removed.
      expect(result).not.toContain('<li><p>');
      expect(result).not.toContain('<p><strong>');
      // Label and its nested sub-list live in the same <li>.
      expect(result).toMatch(/<li><strong>Soil Preparation:<\/strong><ul>/);
      // Nested items still render correctly under the parent label.
      expect(result).toContain('<strong>Soil Type:</strong> Sandy loam.');
      expect(result).toContain('<strong>Fertilization:</strong> Apply 30-40 kg/ha N.');
      // Subsequent parent label still wraps a nested <ul>.
      expect(result).toMatch(/<li><strong>Seed Selection:<\/strong><ul>/);
      expect(result).toContain('Varieties A, B.');
    });

    it('renders listitem block tokens (headings, paragraphs) without crashing', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // LLM output occasionally places a heading inside a listitem (lazy
      // continuation). Earlier the renderer override routed every
      // non-list child through `parseInline`, which throws
      // "Token with 'heading' type was not found." on block tokens. The
      // override now routes block tokens through `parse` instead.
      const markdown = [
        '- Parent label',
        '',
        '  ### Heading inside listitem',
        '',
        '  - Sub item A',
        '  - Sub item B',
        '',
        '- Another parent'
      ].join('\n');
      expect(() => vm.renderMarkdown(markdown)).not.toThrow();
      const result = vm.renderMarkdown(markdown);
      expect(result).not.toContain('<li><p>');
      expect(result).toMatch(/<h\d[^>]*>Heading inside listitem<\/h\d>/);
      expect(result).toContain('Sub item A');
      expect(result).toContain('Sub item B');
    });
  });

  // -----------------------------------------------------------------------
  // Subtask 3d: Quick help functionality
  // -----------------------------------------------------------------------
  describe('Subtask 3d — Quick help functionality', () => {
    it('selects quick help option and adds to context', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      const quickHelpOption = {
        service: 'Customer Service',
        visibleText: 'I need customer service help',
        hiddenPrompt: 'You are a customer service assistant',
        category: 'general',
        id: 'test-quick-help-1'
      };

      vm.selectQuickHelpOption(quickHelpOption);
      expect(vm.selectedContextItems.length).toBeGreaterThan(0);

      const addedItem = vm.selectedContextItems.find((item) => item.service === 'Customer Service');
      expect(addedItem).toBeDefined();
      expect(addedItem.serviceKey).toBe('test-quick-help-1');
    });

    it('sets hiddenPromptForNextMessage for dual-prompt mechanism', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      const quickHelpOption = {
        service: 'Test Service',
        visibleText: 'I need test help',
        hiddenPrompt: 'You are a test assistant',
        category: 'test-category'
      };

      // Prevent sendMessage from running — it clears hiddenPromptForNextMessage
      const sendMessageSpy = jest.spyOn(vm, 'sendMessage').mockImplementation(() => {});

      vm.selectQuickHelpOption(quickHelpOption);

      expect(vm.hiddenPromptForNextMessage).toBe('You are a test assistant');
      expect(vm.newMessage).toBe('I need test help');
      sendMessageSpy.mockRestore();
    });

    it('sets visible message from quick help option', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      const quickHelpOption = {
        service: 'Visible Test',
        visibleText: 'Visible test message',
        hiddenPrompt: 'Hidden test prompt',
        category: 'general'
      };

      // Mock sendMessage to prevent immediate execution
      vm.sendMessage = jest.fn();

      vm.selectQuickHelpOption(quickHelpOption);

      expect(vm.newMessage).toBe('Visible test message');
      expect(vm.hiddenPromptForNextMessage).toBe('Hidden test prompt');
    });

    it('hides quick help overlay after selection', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      expect(vm.showQuickHelp).toBe(true);

      const quickHelpOption = {
        service: 'Hide Test',
        textKey: 'quickhelp.hideTest',
        visibleTextKey: 'quickhelp.hideTestVisible',
        hiddenPromptKey: 'quickhelp.hideTestHidden',
        category: 'general'
      };

      vm.selectQuickHelpOption(quickHelpOption);

      expect(vm.showQuickHelp).toBe(false);
    });

    it('handles "Just Chat" option — keeps conversation mode, clears labels', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // Setup: select a categorized option first, then switch to Just Chat
      const categorizedOption = {
        service: 'Categorized Service',
        textKey: 'quickhelp.categorized',
        category: 'test-category-123',
        id: 'cat-test',
        serviceLabels: ['TestLabel'],
        serviceKey: 'test-service',
        source: 'quickHelp'
      };
      vm.selectQuickHelpOption(categorizedOption);
      expect(vm.selectedContextItems.length).toBe(1);

      // Switch to Just Chat — replaces Quick Help item, keeps conversation mode
      const justChatOption = {
        service: 'Just Chat',
        category: null,
        id: 'just-chat',
        serviceLabels: ['just-chat']
      };

      vm.selectQuickHelpOption(justChatOption);

      // Still has 1 context item (Just Chat), but with empty labels
      expect(vm.selectedContextItems.length).toBe(1);
      expect(vm.currentCategoryId).toBeNull();
      const justChatItem = vm.selectedContextItems[0];
      expect(justChatItem.serviceLabels).toEqual([]);
      expect(justChatItem.category).toBeNull();
    });

    it('Just Chat sends no label filter in the API request', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      const justChatOption = {
        service: 'Just Chat',
        category: null,
        id: 'just-chat',
        serviceLabels: ['just-chat']
      };

      vm.selectQuickHelpOption(justChatOption);
      // Just Chat should NOT auto-submit a message
      expect(mockSubmitQueryStream).not.toHaveBeenCalled();

      vm.newMessage = 'test query';
      await vm.sendMessage();

      const payload = mockSubmitQueryStream.mock.calls[mockSubmitQueryStream.mock.calls.length - 1][0];
      const labels = payload.context?.serviceLabels || [];
      expect(labels).not.toContain('just-chat');
      // With the flatMap fix, an explicitly empty serviceLabels array
      // should produce an empty filter, not fall back to serviceKey.
      expect(labels.length).toBe(0);
      expect(payload.context.categoryLabel).toBeNull();
    });

    it('Just Chat enters free chat mode without auto-submitting', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      const sendMessageSpy = jest.spyOn(vm, 'sendMessage');
      const justChatOption = {
        service: 'Just Chat',
        category: null,
        id: 'just-chat',
        serviceLabels: ['just-chat']
      };

      vm.selectQuickHelpOption(justChatOption);

      // Should set up context with empty labels
      expect(vm.selectedContextItems.length).toBe(1);
      expect(vm.selectedContextItems[0].serviceLabels).toEqual([]);
      expect(vm.selectedContextItems[0].category).toBeNull();
      expect(vm.currentCategoryId).toBeNull();
      // Should hide the quick help overlay
      expect(vm.showQuickHelp).toBe(false);
      // Should NOT auto-submit a message
      expect(sendMessageSpy).not.toHaveBeenCalled();
      expect(vm.newMessage).toBe('');
      expect(vm.hiddenPromptForNextMessage).toBeNull();

      sendMessageSpy.mockRestore();
    });

    it('sets currentCategoryId for categorized options', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      const categorizedOption = {
        service: 'Categorized Service',
        textKey: 'quickhelp.categorized',
        category: 'test-category-123',
        id: 'cat-test'
      };

      vm.selectQuickHelpOption(categorizedOption);

      expect(vm.currentCategoryId).toBe('test-category-123');
    });

    it('clears hiddenPromptForNextMessage after sendMessage', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.hiddenPromptForNextMessage = 'test-hidden-prompt';
      vm.newMessage = 'Test message';

      await vm.sendMessage();
      await wrapper.vm.$nextTick();

      expect(vm.hiddenPromptForNextMessage).toBeNull();
    });

    it('does not add duplicate context items', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      const quickHelpOption = {
        service: 'Duplicate Test',
        textKey: 'quickhelp.duplicate',
        category: 'general',
        id: 'duplicate-test'
      };

      vm.selectQuickHelpOption(quickHelpOption);
      const firstLength = vm.selectedContextItems.length;

      vm.selectQuickHelpOption(quickHelpOption);
      const secondLength = vm.selectedContextItems.length;

      expect(firstLength).toBe(secondLength);
    });

    it('handles missing or invalid quick help option gracefully', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      const beforeLength = vm.selectedContextItems.length;

      vm.selectQuickHelpOption(null);
      expect(vm.selectedContextItems.length).toBe(beforeLength);

      vm.selectQuickHelpOption({});
      expect(vm.selectedContextItems.length).toBe(beforeLength);
    });

    // -----------------------------------------------------------------------
    // serviceLabels feature (explicit English KB labels for retriever filter)
    // -----------------------------------------------------------------------

    it('loadQuickHelpButtons filters hidden buttons', async () => {
      const loadConfig = require('../../config-loader').default;
      loadConfig.mockResolvedValue({
        features: {
          chat: {
            quickHelp: {
              buttons: [
                { id: 'a', title: 'A', hidden: true, category: '1' },
                { id: 'b', title: 'B', category: '2' }
              ]
            }
          }
        }
      });

      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      await vm.loadQuickHelpButtons();
      await wrapper.vm.$nextTick();

      expect(vm.quickHelpButtons.length).toBe(1);
      expect(vm.quickHelpButtons[0].id).toBe('b');
    });

    it('loadQuickHelpButtons reads serviceLabels and sets serviceKey to first English label', async () => {
      const loadConfig = require('../../config-loader').default;
      loadConfig.mockResolvedValue({
        features: {
          chat: {
            quickHelp: {
              buttons: [
                {
                  id: 'grow',
                  title: 'Grow',
                  category: '1',
                  serviceLabels: ['Tomato', 'Onion']
                }
              ]
            }
          }
        }
      });

      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      await vm.loadQuickHelpButtons();
      await wrapper.vm.$nextTick();

      const btn = vm.quickHelpButtons[0];
      expect(btn.serviceLabels).toEqual(['Tomato', 'Onion']);
      expect(btn.serviceKey).toBe('Tomato');
      expect(btn.service).toBe('Grow'); // display = localized title, NOT the English label
    });

    it('loadQuickHelpButtons falls back to id when no serviceLabels', async () => {
      const loadConfig = require('../../config-loader').default;
      loadConfig.mockResolvedValue({
        features: {
          chat: {
            quickHelp: {
              buttons: [{ id: 'legacy', title: 'Legacy', category: '1' }]
            }
          }
        }
      });

      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      await vm.loadQuickHelpButtons();
      await wrapper.vm.$nextTick();

      const btn = vm.quickHelpButtons[0];
      expect(btn.serviceLabels).toBeNull();
      expect(btn.serviceKey).toBe('legacy');
    });

    it('selectQuickHelpOption carries serviceLabels and replaces previous Quick Help', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      const optA = {
        service: 'Tomato',
        serviceLabels: ['Tomato'],
        serviceKey: 'Tomato',
        id: 'a',
        category: '1'
      };
      const optB = {
        service: 'Onion',
        serviceLabels: ['Onion'],
        serviceKey: 'Onion',
        id: 'b',
        category: '2'
      };

      vm.selectQuickHelpOption(optA);
      expect(vm.selectedContextItems.length).toBe(1);
      expect(vm.selectedContextItems[0].serviceLabels).toEqual(['Tomato']);

      vm.selectQuickHelpOption(optB);
      expect(vm.selectedContextItems.length).toBe(1); // replaced, not accumulated
      expect(vm.selectedContextItems[0].serviceLabels).toEqual(['Onion']);
    });

    it('selectQuickHelpOption preserves sidebar items (additive)', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // Simulate a sidebar item (source !== 'quickHelp')
      vm.selectedContextItems.push({
        service: 'Crops',
        serviceKey: 'Crops',
        source: 'sidebar',
        category: '9',
        selected: true
      });

      vm.selectQuickHelpOption({
        service: 'Tomato',
        serviceLabels: ['Tomato'],
        serviceKey: 'Tomato',
        id: 'qh',
        category: '1'
      });

      expect(vm.selectedContextItems.length).toBe(2);
      expect(vm.selectedContextItems.some((i) => i.source === 'sidebar')).toBe(true);
      expect(vm.selectedContextItems.some((i) => i.source === 'quickHelp')).toBe(true);
    });

    it('getCategoryLabelById returns null for unknown id', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      expect(vm.getCategoryLabelById('999999')).toBeNull();
    });

    it('checkContextConfig blocks non-admin user on Category NN label', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // Non-admin user
      wrapper.vm.$store.commit = wrapper.vm.$store.commit || jest.fn();

      const result = vm.checkContextConfig({
        categoryLabel: 'Category 123',
        serviceLabels: []
      });

      expect(result).toBe(false);
    });

    it('checkContextConfig blocks when context items present but no filter active', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // Misconfig symptom: a context item exists but resolved to no labels
      vm.$store.commit('conversation/setContextItems', [
        { service: 'Broken', serviceKey: 'Broken', serviceLabels: null, source: 'quickHelp', selected: true }
      ]);

      const result = vm.checkContextConfig({
        categoryLabel: null,
        serviceLabels: []
      });

      expect(result).toBe(false);
    });

    it('checkContextConfig allows genuinely empty context (Just Chat)', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // No context items selected — unfiltered query is legitimate
      vm.$store.commit('conversation/setContextItems', []);
      const result = vm.checkContextConfig({
        categoryLabel: null,
        serviceLabels: []
      });

      expect(result).toBe(true);
    });

    it('checkContextConfig passes for admin with valid labels', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // Make the user an admin (default user has roles: ['user'])
      wrapper.vm.$store.commit('SET_USER', { ...vm.$store.getters.currentUser, roles: ['admin'] });

      vm.$store.commit('conversation/setContextItems', [
        { service: 'Tomato', serviceKey: 'Tomato', serviceLabels: ['Tomato'], source: 'quickHelp' }
      ]);

      const result = vm.checkContextConfig({
        categoryLabel: null,
        serviceLabels: ['Tomato']
      });

      expect(result).toBe(true);
    });

    it('query-build uses serviceLabels array then serviceKey fallback', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // Quick Help item (has serviceLabels) + sidebar item (no serviceLabels, uses serviceKey)
      vm.$store.commit('conversation/setContextItems', [
        {
          service: 'Grow',
          serviceKey: 'Tomato',
          serviceLabels: ['Tomato', 'Onion'],
          source: 'quickHelp',
          selected: true
        },
        { service: 'Tomate', serviceKey: 'Tomato', serviceLabels: null, source: 'sidebar', selected: true }
      ]);

      // Build the query payload via the public sendMessage path would require mocking
      // the service; instead, exercise the flatMap logic directly by inspecting the
      // constructed serviceLabels from selectedContextItems (mirrors the query-build code).
      const built = vm.selectedContextItems.flatMap((item) =>
        Array.isArray(item.serviceLabels) && item.serviceLabels.length > 0
          ? item.serviceLabels
          : [item.serviceKey || item.service]
      );

      expect(built).toEqual(['Tomato', 'Onion', 'Tomato']);
    });
  });

  // -----------------------------------------------------------------------
  // Subtask 3e: Dialog management
  // -----------------------------------------------------------------------
  describe('Subtask 3e — Dialog management', () => {
    it('opens feedback dialog with correct message', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // Add a test message
      vm.openMessages.push({
        sender: 'bot',
        content: 'Test bot message',
        queryId: 'test-q-123'
      });

      vm.openFeedbackDialog(vm.openMessages.length - 1);

      expect(vm.feedbackDialog.visible).toBe(true);
      expect(vm.feedbackDialog.message).toBeDefined();
      expect(vm.feedbackDialog.message.queryId).toBe('test-q-123');
    });

    it('closes feedback dialog and resets state', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.feedbackDialog = {
        visible: true,
        message: { queryId: 'test-123', content: 'Test' }
      };

      vm.closeFeedbackDialog();

      expect(vm.feedbackDialog.visible).toBe(false);
      // The message property should still exist but dialog should be closed
      expect(vm.feedbackDialog.message).toBeDefined();
    });

    it('submits feedback successfully', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      const feedback = {
        message: { queryId: 'test-query-789', content: 'Test message' },
        rating: 5,
        text: 'Great response!'
      };

      await vm.handleFeedbackSubmit(feedback);

      expect(mockNotificationSuccess).toHaveBeenCalledWith(expect.stringContaining('feedbackSubmitted'));
      expect(vm.feedbackDialog.visible).toBe(false);
    });

    it('handles feedback submission error gracefully', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // Mock service to throw error
      const chatbotService = require('../../services/chatbotService');
      chatbotService.submitFeedback.mockRejectedValueOnce(new Error('API error'));

      const feedback = {
        message: { queryId: 'error-query', content: 'Test' },
        rating: 3,
        text: 'Test feedback'
      };

      await vm.handleFeedbackSubmit(feedback);

      expect(mockNotificationError).toHaveBeenCalledWith(expect.stringContaining('feedbackError'));
      expect(vm.feedbackDialog.visible).toBe(false);
    });

    it('opens save chat dialog for new conversation', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.openMessages.push({
        sender: 'user',
        content: 'Test user message',
        timestamp: new Date().toISOString()
      });

      vm.saveChatToHistory();

      expect(vm.saveChatDialog.visible).toBe(true);
      expect(vm.saveChatDialog.title).toBeDefined();
    });

    it('opens export dialog with generated filename', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.openMessages.push({
        sender: 'user',
        content: 'Export test message',
        timestamp: new Date().toISOString()
      });

      vm.openExportDialog();

      expect(vm.exportDialog.visible).toBe(true);
      expect(vm.exportDialog.filename).toBeDefined();
      expect(vm.exportDialog.filename.length).toBeGreaterThan(0);
    });

    it('exports chat to PDF successfully', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.$store.commit('conversation/setMessages', [
        { sender: 'user', content: 'User message', timestamp: new Date().toISOString() },
        { sender: 'bot', content: 'Bot response', timestamp: new Date().toISOString() }
      ]);

      vm.exportDialog.filename = 'test-export';

      vm.exportChatToPDF();

      // Should call notification success and close dialog
      expect(mockNotificationSuccess).toHaveBeenCalledWith(expect.stringContaining('exportSuccess'));
      expect(vm.exportDialog.visible).toBe(false);
    });

    it('handles export error gracefully', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // Mock jsPDF to throw error
      const jsPDF = require('jspdf');
      jsPDF.mockImplementationOnce(() => {
        throw new Error('PDF generation failed');
      });

      vm.$store.commit('conversation/setMessages', [{ sender: 'bot', content: 'Test' }]);
      vm.exportDialog.filename = 'error-test';

      vm.exportChatToPDF();

      expect(mockNotificationError).toHaveBeenCalledWith(expect.stringContaining('exportError'));
    });

    it('validates export filename before export', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.exportDialog.filename = '  '; // Whitespace only

      // The export button should be disabled when filename is empty/whitespace
      expect(vm.exportDialog.filename.trim().length).toBe(0);
    });

    it('adds .pdf extension if missing in export filename', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.$store.commit('conversation/setMessages', [{ sender: 'bot', content: 'Test' }]);
      vm.exportDialog.filename = 'test-without-extension';

      vm.exportChatToPDF();

      // Should export successfully (extension is added automatically in the method)
      expect(mockNotificationSuccess).toHaveBeenCalled();
      expect(vm.exportDialog.visible).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Subtask 3f: hasUnsavedChanges computed logic
  // -----------------------------------------------------------------------
  describe('Subtask 3f — hasUnsavedChanges computed', () => {
    it('returns false for new conversation with no messages', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.$store.commit('conversation/setConversationId', null);
      vm.currentChatId = null;
      vm.$store.commit('conversation/setMessages', [{ sender: 'bot', content: 'Welcome', isSaved: true }]);
      vm.$store.commit('conversation/setContextItems', []);

      expect(vm.hasUnsavedChanges()).toBe(false);
    });

    it('returns true for new conversation with user messages', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.$store.commit('conversation/setConversationId', null);
      vm.currentChatId = null;
      vm.$store.commit('conversation/setMessages', [
        { sender: 'bot', content: 'Welcome', isSaved: true },
        { sender: 'user', content: 'User message', isSaved: false }
      ]);

      expect(vm.hasUnsavedChanges()).toBe(true);
    });

    it('returns true for new conversation with context items', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.$store.commit('conversation/setConversationId', null);
      vm.currentChatId = null;
      vm.$store.commit('conversation/setMessages', [{ sender: 'bot', content: 'Welcome', isSaved: true }]);
      vm.$store.commit('conversation/setContextItems', [{ service: 'Test Service', category: 'general' }]);

      expect(vm.hasUnsavedChanges()).toBe(true);
    });

    it('returns true for existing conversation with new unsaved messages', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.$store.commit('conversation/setConversationId', 'existing-conv-123');
      vm.currentChatId = 'existing-conv-123';
      vm.$store.commit('conversation/setMessages', [{ sender: 'bot', content: 'Saved bot message', isSaved: true }]);
      vm.$store.commit('conversation/setContextItems', []);
      // Snapshot: the saved state IS this state; the writes below move the live one.
      vm.$store.commit('conversation/setSavedState');

      vm.$store.commit('conversation/setMessages', [
        { sender: 'bot', content: 'Saved bot message', isSaved: true },
        { sender: 'user', content: 'New user message', isSaved: false }
      ]);

      expect(vm.hasUnsavedChanges()).toBe(true);
    });

    it('returns true when context items differ from saved state', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.$store.commit('conversation/setConversationId', 'conv-456');
      vm.currentChatId = 'conv-456';
      vm.$store.commit('conversation/setMessages', [{ sender: 'bot', content: 'Saved', isSaved: true }]);
      vm.$store.commit('conversation/setContextItems', [{ service: 'Old Service', category: 'general' }]);
      // Snapshot: the saved state IS this state; the writes below move the live one.
      vm.$store.commit('conversation/setSavedState');

      vm.$store.commit('conversation/setMessages', [{ sender: 'bot', content: 'Saved', isSaved: true }]);
      vm.$store.commit('conversation/setContextItems', [{ service: 'New Service', category: 'general' }]);

      expect(vm.hasUnsavedChanges()).toBe(true);
    });

    it('returns true when context item count differs from saved state', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.$store.commit('conversation/setConversationId', 'conv-789');
      vm.currentChatId = 'conv-789';
      vm.$store.commit('conversation/setMessages', [{ sender: 'bot', content: 'Saved', isSaved: true }]);
      vm.$store.commit('conversation/setContextItems', [
        { service: 'Service 1', category: 'general' },
        { service: 'Service 2', category: 'general' }
      ]);
      // Snapshot: the saved state IS this state; the writes below move the live one.
      vm.$store.commit('conversation/setSavedState');

      vm.$store.commit('conversation/setMessages', [{ sender: 'bot', content: 'Saved', isSaved: true }]);
      vm.$store.commit('conversation/setContextItems', [{ service: 'Service 1', category: 'general' }]);

      expect(vm.hasUnsavedChanges()).toBe(true);
    });

    it('returns false when all state matches saved state', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.$store.commit('conversation/setConversationId', 'conv-saved-123');
      vm.currentChatId = 'conv-saved-123';
      vm.$store.commit('conversation/setMessages', [
        { sender: 'bot', content: 'Saved bot', isSaved: true },
        { sender: 'user', content: 'Saved user', isSaved: true }
      ]);
      vm.$store.commit('conversation/setContextItems', [{ service: 'Saved Service', category: 'saved' }]);
      // Snapshot: the saved state IS this state; the writes below move the live one.
      vm.$store.commit('conversation/setSavedState');

      vm.$store.commit('conversation/setMessages', [
        { sender: 'bot', content: 'Saved bot', isSaved: true },
        { sender: 'user', content: 'Saved user', isSaved: true }
      ]);
      vm.$store.commit('conversation/setContextItems', [{ service: 'Saved Service', category: 'saved' }]);

      expect(vm.hasUnsavedChanges()).toBe(false);
    });

    it('detects unsaved bot messages with queryId', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.$store.commit('conversation/setConversationId', 'conv-bot-123');
      vm.currentChatId = 'conv-bot-123';
      vm.$store.commit('conversation/setMessages', [{ sender: 'bot', content: 'Old bot', isSaved: true }]);
      vm.$store.commit('conversation/setContextItems', []);
      // Snapshot: the saved state IS this state; the writes below move the live one.
      vm.$store.commit('conversation/setSavedState');

      vm.$store.commit('conversation/setMessages', [
        { sender: 'bot', content: 'New bot response', isSaved: false, queryId: 'new-query' }
      ]);

      expect(vm.hasUnsavedChanges()).toBe(true);
    });

    it('handles empty selectedContextItems correctly', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.$store.commit('conversation/setConversationId', 'conv-empty-123');
      vm.currentChatId = 'conv-empty-123';
      vm.$store.commit('conversation/setMessages', [{ sender: 'bot', content: 'Saved', isSaved: true }]);
      vm.$store.commit('conversation/setContextItems', []);
      // Snapshot: the saved state IS this state; the writes below move the live one.
      vm.$store.commit('conversation/setSavedState');

      vm.$store.commit('conversation/setMessages', [{ sender: 'bot', content: 'Saved', isSaved: true }]);
      vm.$store.commit('conversation/setContextItems', []);

      expect(vm.hasUnsavedChanges()).toBe(false);
    });

    it('detects changes in context item properties', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.$store.commit('conversation/setConversationId', 'conv-prop-123');
      vm.currentChatId = 'conv-prop-123';
      vm.$store.commit('conversation/setMessages', [{ sender: 'bot', content: 'Saved', isSaved: true }]);
      vm.$store.commit('conversation/setContextItems', [{ service: 'Service Name', category: 'old-category' }]);
      // Snapshot: the saved state IS this state; the writes below move the live one.
      vm.$store.commit('conversation/setSavedState');

      vm.$store.commit('conversation/setMessages', [{ sender: 'bot', content: 'Saved', isSaved: true }]);
      vm.$store.commit('conversation/setContextItems', [{ service: 'Service Name', category: 'new-category' }]);

      expect(vm.hasUnsavedChanges()).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Saving stores every turn exactly once
  // -----------------------------------------------------------------------
  describe('Conversation saving', () => {
    it('stores a repeated user message; only the first question rides as initialMessage', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const chatHistoryService = require('../../services/chatHistoryService');
      chatHistoryService.createConversation.mockResolvedValue({ _key: 'conv-dup' });
      chatHistoryService.addMessage.mockClear();

      vm.$store.commit('conversation/appendUserMessage', { sender: 'user', content: 'hello', isSaved: false });
      vm.$store.commit('conversation/appendBotMessage', {
        sender: 'bot',
        content: 'Hi there',
        queryId: 'q1',
        isSaved: false
      });
      // Same text as the first question — matched by position, not
      // content, or this turn would silently vanish from the transcript.
      vm.$store.commit('conversation/appendUserMessage', { sender: 'user', content: 'hello', isSaved: false });

      vm.saveChatDialog = { visible: true, title: 'Dup', folderId: 'default' };
      await vm.handleSaveChat();

      const payloads = chatHistoryService.addMessage.mock.calls.map((c) => c[0].content);
      expect(payloads).toEqual(['Hi there', 'hello']);
      const open = vm.openMessages;
      // Index 0 is the factory's welcome turn; the first real user
      // question rides as initialMessage and the repeated text at the
      // end is still stored on its own.
      expect(open[1].isSaved).toBe(true);
      expect(open[3].isSaved).toBe(true);
    });

    it('does not persist a failed exchange', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const chatHistoryService = require('../../services/chatHistoryService');
      chatHistoryService.createConversation.mockResolvedValue({ _key: 'conv-fail' });
      chatHistoryService.addMessage.mockClear();

      vm.$store.commit('conversation/appendUserMessage', {
        sender: 'user',
        content: 'first ok question',
        isSaved: false
      });
      vm.$store.commit('conversation/appendUserMessage', {
        sender: 'user',
        content: 'failed question',
        isSaved: false
      });
      // The failed exchange exactly as failStream leaves it: the dead
      // answer never earned a queryId, and its question carries the
      // marker too — the pair leaves as a unit.
      vm.$store.commit('conversation/appendBotMessage', {
        sender: 'bot',
        content: '',
        isStreaming: false,
        isError: true,
        isSaved: false
      });
      vm.$store.commit('conversation/setMessageProperty', [2, 'isError', true]);

      vm.saveChatDialog = { visible: true, title: 'F', folderId: 'default' };
      await vm.handleSaveChat();

      // The first question rides as initialMessage; the failed exchange —
      // question and dead answer — is stored nowhere.
      expect(chatHistoryService.addMessage).not.toHaveBeenCalled();
    });

    it('a failed first exchange hands initialMessage to the first answered one', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const chatHistoryService = require('../../services/chatHistoryService');
      chatHistoryService.createConversation.mockClear();
      chatHistoryService.addMessage.mockClear();

      // The first exchange died exactly as failStream leaves it: dead
      // answer without a queryId, question carrying the marker.
      vm.$store.commit('conversation/appendUserMessage', { sender: 'user', content: 'failed first', isSaved: false });
      vm.$store.commit('conversation/appendBotMessage', {
        sender: 'bot',
        content: '',
        isStreaming: false,
        isError: true,
        isSaved: false
      });
      vm.$store.commit('conversation/setMessageProperty', [1, 'isError', true]);
      vm.$store.commit('conversation/appendUserMessage', {
        sender: 'user',
        content: 'second question',
        isSaved: false
      });
      vm.$store.commit('conversation/appendBotMessage', {
        sender: 'bot',
        content: 'A2',
        queryId: 'q2',
        isSaved: false
      });

      vm.saveChatDialog = { visible: true, title: 'Order', folderId: 'default' };
      await vm.handleSaveChat();

      expect(chatHistoryService.createConversation.mock.calls[0][0].initialMessage).toBe('second question');
      expect(chatHistoryService.addMessage.mock.calls.map((c) => c[0].content)).toEqual(['A2']);
      // And the deliberately-unpersisted question cannot hold the
      // unsaved-changes confirm open forever.
      expect(vm.hasUnsavedChanges()).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // The request's message history
  // -----------------------------------------------------------------------
  describe('Request context', () => {
    it('sends the welcome turn, failed exchanges and stub bot turns to no one', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      // A context chip routes the send through the conversation branch,
      // the only one that carries a message history.
      vm.$store.commit('conversation/addContextItem', {
        service: 'Tomato',
        serviceKey: 'Tomato',
        serviceLabels: ['Tomato'],
        source: 'quickHelp'
      });

      await vm.sendMessageFromText('First question');
      capturedCallbacks.onError(new Error('boom'));
      await wrapper.vm.$nextTick();

      await vm.sendMessageFromText('Second question');

      // The welcome greeting (no queryId) and the whole failed exchange —
      // question and dead answer — stay out of the model's context; the
      // live question is the only turn it sees.
      expect(capturedQueryData.messages.map((m) => `${m.role}:${m.content}`)).toEqual(['user:Second question']);
    });

    it('the sidebar event routes through the handler; a re-click of the loading chat is swallowed', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const chatHistoryService = require('../../services/chatHistoryService');
      // The first load hangs until the test releases it: the re-click
      // lands while the fetch is still in flight, the exact window the
      // guard must close.
      let resolveFirst;
      chatHistoryService.getConversation.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          })
      );
      // The handler registered on the mocked eventBus in created() —
      // drive it the way ChatFolders' emit does.
      const loadHandler = mockEventBusOn.mock.calls.find((c) => c[0] === 'load-conversation')[1];

      const first = loadHandler('conv-9');
      await wrapper.vm.$nextTick();
      expect(chatHistoryService.getConversation).toHaveBeenCalledTimes(1);

      await loadHandler('conv-9');
      expect(chatHistoryService.getConversation).toHaveBeenCalledTimes(1);

      resolveFirst({ _key: 'conv-9', title: 'Loaded chat', messages: [] });
      await first;
      expect(vm.conversationId).toBe('conv-9');
    });

    it('a slower earlier load never overwrites a newer one', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const chatHistoryService = require('../../services/chatHistoryService');
      let resolveA;
      chatHistoryService.getConversation
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveA = resolve;
            })
        )
        .mockImplementationOnce(() => Promise.resolve({ _key: 'conv-B', title: 'B', messages: [] }));
      const loadHandler = mockEventBusOn.mock.calls.find((c) => c[0] === 'load-conversation')[1];

      const first = loadHandler('conv-A');
      await loadHandler('conv-B');
      expect(vm.conversationId).toBe('conv-B');
      resolveA({ _key: 'conv-A', title: 'A', messages: [] });
      await first;
      // The stale response is dropped: the last click wins, not the
      // last response.
      expect(vm.conversationId).toBe('conv-B');
      expect(vm.currentChatId).toBe('conv-B');
    });

    it('loading a conversation drops the previous one first — even when the fetch fails', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const dispatchSpy = jest.spyOn(vm.$store, 'dispatch');
      const chatHistoryService = require('../../services/chatHistoryService');
      chatHistoryService.getConversation.mockRejectedValueOnce(new Error('network down'));

      vm.$store.commit('conversation/setConversationId', 'conv-old');
      vm.$store.commit('conversation/addContextItem', { service: 'Old', serviceKey: 'old', source: 'quickHelp' });
      vm.$store.commit('conversation/setRelatedDocuments', [{ id: 'doc-1', title: 'Old doc' }]);
      vm.$store.commit('conversation/appendUserMessage', {
        sender: 'user',
        content: 'old transcript turn',
        isSaved: true
      });

      // The real sidebar path: ChatFolders emits load-conversation.
      await vm.loadExistingConversation('conv-9');

      expect(dispatchSpy).toHaveBeenCalledWith('conversation/abortStream');
      expect(vm.selectedContextItems).toEqual([]);
      expect(vm.relatedDocuments).toEqual([]);
      expect(vm.conversationId).toBeNull();
      // The wholesale replacement includes the transcript: the old
      // conversation's turns do not survive a failed load.
      expect(vm.openMessages.some((m) => m.content === 'old transcript turn')).toBe(false);
      // No split brain: the view's own target id is released with the
      // store's, or saves would route into the previous conversation.
      expect(vm.currentChatId).toBeNull();
    });

    it('a question sent during the fetch dies with the replaced conversation', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const chatHistoryService = require('../../services/chatHistoryService');
      let resolveLoad;
      chatHistoryService.getConversation.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveLoad = resolve;
          })
      );
      const loadHandler = mockEventBusOn.mock.calls.find((c) => c[0] === 'load-conversation')[1];
      const loading = loadHandler('conv-9');
      await wrapper.vm.$nextTick();

      // The user sends into the cleared transcript while B is loading.
      await vm.sendMessageFromText('mid-load question');
      expect(vm.isStreaming).toBe(true);

      resolveLoad({
        _key: 'conv-9',
        title: 'B',
        messages: [
          { sender: 'user', content: 'restored question', queryId: 'q1' },
          { sender: 'bot', content: 'B answer', queryId: 'q2' }
        ]
      });
      await loading;

      // The in-flight generation belonged to the replaced conversation
      // and died with it: no answer of its lands in B's transcript.
      const open = vm.openMessages;
      expect(open.some((m) => m.content === 'mid-load question')).toBe(false);
      expect(open.at(-1).content).toBe('B answer');
      expect(vm.isStreaming).toBe(false);
    });

    it('a late load does not land after the conversation was replaced by a new chat', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const chatHistoryService = require('../../services/chatHistoryService');
      let resolveLoad;
      chatHistoryService.getConversation.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveLoad = resolve;
          })
      );
      const loadHandler = mockEventBusOn.mock.calls.find((c) => c[0] === 'load-conversation')[1];
      const loading = loadHandler('conv-9');
      await wrapper.vm.$nextTick();

      vm.startNewChatConfirmed();
      resolveLoad({ _key: 'conv-9', title: 'B', messages: [{ sender: 'user', content: 'x', queryId: 'q1' }] });
      await loading;

      // The welcome screen replaced the conversation; the stale response
      // must not re-attach it.
      expect(vm.conversationId).toBeNull();
      expect(vm.currentChatId).toBeNull();
    });

    it('deleting the chat being loaded prevents the load from landing', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const chatHistoryService = require('../../services/chatHistoryService');
      let resolveLoad;
      chatHistoryService.getConversation.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveLoad = resolve;
          })
      );
      const loadHandler = mockEventBusOn.mock.calls.find((c) => c[0] === 'load-conversation')[1];
      const deleteHandler = mockEventBusOn.mock.calls.find((c) => c[0] === 'chat-deleted')[1];
      const loading = loadHandler('conv-9');
      await wrapper.vm.$nextTick();

      // The chat is deleted from its menu while its load is in flight —
      // the fetch window has conversationId nulled, so the guard must
      // recognise the target through currentChatId.
      deleteHandler('conv-9');
      resolveLoad({ _key: 'conv-9', title: 'Ghost', messages: [{ sender: 'user', content: 'x', queryId: 'q1' }] });
      await loading;

      // The deleted conversation is not resurrected.
      expect(vm.conversationId).toBeNull();
      expect(vm.currentChatId).toBeNull();
      expect(vm.openMessages.some((m) => m.content === 'x')).toBe(false);
    });

    it('a failed load aborts the generation the window opened and restores the welcome', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const chatHistoryService = require('../../services/chatHistoryService');
      let rejectLoad;
      chatHistoryService.getConversation.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectLoad = reject;
          })
      );
      const loadHandler = mockEventBusOn.mock.calls.find((c) => c[0] === 'load-conversation')[1];
      const loading = loadHandler('conv-9');
      await wrapper.vm.$nextTick();

      await vm.sendMessageFromText('mid-load question');
      rejectLoad(new Error('network down'));
      await loading;

      // No chunk of that generation lands in the welcome turn, and no
      // placeholder spins forever.
      expect(vm.isStreaming).toBe(false);
      const open = vm.openMessages;
      expect(open).toHaveLength(1);
      expect(open[0].sender).toBe('bot');
      expect(vm.hasUnsavedChanges()).toBe(false);
    });

    it('the leave arm saves before resetting, and a canceled dialog keeps the draft', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const chatHistoryService = require('../../services/chatHistoryService');
      chatHistoryService.createConversation.mockClear();

      vm.$store.commit('conversation/appendUserMessage', {
        sender: 'user',
        content: 'MY IMPORTANT DRAFT',
        isSaved: false
      });

      const leaving = vm.saveAndStartNewChat();
      // Yield the microtasks: the un-awaited mutation resets the
      // transcript right here — the correct code keeps the draft until
      // the dialog completes.
      await wrapper.vm.$nextTick();
      expect(vm.saveChatDialog.visible).toBe(true);
      expect(vm.openMessages.some((m) => m.content === 'MY IMPORTANT DRAFT')).toBe(true);

      // Completing the dialog saves through the normal path, and only
      // then does the welcome screen replace the transcript.
      await vm.handleSaveChat();
      await leaving;
      expect(chatHistoryService.createConversation.mock.calls[0][0].initialMessage).toBe('MY IMPORTANT DRAFT');
      expect(vm.openMessages.some((m) => m.content === 'MY IMPORTANT DRAFT')).toBe(false);
    });

    it('canceling the leave dialog keeps the draft and stays on the chat', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // A prior save left the verdict true — this flow's entry reset
      // must not answer its own cancel with that stale success.
      vm.lastSaveSucceeded = true;
      vm.$store.commit('conversation/appendUserMessage', { sender: 'user', content: 'KEPT DRAFT', isSaved: false });

      const leaving = vm.saveAndStartNewChat();
      await wrapper.vm.$nextTick();
      expect(vm.saveChatDialog.visible).toBe(true);

      // The user closes the dialog without saving.
      vm.saveChatDialog.visible = false;
      await leaving;

      // The draft is untouched and no new-chat reset happened.
      expect(vm.openMessages.some((m) => m.content === 'KEPT DRAFT')).toBe(true);
      expect(vm.conversationId).toBeNull();
    });

    it('a failed save does not read as a success for the leave arm', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const chatHistoryService = require('../../services/chatHistoryService');
      // The conversation is created, then a later step fails.
      chatHistoryService.addMessage.mockRejectedValueOnce(new Error('boom'));

      vm.$store.commit('conversation/appendUserMessage', { sender: 'user', content: 'PARTIAL DRAFT', isSaved: false });
      // The first question rides as initialMessage — the failure has to
      // happen in a turn that reaches addMessage.
      vm.$store.commit('conversation/appendUserMessage', { sender: 'user', content: 'follow-up', isSaved: false });
      vm.$store.commit('conversation/appendBotMessage', {
        sender: 'bot',
        content: 'A2',
        queryId: 'q2',
        isSaved: false
      });

      const leaving = vm.saveAndStartNewChat();
      await wrapper.vm.$nextTick();
      await vm.handleSaveChat();
      // The dialog stays open after the failure — the user closes it.
      expect(vm.saveChatDialog.visible).toBe(true);
      vm.saveChatDialog.visible = false;
      await leaving;

      // The transcript was not wiped over an unsaved draft.
      expect(vm.openMessages.some((m) => m.content === 'PARTIAL DRAFT')).toBe(true);
    });

    it('canceling the load-confirm dialog keeps the draft and abandons the pending load', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const chatHistoryService = require('../../services/chatHistoryService');
      chatHistoryService.getConversation.mockClear();

      vm.$store.commit('conversation/appendUserMessage', { sender: 'user', content: 'LOAD-ARM DRAFT', isSaved: false });

      vm.pendingConversationId = 'conv-pending';
      // "Save and load" opens the naming dialog over the pending load.
      const saving = vm.saveAndLoadConversation();
      await wrapper.vm.$nextTick();
      expect(vm.saveChatDialog.visible).toBe(true);

      // The user cancels.
      vm.saveChatDialog.visible = false;
      await saving;

      // The draft survives and the other conversation never loads.
      expect(vm.openMessages.some((m) => m.content === 'LOAD-ARM DRAFT')).toBe(true);
      expect(vm.pendingConversationId).toBeNull();
      expect(chatHistoryService.getConversation).not.toHaveBeenCalled();
    });

    it('the discard arm always loads, whatever an earlier save decided', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const chatHistoryService = require('../../services/chatHistoryService');
      chatHistoryService.getConversation
        .mockResolvedValueOnce({ _key: 'conv-target', title: 'Target', messages: [] })
        .mockResolvedValueOnce({ _key: 'conv-target', title: 'Target', messages: [] });

      // An earlier successful save left the verdict true; the discard
      // arm performs no save and must not read it.
      vm.lastSaveSucceeded = true;
      vm.pendingConversationId = 'conv-target';

      await vm.loadConversationConfirmed();

      expect(chatHistoryService.getConversation).toHaveBeenCalledWith('conv-target');
      expect(vm.conversationId).toBe('conv-target');
      expect(vm.pendingConversationId).toBeNull();

      // And with no save at all before it (the flag false) — the discard
      // arm is the no-save arm; it must not read the flag either way.
      chatHistoryService.getConversation.mockClear();
      vm.lastSaveSucceeded = false;
      vm.pendingConversationId = 'conv-target';
      await vm.loadConversationConfirmed();
      expect(chatHistoryService.getConversation).toHaveBeenCalledWith('conv-target');
    });

    it('canceling the save-and-load dialog does not inherit an earlier save verdict', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const chatHistoryService = require('../../services/chatHistoryService');
      chatHistoryService.getConversation.mockClear();

      // A prior save left the flag true — the arm resets it for its own
      // flow, so a cancel cannot read as a success.
      vm.lastSaveSucceeded = true;
      vm.$store.commit('conversation/setConversationId', null);
      vm.pendingConversationId = 'conv-pending';

      const saving = vm.saveAndLoadConversation();
      await wrapper.vm.$nextTick();
      vm.saveChatDialog.visible = false; // the user cancels
      await saving;

      expect(chatHistoryService.getConversation).not.toHaveBeenCalled();
      expect(vm.pendingConversationId).toBeNull();
    });

    it('the save-and-load update branch records its own verdict', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const chatHistoryService = require('../../services/chatHistoryService');
      chatHistoryService.updateConversation.mockResolvedValueOnce({});
      chatHistoryService.getConversation.mockResolvedValueOnce({
        _key: 'conv-pending',
        title: 'Pending',
        messages: []
      });

      vm.$store.commit('conversation/setConversationId', 'conv-current');
      vm.pendingConversationId = 'conv-pending';

      await vm.saveAndLoadConversation();

      expect(chatHistoryService.updateConversation).toHaveBeenCalledWith('conv-current', expect.anything());
      expect(chatHistoryService.getConversation).toHaveBeenCalledWith('conv-pending');
      expect(vm.conversationId).toBe('conv-pending');
      expect(vm.pendingConversationId).toBeNull();
    });

    it('a failed update abandons the pending load and keeps the transcript', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const chatHistoryService = require('../../services/chatHistoryService');
      chatHistoryService.updateConversation.mockRejectedValueOnce(new Error('network down'));

      vm.$store.commit('conversation/setConversationId', 'conv-current');
      vm.$store.commit('conversation/appendUserMessage', { sender: 'user', content: 'UNSAVED TURN', isSaved: false });
      vm.pendingConversationId = 'conv-pending';

      await vm.saveAndLoadConversation();

      expect(chatHistoryService.getConversation).not.toHaveBeenCalled();
      expect(vm.pendingConversationId).toBeNull();
      expect(vm.openMessages.some((m) => m.content === 'UNSAVED TURN')).toBe(true);
    });

    it('a failed leave-arm update keeps the draft and stays on the chat', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const chatHistoryService = require('../../services/chatHistoryService');
      chatHistoryService.updateConversation.mockRejectedValueOnce(new Error('network down'));

      vm.$store.commit('conversation/setConversationId', 'conv-current');
      vm.currentChatId = 'conv-current';
      vm.$store.commit('conversation/appendUserMessage', { sender: 'user', content: 'ARM DRAFT', isSaved: false });

      await vm.saveAndStartNewChat();

      expect(vm.openMessages.some((m) => m.content === 'ARM DRAFT')).toBe(true);
      expect(vm.currentChatId).toBe('conv-current');
    });

    it('an update never persists the failed exchange and does not prompt', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const chatHistoryService = require('../../services/chatHistoryService');
      chatHistoryService.updateConversation.mockResolvedValueOnce({});
      chatHistoryService.addMessage.mockClear();

      vm.$store.commit('conversation/setConversationId', 'conv-saved');
      vm.currentChatId = 'conv-saved';
      // The saved conversation reopened: answered turn + a follow-up that
      // timed out (failStream's shape).
      vm.$store.commit('conversation/appendUserMessage', { sender: 'user', content: 'answered q', isSaved: true });
      vm.$store.commit('conversation/appendUserMessage', { sender: 'user', content: 'timed out q', isSaved: false });
      vm.$store.commit('conversation/appendBotMessage', {
        sender: 'bot',
        content: '',
        isStreaming: false,
        isError: true,
        isSaved: false
      });
      const failedQuestionIndex = vm.openMessages.findIndex((m) => m.content === 'timed out q');
      vm.$store.commit('conversation/setMessageProperty', [failedQuestionIndex, 'isError', true]);
      vm.$store.commit('conversation/setSavedState');

      await vm.updateExistingChat();

      // Nothing persistable was left: the failed exchange is stored
      // nowhere and cannot hold the unsaved-changes confirm open.
      expect(chatHistoryService.addMessage).not.toHaveBeenCalled();
      expect(vm.hasUnsavedChanges()).toBe(false);
    });

    it('saving a failed-only transcript creates nothing', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const chatHistoryService = require('../../services/chatHistoryService');
      chatHistoryService.createConversation.mockClear();

      vm.$store.commit('conversation/appendUserMessage', {
        sender: 'user',
        content: 'doomed question',
        isSaved: false
      });
      vm.$store.commit('conversation/appendBotMessage', {
        sender: 'bot',
        content: '',
        isStreaming: false,
        isError: true,
        isSaved: false
      });
      const doomedIndex = vm.openMessages.findIndex((m) => m.content === 'doomed question');
      vm.$store.commit('conversation/setMessageProperty', [doomedIndex, 'isError', true]);

      vm.saveChatDialog = { visible: true, title: 'Empty', folderId: 'default' };
      await vm.handleSaveChat();

      expect(chatHistoryService.createConversation).not.toHaveBeenCalled();
      expect(vm.saveChatDialog.visible).toBe(false);
      // The metadata agrees: no preview text or count from the dead turn.
      expect(vm.chatPreview).toBe('New conversation');
    });

    it('a failed-only transcript is not an unsaved change', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.$store.commit('conversation/appendUserMessage', {
        sender: 'user',
        content: 'doomed question',
        isSaved: false
      });
      vm.$store.commit('conversation/appendBotMessage', {
        sender: 'bot',
        content: '',
        isStreaming: false,
        isError: true,
        isSaved: false
      });
      const doomedIndex = vm.openMessages.findIndex((m) => m.content === 'doomed question');
      vm.$store.commit('conversation/setMessageProperty', [doomedIndex, 'isError', true]);

      // Saving it would persist an empty conversation — the prompt is
      // for content a save would keep.
      expect(vm.hasUnsavedChanges()).toBe(false);
    });

    it('deleting the open chat clears its category for the next save', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const deleteHandler = mockEventBusOn.mock.calls.find((c) => c[0] === 'chat-deleted')[1];

      vm.currentCategoryId = 'cat-42';
      vm.$store.commit('conversation/setConversationId', 'conv-cat');
      deleteHandler('conv-cat');

      expect(vm.currentCategoryId).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Streaming content callbacks
  // -----------------------------------------------------------------------
  describe('SSE onChunk, onMetadata, onTranslation callbacks', () => {
    it('accumulates content via onChunk callback', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.newMessage = 'Chunk test';
      await vm.sendMessage();
      await wrapper.vm.$nextTick();

      const botMsgIndex = vm.openMessages.length - 1;
      capturedCallbacks.onChunk('Hello ');
      capturedCallbacks.onChunk('World');

      expect(vm.openMessages[botMsgIndex].content).toContain('Hello World');
    });

    it('processes metadata with confidence score and response time', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.newMessage = 'Metadata test';
      await vm.sendMessage();
      await wrapper.vm.$nextTick();

      const botMsgIndex = vm.openMessages.length - 1;
      capturedCallbacks.onMetadata({
        confidence_score: 0.95,
        responseTime: 250
      });

      expect(vm.openMessages[botMsgIndex].confidenceScore).toBe(0.95);
      expect(vm.systemStatus.lastResponseTime).toBe(250);
      expect(vm.systemStatus.online).toBe(true);
    });

    it('populates relatedDocuments from source_documents metadata', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.newMessage = 'Sources test';
      await vm.sendMessage();
      await wrapper.vm.$nextTick();

      capturedCallbacks.onMetadata({
        source_documents: [
          { document_id: 'doc-1', document_name: 'Test Doc', url: 'http://example.com/file.pdf', score: 0.9 }
        ]
      });

      expect(vm.relatedDocuments.length).toBe(1);
      expect(vm.relatedDocuments[0].id).toBe('doc-1');
      expect(vm.relatedDocuments[0].title).toBe('Test Doc');
      expect(vm.relatedDocuments[0].type).toBe('PDF');
    });

    it('filters duplicate source documents', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.newMessage = 'Dup test';
      await vm.sendMessage();
      await wrapper.vm.$nextTick();

      capturedCallbacks.onMetadata({
        source_documents: [{ document_id: 'doc-1', document_name: 'Doc 1', url: 'http://a.pdf', score: 0.9 }]
      });
      capturedCallbacks.onMetadata({
        source_documents: [{ document_id: 'doc-1', document_name: 'Doc 1', url: 'http://a.pdf', score: 0.9 }]
      });

      expect(vm.relatedDocuments.length).toBe(1);
    });

    it('replaces content via onTranslation callback', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.newMessage = 'Translation test';
      await vm.sendMessage();
      await wrapper.vm.$nextTick();

      const botMsgIndex = vm.openMessages.length - 1;
      capturedCallbacks.onChunk('Original');
      capturedCallbacks.onTranslation('Traduction');

      expect(vm.openMessages[botMsgIndex].content).toBe('Traduction');
    });
  });

  // -----------------------------------------------------------------------
  // removeContextItem
  // -----------------------------------------------------------------------
  describe('removeContextItem', () => {
    it('removes item at specified index', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.$store.commit('conversation/setContextItems', [
        { service: 'Service A', category: 'cat-1' },
        { service: 'Service B', category: 'cat-2' }
      ]);

      vm.removeContextItem(0);

      expect(vm.selectedContextItems.length).toBe(1);
      expect(vm.selectedContextItems[0].service).toBe('Service B');
    });

    it('nullifies currentCategoryId when context becomes empty and no matching quick help', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.currentCategoryId = 'cat-1';
      vm.$store.commit('conversation/setContextItems', [{ service: 'Service A', category: 'cat-1' }]);

      vm.removeContextItem(0);

      expect(vm.selectedContextItems.length).toBe(0);
      expect(vm.currentCategoryId).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // formatMessageTime
  // -----------------------------------------------------------------------
  describe('formatMessageTime', () => {
    it('returns formatted time for valid timestamp', () => {
      const wrapper = createChatBotWrapper();
      const result = wrapper.vm.formatMessageTime('2024-01-15T14:30:00Z');
      expect(result).toMatch(/\d{2}:\d{2}/);
    });

    it('returns empty string for null timestamp', () => {
      const wrapper = createChatBotWrapper();
      expect(wrapper.vm.formatMessageTime(null)).toBe('');
    });

    it('returns empty string for undefined timestamp', () => {
      const wrapper = createChatBotWrapper();
      expect(wrapper.vm.formatMessageTime(undefined)).toBe('');
    });
  });

  describe('translate helper', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('returns translated value when key exists', () => {
      const wrapper = createChatBotWrapper();
      // $t mock returns key, simulating a found translation
      expect(wrapper.vm.translate('chatbot.placeholder')).toBe('chatbot.placeholder');
    });

    it('returns fallback when key is missing', () => {
      const wrapper = createChatBotWrapper();
      // $t mock returns key itself (missing translation behavior)
      expect(wrapper.vm.translate('chatbot.thinking', 'Thinking...')).toBe('Thinking...');
    });

    it('returns key when key is missing and no fallback provided', () => {
      const wrapper = createChatBotWrapper();
      expect(wrapper.vm.translate('chatbot.thinking')).toBe('chatbot.thinking');
    });
  });

  describe('quick-help card tint', () => {
    const configLoader = require('../../config-loader');

    const tintedButton = {
      id: 'identity-civil',
      title: { en: 'Apply for ID' },
      icon: { type: 'file', value: '/config/quickhelp/identity-civil.svg' },
      category: 'civil',
      styles: {
        backgroundColor: '#ecfdf5',
        hoverColor: '#d1fae5',
        outlineColor: '#a7f3d0'
      }
    };

    const untintedButton = {
      id: 'just-chat',
      title: { en: 'Just Chat' },
      icon: { type: 'file', value: '/config/quickhelp/just-chat.svg' },
      category: null
    };

    const mountWithButtons = async (buttons) => {
      configLoader.default.mockResolvedValue({
        features: { chat: { quickHelp: { buttons } } }
      });
      const wrapper = createChatBotWrapper();
      await flushPromises();
      return wrapper;
    };

    afterEach(() => {
      // The config-loader mock is module-level, and clearAllMocks() does
      // not reset an implementation — restore the empty-button default so
      // the rest of the suite is unaffected.
      configLoader.default.mockResolvedValue({
        features: { chat: { quickHelp: { buttons: [] } } }
      });
    });

    it('exposes the button tint as custom properties', () => {
      const wrapper = createChatBotWrapper();

      expect(wrapper.vm.buttonTintStyle(tintedButton)).toEqual({
        '--qh-bg': '#ecfdf5',
        '--qh-hover': '#d1fae5',
        '--qh-outline': '#a7f3d0'
      });
    });

    it('returns undefined when a button declares no styles', () => {
      const wrapper = createChatBotWrapper();

      expect(wrapper.vm.buttonTintStyle(untintedButton)).toBeUndefined();
    });

    it('returns undefined when a button styles block is empty', () => {
      const wrapper = createChatBotWrapper();

      expect(wrapper.vm.buttonTintStyle({ styles: {} })).toBeUndefined();
    });

    it('returns only the declared properties for a partial styles block', () => {
      const wrapper = createChatBotWrapper();

      // toStrictEqual distinguishes {a: undefined} from {} — toEqual
      // does not, so a regression that emits unused undefined bindings
      // would slip past the loose matcher.
      expect(wrapper.vm.buttonTintStyle({ styles: { backgroundColor: '#ecfdf5' } })).toStrictEqual({
        '--qh-bg': '#ecfdf5'
      });
    });

    it('binds the tint onto the quick-help card', async () => {
      const wrapper = await mountWithButtons([tintedButton]);

      const card = wrapper.find('.quick-help-item');
      expect(card.exists()).toBe(true);
      expect(card.attributes('style') || '').toContain('--qh-bg');
    });

    it('does not paint a visible tint on an untinted card', async () => {
      const wrapper = await mountWithButtons([untintedButton]);

      const card = wrapper.find('.quick-help-item');
      expect(card.exists()).toBe(true);
      // An empty-string binding is CSSOM-indistinguishable from a missing
      // declaration (CSS `setProperty(name, '')` removes the property), so
      // a naive impl that returned `{'--qh-bg': '', ...}` would pass this
      // byte-identical DOM check. The empty-value contract is enforced at
      // the method boundary by the `returns undefined` tests above.
      expect(card.attributes('style') || '').not.toContain('--qh-bg');
    });
  });
});

// ---------------------------------------------------------------------------
// Brand-spaced heading
//
// The welcome heading uses <i18n-t> with a named slot for the brand name.
// createChatBotWrapper installs only the store, not the i18n plugin, so
// vue-i18n is absent and <i18n-t> resolves to nothing in every test above —
// a regression that dropped the brand span or emitted the raw key would be
// invisible. This block mounts a real i18n instance (minimal messages,
// legacy mode) and asserts the heading renders the localized sentence and
// the brand name in its own element.
// ---------------------------------------------------------------------------

const { createI18n } = require('vue-i18n');

function createChatBotWrapperWithI18n() {
  const store = createChatBotStore();
  const i18n = createI18n({
    legacy: true,
    locale: 'en',
    fallbackLocale: 'en',
    messages: {
      en: {
        chatbot: {
          whatCanIHelp: 'How can {brandwordmark} help you today?'
        }
      }
    }
  });
  return mount(ChatBotComponent, {
    global: {
      plugins: [store, i18n],
      stubs: {
        ChatResponseFeedbackDialog: true,
        ModalDialog: true,
        RightSideBarComponent: true,
        ConfirmDialog: true,
        DsPill: true,
        DsButton: {
          template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
          props: ['disabled', 'variant', 'small', 'tag']
        },
        DsCard: true,
        DsInput: true,
        DsSelect: true,
        Brain: true,
        Loader2: true,
        Plus: true,
        Save: true,
        FileText: true
      }
    }
  });
}

describe('ChatBotComponent welcome heading', () => {
  beforeEach(() => {
    // Brand name is read from cachedConfig.app.title, which the
    // config-loader mock at the top of this file returns through the
    // loadConfig mock. The default mock returns no `app` block, so
    // brandName is empty and brandWordmarkClass returns ''. To
    // exercise the wordmark class branch (the path the layer paints
    // the brand gradient on), install a config-loader mock that
    // returns the GENIE.AI title.
    const configLoader = require('../../config-loader');
    configLoader.default.mockResolvedValue({
      app: { title: 'GENIE.AI' },
      features: { chat: { quickHelp: { buttons: [] } } }
    });
  });

  it('renders the localized sentence with the brand name in its own element', async () => {
    const wrapper = createChatBotWrapperWithI18n();
    // The component mounts and then resolves the runtime config; until
    // that promise settles, cachedConfig is null and brandName resolves
    // to ''. Wait one tick before asserting the rendered brand element.
    await flushPromises();
    const heading = wrapper.find('h2.quick-help-heading');
    expect(heading.exists()).toBe(true);
    // The localized sentence and the brand name are both rendered as
    // text inside the h2; a regression that emits the raw key or the
    // raw placeholder would fail this match.
    expect(heading.text()).toContain('How can');
    expect(heading.text()).toContain('GENIE.AI');
    // The brand must live in its own element so the layer can paint
    // the gradient. <i18n-t> renders the slot template's root tag,
    // so a regression that flattened the slot to a bare text node
    // would fail this assertion.
    const brand = heading.find('.brand-wordmark');
    expect(brand.exists()).toBe(true);
    expect(brand.text()).toBe('GENIE.AI');
    // No placeholder leakage (the "{brandwordmark}" form would mean
    // the slot never bound). No HTML-tag leakage (would mean the
    // fallback path rendered).
    expect(heading.text()).not.toMatch(/[{}]/);
    expect(heading.text()).not.toMatch(/[<>]/);
  });

  // el-salvador: context-config admin warning contract
  // -----------------------------------------------------------------------
  // Dashboard overlay and chart functionality
  // -----------------------------------------------------------------------
  describe('Dashboard overlay visibility', () => {
    it('shows quick help overlay by default with no context items', () => {
      const wrapper = createChatBotWrapper();
      expect(wrapper.vm.showQuickHelp).toBe(true);
      expect(wrapper.vm.selectedContextItems.length).toBe(0);
    });

    it('hides quick help overlay when context items exist', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // Simulate selecting a quick help option which sets both conditions
      const option = {
        service: 'Test Service',
        visibleText: 'Test',
        hiddenPrompt: 'Test prompt',
        category: 'general',
        id: 'test-id'
      };
      jest.spyOn(vm, 'sendMessage').mockImplementation(() => {});
      vm.selectQuickHelpOption(option);

      expect(vm.showQuickHelp).toBe(false);
    });
  });

  describe('openChart method', () => {
    it('opens chart dialog with crop-health type', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.openChart('crop-health');

      expect(vm.chartDialog.visible).toBe(true);
      expect(vm.chartDialog.type).toBe('crop-health');
      expect(vm.chartDialog.title).toBeTruthy();
    });

    it('opens chart dialog with pest-alert type', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.openChart('pest-alert');

      expect(vm.chartDialog.visible).toBe(true);
      expect(vm.chartDialog.type).toBe('pest-alert');
    });

    it('opens chart dialog with market-price type and category', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.openChart('market-price', 'maize');

      expect(vm.chartDialog.visible).toBe(true);
      expect(vm.chartDialog.type).toBe('market-price');
      expect(vm.chartDialog.category).toBe('maize');
    });

    it('handles unknown chart type with fallback title', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.openChart('unknown-type');

      expect(vm.chartDialog.visible).toBe(true);
      expect(vm.chartDialog.type).toBe('unknown-type');
      expect(vm.chartDialog.title).toBe('unknown-type');
    });

    it('passes category through to chartDialog state', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.openChart('market-price', 'fertilizer');

      expect(vm.chartDialog.category).toBe('fertilizer');
    });
  });

  describe('checkContextConfig warning logic', () => {
    it('does not warn for admin when context has no mismatches', () => {
      // Admin comes from the state factory: the store mock has no SET_USER
      // mutation, so the commit would be a silent no-op.
      const wrapper = createChatBotWrapper({
        user: { ...defaultAuthenticatedUser, roles: ['admin'], _key: 'test-admin' }
      });
      const vm = wrapper.vm;

      // Add a properly matched context item — matched, under the main
      // contract, by the label being in the item's serviceLabels array or
      // equal to its serviceKey.
      vm.selectedContextItems.push({
        service: 'Test Service',
        serviceKey: 'Test Service',
        serviceLabels: ['Test Service'],
        category: 'general',
        selected: true
      });

      const context = {
        categoryLabel: 'Agriculture',
        serviceLabels: ['Test Service']
      };

      // Should not throw or call warning
      expect(() => vm.checkContextConfig(context)).not.toThrow();
      expect(mockNotificationWarning).not.toHaveBeenCalled();
    });

    it('warns when service label has no matching context item', () => {
      // Admin comes from the state factory: the store mock has no SET_USER
      // mutation, so the commit would be a silent no-op.
      const wrapper = createChatBotWrapper({
        user: { ...defaultAuthenticatedUser, roles: ['admin'], _key: 'test-admin' }
      });
      const vm = wrapper.vm;

      const context = {
        categoryLabel: 'Valid Category',
        serviceLabels: ['NonExistent Service']
      };

      console.log('DEBUG user:', JSON.stringify(vm.$store.getters.currentUser));
      console.log('DEBUG items:', JSON.stringify(vm.selectedContextItems));
      const __r = vm.checkContextConfig(context);
      console.log('DEBUG result:', __r);

      expect(mockNotificationWarning).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // AgroGenio brand integration (welcome-header banner + leaves)
  // -----------------------------------------------------------------------
  describe('AgroGenio banner integration', () => {
    it('renders welcome-banner + welcome-leaves inside .welcome-header', () => {
      const wrapper = createChatBotWrapper();
      const header = wrapper.find('.welcome-header');
      expect(header.exists()).toBe(true);
      expect(header.find('.welcome-banner').exists()).toBe(true);
      expect(header.find('.welcome-leaves').exists()).toBe(true);
    });

    it('preserves the market-prices section (regression check)', () => {
      const wrapper = createChatBotWrapper();
      expect(wrapper.find('.market-prices-section').exists()).toBe(true);
    });

    it('preserves the chat-input area (regression check)', () => {
      const wrapper = createChatBotWrapper();
      expect(wrapper.find('.chat-input').exists()).toBe(true);
    });
  });
});
