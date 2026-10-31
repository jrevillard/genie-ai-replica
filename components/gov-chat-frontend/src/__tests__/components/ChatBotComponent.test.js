'use strict';

/**
 * ChatBotComponent tests — AC1 through AC5.
 *
 * Covers: empty render, user message submission, input clearing,
 * loading state, and error state.
 */
const { mount, flushPromises } = require('@vue/test-utils');
const { createStore } = require('vuex');
const { reactive } = require('vue');
const { createAuthenticatedState } = require('../fixtures/store-state');
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

// The tree the component loads (the API mock) — the LIVE hierarchy the
// scope is resolved against. Assigning vm.serviceCategories directly is not
// enough: the mount-time load overwrites it.
// A tree carrying the categories and the labels the plumbing tests click. A
// scoped button is checked against the live tree — its category must exist,
// its declared labels must be part of the hierarchy's vocabulary, and the
// scope can only be NAMED through the tree: the click sends nothing without
// it.
function treeCarrying(spec) {
  return Object.entries(spec).map(([catKey, labels]) => ({
    catKey,
    name: `Cat ${catKey}`,
    nameEN: `Area ${catKey}`, // not 'Category N': that spelling is the legacy fallback the send guard blocks
    children: labels.map((label) => ({ name: label, nameEN: label }))
  }));
}

function mockLiveTree(categories) {
  const serviceTreeService = require('../../services/serviceTreeService');
  serviceTreeService.getAllCategories.mockResolvedValue(categories);
}

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
  AlertTriangle: { template: '<svg />' },
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

// A wrapper whose mount-time tree load has SETTLED on [tree] — the
// component's own promise then agrees with the assignment.
async function createChatBotWrapperAsync(tree, storeOverrides = {}) {
  const wrapper = createChatBotWrapper(storeOverrides);
  await flushPromises();
  wrapper.vm.serviceCategories = tree;
  wrapper.vm.serviceCategoriesStatus = 'loaded';
  return wrapper;
}

function createChatBotWrapper(storeOverrides = {}, { rehydrate = false, renderStubDefaultSlot = false } = {}) {
  const store = createChatBotStore(storeOverrides);
  if (rehydrate) rehydrateConversation(store.state.conversation);
  return mount(ChatBotComponent, {
    global: {
      plugins: [store],
      // The stubs render no slot content by default, so what a card holds
      // is invisible to the tests. A test that reads what a card SHOWS
      // asks for the slot.
      renderStubDefaultSlot,
      mocks: {
        $t: (key) => key,
        // Reactive, so a test can switch the locale the way the app does and
        // the component's locale watchers run.
        $i18n: reactive({ locale: 'en' })
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

// Mount with a configuration whose Quick Help buttons are [buttons]. The
// config-loader mock is module-level, and clearAllMocks() does not reset an
// implementation — resetQuickHelpButtons() restores the empty-button default
// afterwards (from the describes' afterEach), so the rest of the suite is
// unaffected. [options] is passed through to createChatBotWrapper.
async function mountWithButtons(buttons, options = {}) {
  const configLoader = require('../../config-loader');
  configLoader.default.mockResolvedValue({
    features: { chat: { quickHelp: { buttons } } }
  });
  const wrapper = createChatBotWrapper({}, options);
  await flushPromises();
  return wrapper;
}

function resetQuickHelpButtons() {
  const configLoader = require('../../config-loader');
  configLoader.default.mockResolvedValue({
    features: { chat: { quickHelp: { buttons: [] } } }
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChatBotComponent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // The hierarchy mock's IMPLEMENTATION survives clearAllMocks: a test
    // that never installs a tree inherited the PREVIOUS test's hierarchy
    // (an order-dependent suite). Every test starts from an empty
    // hierarchy unless it installs its own.
    const serviceTreeService = require('../../services/serviceTreeService');
    serviceTreeService.getAllCategories.mockReset();
    serviceTreeService.getAllCategories.mockResolvedValue([]);
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
      mockLiveTree(treeCarrying({ 'test-category': [] }));
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      vm.serviceCategories = treeCarrying({ 'test-category': [] });

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
      mockLiveTree(treeCarrying({ 'test-category-123': ['TestLabel'] }));
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      vm.serviceCategories = treeCarrying({ 'test-category-123': ['TestLabel'] });

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
        serviceLabels: null // the shipped just-chat button declares no labels
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
        serviceLabels: null // the shipped just-chat button declares no labels
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
        serviceLabels: null // the shipped just-chat button declares no labels
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
      mockLiveTree(treeCarrying({ 'test-category-123': ['TestLabel'] }));
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      vm.serviceCategories = treeCarrying({ 'test-category-123': ['TestLabel'] });

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

    it('loadQuickHelpButtons reads serviceLabels and keeps the button id as the service key', async () => {
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
      expect(btn.serviceKey).toBe('grow');
      expect(btn.service).toBe('Grow'); // display = localized title, NOT the English label
    });

    it('loadQuickHelpButtons keys the button on its id, not on the labels it declares', async () => {
      // The label is DEPLOYMENT DATA: it changes when the hierarchy is
      // reconfigured. The key of a saved conversation must survive that.
      const loadConfig = require('../../config-loader').default;
      loadConfig.mockResolvedValue({
        features: {
          chat: {
            quickHelp: {
              buttons: [{ id: 'grow', title: 'Grow', category: '1', serviceLabels: ['Tomato'] }]
            }
          }
        }
      });

      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      await vm.loadQuickHelpButtons();
      await wrapper.vm.$nextTick();

      expect(vm.quickHelpButtons[0].serviceKey).toBe('grow');
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

    it('does not read the runtime configuration again when the locale changes', async () => {
      // The runtime configuration is the same for every locale — only the
      // display text of a button is resolved per locale. Reading the
      // configuration again on every language switch is a wasted request.
      const loadConfig = require('../../config-loader').default;
      loadConfig.mockResolvedValue({
        features: {
          chat: {
            quickHelp: {
              buttons: [{ id: 'grow', title: { en: 'Grow', fr: 'Cultiver' }, category: '1' }]
            }
          }
        }
      });

      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      await vm.loadQuickHelpButtons();
      await wrapper.vm.$nextTick();

      expect(vm.quickHelpButtons[0].service).toBe('Grow');
      const readsBeforeLocaleChange = loadConfig.mock.calls.length;

      vm.$i18n.locale = 'fr';
      await wrapper.vm.$nextTick();
      // The locale change may start a read of its own; let it settle before
      // counting the reads.
      await vm.quickHelpLoadPromise;
      await wrapper.vm.$nextTick();

      expect(loadConfig.mock.calls.length).toBe(readsBeforeLocaleChange);
      expect(vm.quickHelpButtons[0].service).toBe('Cultiver');
    });

    it('selectQuickHelpOption carries serviceLabels and replaces previous Quick Help', () => {
      mockLiveTree(treeCarrying({ 1: ['Tomato'], 2: ['Onion'] }));
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      vm.serviceCategories = treeCarrying({ 1: ['Tomato'], 2: ['Onion'] });

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

    it('selectQuickHelpOption REPLACES the sidebar selection (mode switch)', () => {
      mockLiveTree(treeCarrying({ 1: ['Tomato'], 9: ['Crops'] }));
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      vm.serviceCategories = treeCarrying({ 1: ['Tomato'], 9: ['Crops'] });

      // A sidebar item is selected, then a card is pressed. The two are
      // alternative ways of scoping the same query (the mobile rules this
      // already): keeping both sent the card's category and the sidebar's
      // service label together, and the wire's service-wins rule then
      // dropped the category the card promised.
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

      expect(vm.selectedContextItems.length).toBe(1);
      expect(vm.selectedContextItems.some((i) => i.source === 'sidebar')).toBe(false);
      expect(vm.selectedContextItems.some((i) => i.source === 'quickHelp')).toBe(true);
    });

    it('restores a Quick Help tag with the labels its button declared', async () => {
      const loadConfig = require('../../config-loader').default;
      loadConfig.mockResolvedValue({
        features: {
          chat: {
            quickHelp: {
              buttons: [{ id: 'grow', title: 'Grow', category: '1', serviceLabels: ['Tomato', 'Onion'] }]
            }
          }
        }
      });

      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      await vm.loadQuickHelpButtons();

      // A saved conversation keeps the tag of the item, not the item itself.
      const chatHistoryService = require('../../services/chatHistoryService');
      chatHistoryService.getConversation.mockResolvedValueOnce({
        _key: 'c1',
        title: 'Saved chat',
        messages: [],
        tags: ['grow']
      });

      await vm.loadExistingConversation('c1');

      expect(vm.selectedContextItems.length).toBe(1);
      expect(vm.selectedContextItems[0].source).toBe('quickHelp');
      expect(vm.selectedContextItems[0].serviceLabels).toEqual(['Tomato', 'Onion']);
    });

    it('does not restore a Quick Help button from a tag that is one of its labels', async () => {
      // A sidebar selection and a Quick Help button can carry the SAME label.
      // Restoring the button for a sidebar tag would silently change the
      // scope of the saved query.
      const loadConfig = require('../../config-loader').default;
      loadConfig.mockResolvedValue({
        features: {
          chat: {
            quickHelp: {
              buttons: [{ id: 'grow', title: 'Grow', category: '1', serviceLabels: ['Tomato'] }]
            }
          }
        }
      });

      // Explicitly no tree: the restore now waits for the initial load, so a
      // previous test's mock must not leak the vocabulary in.
      mockLiveTree([]);
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      await vm.loadQuickHelpButtons();

      const chatHistoryService = require('../../services/chatHistoryService');
      chatHistoryService.getConversation.mockResolvedValueOnce({
        _key: 'c1',
        title: 'Saved chat',
        messages: [],
        tags: ['Tomato']
      });

      await vm.loadExistingConversation('c1');

      expect(vm.selectedContextItems.length).toBe(1);
      expect(vm.selectedContextItems[0].source).not.toBe('quickHelp');
      // The wire carries the EN label the live tree confirms. With no tree
      // loaded, 'Tomato' is a tag and nothing more — it is not turned into
      // a filter label the hierarchy cannot vouch for.
      expect(vm.selectedContextItems[0].serviceKey).toBeNull();
    });

    it('restores a sidebar scope as its EN label when the tree confirms it', async () => {
      // A saved conversation carries the EN label of the scope (a
      // locale-independent identity). The tree confirms it → the wire
      // filters on it; the chip shows the localized name.
      const tree = [
        {
          catKey: '2',
          name: 'Cultivos',
          nameEN: 'Crops',
          children: [{ name: 'Tomate', nameEN: 'Tomato' }]
        }
      ];
      mockLiveTree(tree);
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const chatHistoryService = require('../../services/chatHistoryService');
      chatHistoryService.getConversation.mockResolvedValueOnce({
        _key: 'c1',
        title: 'Saved chat',
        messages: [],
        tags: ['Tomato']
      });

      await vm.loadExistingConversation('c1');

      expect(vm.selectedContextItems[0].serviceKey).toBe('Tomato');
      expect(vm.selectedContextItems[0].service).toBe('Tomate');
    });

    it('waits for the tree before resolving a restored sidebar scope', async () => {
      // The tree is fetched asynchronously. A conversation restored before
      // the fetch resolved would look its tags up in an empty vocabulary and
      // drop the scope — the same race the Quick Help config wait fixes, one
      // data source over.
      let resolveTree;
      const treePromise = new Promise((resolve) => {
        resolveTree = resolve;
      });
      const serviceTreeService = require('../../services/serviceTreeService');
      serviceTreeService.getAllCategories.mockReturnValue(treePromise);
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const chatHistoryService = require('../../services/chatHistoryService');
      chatHistoryService.getConversation.mockResolvedValueOnce({
        _key: 'c1',
        title: 'Saved chat',
        messages: [],
        tags: ['Tomato']
      });

      let restored;
      const restoring = vm.loadExistingConversation('c1').then(() => {
        restored = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      // The restore is parked on the tree: resolving the scope without it
      // would send an unfiltered query for a scope the tree does carry.
      expect(restored).toBeUndefined();

      resolveTree([
        {
          catKey: '2',
          name: 'Cultivos',
          nameEN: 'Crops',
          children: [{ name: 'Tomate', nameEN: 'Tomato' }]
        }
      ]);
      await restoring;

      expect(vm.selectedContextItems[0].serviceKey).toBe('Tomato');
      expect(vm.selectedContextItems[0].service).toBe('Tomate');
    });

    it('restores a Quick Help button when the config has not loaded yet', async () => {
      // The configuration is fetched asynchronously. A conversation restored
      // before the fetch resolved would find no button for its tag, fall
      // back to the sidebar branch, and send the button id as a label.
      const loadConfig = require('../../config-loader').default;
      let configRequested;
      const configRequestedPromise = new Promise((resolve) => {
        configRequested = resolve;
      });
      let resolveConfig;
      loadConfig.mockImplementation(() => {
        configRequested();
        return new Promise((resolve) => {
          resolveConfig = resolve;
        });
      });

      try {
        const wrapper = createChatBotWrapper();
        const vm = wrapper.vm;

        const chatHistoryService = require('../../services/chatHistoryService');
        chatHistoryService.getConversation.mockResolvedValueOnce({
          _key: 'c1',
          title: 'Saved chat',
          messages: [],
          tags: ['grow']
        });

        const restoring = vm.loadExistingConversation('c1');
        await configRequestedPromise;
        resolveConfig({
          features: {
            chat: {
              quickHelp: {
                buttons: [{ id: 'grow', title: 'Grow', category: '1', serviceLabels: ['Tomato'] }]
              }
            }
          }
        });
        await restoring;

        expect(vm.selectedContextItems.length).toBe(1);
        expect(vm.selectedContextItems[0].source).toBe('quickHelp');
        expect(vm.selectedContextItems[0].serviceLabels).toEqual(['Tomato']);
      } finally {
        loadConfig.mockResolvedValue({ features: { chat: { quickHelp: { buttons: [] } } } });
      }
    });

    it('a STALE hidden prompt never replaces an unrelated question', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // A button's send was refused (its scope could not be named): the
      // hidden prompt stayed armed. The user then asks an unrelated
      // question — the OLD prompt must not answer for it. The prompt is
      // bound to the text it was armed with: same text retry keeps it,
      // a different question gets exactly what the user typed.
      vm.hiddenPromptForNextMessage = 'OLD BUTTON PROMPT';
      vm.hiddenPromptForText = 'old button question';
      vm.newMessage = 'a completely different question';
      await vm.sendMessage();

      const payload = mockSubmitQueryStream.mock.calls.at(-1)[0];
      expect(payload.text).toBe('a completely different question');
    });

    it('a hidden prompt binds through the TRIM the send applies', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // The send trims the composer (content = newMessage.trim()); the
      // arm used the raw visible text. A button whose visibleText
      // carries padding never bound, and the VISIBLE text went to the
      // LLM instead of the hidden prompt — silently.
      vm.hiddenPromptForNextMessage = 'PADDED BUTTON PROMPT';
      vm.hiddenPromptForText = '  padded button question  ';
      vm.newMessage = '  padded button question  ';
      await vm.sendMessage();

      const payload = mockSubmitQueryStream.mock.calls.at(-1)[0];
      expect(payload.text).toBe('PADDED BUTTON PROMPT');
    });

    it('a refused button send keeps its hidden prompt for the SAME text', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.hiddenPromptForNextMessage = 'OLD BUTTON PROMPT';
      vm.hiddenPromptForText = 'old button question';
      vm.newMessage = 'old button question';
      await vm.sendMessage();

      const payload = mockSubmitQueryStream.mock.calls.at(-1)[0];
      expect(payload.text).toBe('OLD BUTTON PROMPT');
    });

    it('sends no category key — the client contract carries labels only', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // The label names the category; the key is the hierarchy's own
      // identity and is not part of the contract a client speaks. The backend
      // resolves the label against the live hierarchy and knows the identity
      // from there.
      vm.serviceCategories = [{ catKey: '2', name: 'Cultivos', nameEN: 'Crops' }];
      vm.currentCategoryId = '2';
      vm.$store.commit('conversation/setContextItems', [
        { id: 'grow', source: 'quickHelp', serviceLabels: ['Tomato'], category: '2', selected: true }
      ]);
      vm.newMessage = 'How do I grow tomatoes?';

      await vm.sendMessage();

      const payload = mockSubmitQueryStream.mock.calls[0][0];
      expect(payload.context.categoryLabel).toBe('Crops');
      expect(payload.context).not.toHaveProperty('categoryKey');
    });

    it('sends no category key for the general placeholder', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // 'general' is the placeholder a Quick Help button falls back to. It
      // names no category of the hierarchy, so it is no category at all.
      vm.currentCategoryId = 'general';
      vm.$store.commit('conversation/setContextItems', [
        { id: 'grow', source: 'quickHelp', serviceLabels: ['Tomato'], category: 'general', selected: true }
      ]);
      vm.newMessage = 'How do I grow tomatoes?';

      await vm.sendMessage();

      const payload = mockSubmitQueryStream.mock.calls[0][0];
      expect(payload.context.categoryLabel).toBeNull();
      expect(payload.context).not.toHaveProperty('categoryKey');
    });

    it('sends the ENGLISH label of the category — the localized name is display-only', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // English is the SSOT of the filter wire: chunk_labels carry the EN
      // translation. The localized name the tree displays never filters —
      // sending it would scope the query against labels no chunk carries.
      vm.serviceCategories = [{ catKey: '2', name: 'Cultivos', nameEN: 'Crops' }];
      vm.currentCategoryId = '2';
      vm.$store.commit('conversation/setContextItems', [
        { service: 'Tomate', serviceKey: 'Tomato', category: '2', selected: true }
      ]);
      vm.newMessage = '¿Cómo cultivo tomates?';

      await vm.sendMessage();

      const payload = mockSubmitQueryStream.mock.calls[0][0];
      expect(payload.context.categoryLabel).toBe('Crops');
      expect(payload.context.serviceLabels).toEqual(['Tomato']);
    });

    it('marks a Quick Help button broken when a declared label left the hierarchy', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      const button = {
        id: 'civil',
        service: 'État civil',
        serviceLabels: ['Registration', 'Births'],
        category: '2',
        icon: 'x'
      };
      vm.serviceCategories = [
        {
          catKey: '2',
          name: 'État civil',
          nameEN: 'Civil Registry',
          children: [{ name: 'Naissances', nameEN: 'Births' }]
        }
      ];
      vm.serviceCategoriesStatus = 'loaded';

      const state = vm.quickHelpScopeState(button);
      // 'Registration' was renamed ('Birth Registration' now) — the button can
      // no longer keep its promised scope, so it is a broken button.
      expect(state.broken).toBe(true);
      expect(state.missingLabels).toEqual(['Registration']);
    });

    it('marks a Quick Help button broken when its category left the hierarchy', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      const button = { id: 'tax', service: 'Taxes', serviceLabels: ['Tax Filing'], category: '404', icon: 'x' };
      vm.serviceCategories = [{ catKey: '2', name: 'Crops', nameEN: 'Crops', children: [] }];
      vm.serviceCategoriesStatus = 'loaded';

      const state = vm.quickHelpScopeState(button);
      expect(state.broken).toBe(true);
      expect(state.categoryMissing).toBe(true);
    });

    it('does not mark a valid button broken', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      const button = { id: 'civil', service: 'État civil', serviceLabels: ['Births'], category: '2', icon: 'x' };
      vm.serviceCategories = [
        {
          catKey: '2',
          name: 'État civil',
          nameEN: 'Civil Registry',
          children: [{ name: 'Naissances', nameEN: 'Births' }]
        }
      ];

      const state = vm.quickHelpScopeState(button);
      expect(state.broken).toBe(false);
    });

    it('does not mark any button broken while the hierarchy has not loaded', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // A tree that has not loaded yet says nothing about any button's
      // scope, so it reports nothing. (A tree that FAILED to load is a
      // different thing: every scope is unverifiable, and every button
      // says so.)
      const button = {
        id: 'civil',
        service: 'État civil',
        serviceLabels: ['Registration'],
        category: '404',
        icon: 'x'
      };
      vm.serviceCategories = [];

      expect(vm.quickHelpScopeState(button).broken).toBe(false);
    });

    it('a broken Quick Help button sends no query', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // The error state on the button is the visible failure. The click must
      // not send a query with a silently reduced scope — not even the
      // auto-send path a hidden prompt would trigger.
      const broken = {
        id: 'civil',
        service: 'État civil',
        serviceLabels: ['Registration'],
        category: '2',
        icon: 'x',
        hiddenPrompt: 'hidden prompt',
        visibleText: 'visible text'
      };
      vm.serviceCategories = [{ catKey: '2', name: 'État civil', nameEN: 'Civil Registry', children: [] }];
      vm.serviceCategoriesStatus = 'loaded';

      await vm.selectQuickHelpOption(broken);

      expect(mockSubmitQueryStream).not.toHaveBeenCalled();
      expect(vm.selectedContextItems).toHaveLength(0);
    });

    it('a scoped button sends nothing when the tree is not there to name its category', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // The config carries the category KEY; the wire needs its ENGLISH
      // label, and only the live tree can say it. A tree that did not load
      // cannot name the scope — and a query without it would answer from the
      // whole corpus, from a button the user believes is scoped.
      const button = {
        id: 'civil',
        service: 'État civil',
        serviceLabels: [],
        category: '2',
        icon: 'x',
        hiddenPrompt: 'hidden prompt',
        visibleText: 'visible text'
      };
      vm.serviceCategories = [];

      await vm.selectQuickHelpOption(button);

      expect(mockSubmitQueryStream).not.toHaveBeenCalled();
      expect(vm.selectedContextItems).toHaveLength(0);
      expect(vm.currentCategoryId).toBeNull();
    });

    it('a category the hierarchy carries without an EN translation breaks the scope', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // The wire speaks EN: a category the hierarchy carries only in the
      // localized spelling has no filterable label at all. The button
      // promises a scope it cannot keep — a broken button, not a healthy
      // one that silently sends nothing.
      const button = { id: 'civil', service: 'État civil', serviceLabels: [], category: '2', icon: 'x' };
      vm.serviceCategories = [{ catKey: '2', name: 'État civil', nameEN: null, children: [] }];
      vm.serviceCategoriesStatus = 'loaded';

      const state = vm.quickHelpScopeState(button);
      expect(state.broken).toBe(true);
      expect(state.categoryMissing).toBe(true);
    });

    it('a scoped button whose category has no EN translation sends no query', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const tree = [{ catKey: '2', name: 'État civil', nameEN: null, children: [] }];
      mockLiveTree(tree);
      vm.serviceCategories = tree;
      vm.serviceCategoriesStatus = 'loaded';

      const button = {
        id: 'civil',
        service: 'État civil',
        serviceLabels: [],
        category: '2',
        icon: 'x',
        hiddenPrompt: 'hidden prompt',
        visibleText: 'visible text'
      };
      await vm.selectQuickHelpOption(button);

      expect(mockSubmitQueryStream).not.toHaveBeenCalled();
      expect(vm.selectedContextItems).toHaveLength(0);
    });

    it('the caption names the label that left the hierarchy', async () => {
      const en = require('../../i18n/locales/en').default;
      const wrapper = createChatBotWrapperWithI18n({ en });
      const vm = wrapper.vm;
      const tree = [
        {
          catKey: '2',
          name: 'État civil',
          nameEN: 'Civil Registry',
          children: [{ name: 'Naissances', nameEN: 'Births' }]
        }
      ];
      mockLiveTree(tree);
      vm.serviceCategories = tree;
      vm.serviceCategoriesStatus = 'loaded';

      const button = {
        id: 'civil',
        service: 'État civil',
        serviceLabels: ['Registration'],
        category: '2',
        icon: 'x'
      };
      const caption = vm.quickHelpErrorCaption(button);

      // The caption NAMES the label that is gone. The i18n layer consumes
      // the {labels} placeholder itself, so the value has to be passed to
      // it as a parameter: a caption that replaces it by hand finds
      // nothing left to replace, and says the label is "".
      expect(caption).toContain('Registration');
    });

    it('a restored sidebar scope the hierarchy can no longer name refuses the send, and says so', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const tree = [{ catKey: '2', name: 'Crops', nameEN: 'Crops', children: [] }];
      mockLiveTree(tree);
      vm.serviceCategories = tree;
      vm.serviceCategoriesStatus = 'loaded';

      // A conversation saved with a sidebar scope whose EN label was
      // renamed away: the tag is not in the hierarchy, so the scope
      // cannot be named and the query would leave with NO filter. The
      // refusal must be VISIBLE — the mismatch warnings reach admins
      // alone, and the person whose question was refused sees nothing.
      vm.$store.commit('conversation/setContextItems', [
        {
          service: 'Renamed Label',
          serviceKey: null,
          serviceLabels: [],
          source: 'sidebar',
          id: 'Renamed Label',
          selected: true
        }
      ]);

      expect(vm.checkContextConfig({ categoryLabel: null, serviceLabels: [] })).toBe(false);
      expect(mockNotificationError).toHaveBeenCalledWith('chatbot.scopeNotNameable');
    });

    it('a card that declares no scope stays usable when the hierarchy failed', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      vm.serviceCategoriesStatus = 'failed';

      // A card with no category and no label promises nothing the
      // hierarchy could deny — it is the "just chat" entry, and the
      // welcome composer stays reachable when the hierarchy is down.
      const justChat = { id: 'just-chat', service: 'Just Chat', serviceLabels: null, category: null, icon: 'x' };
      const scoped = { id: 'tax', service: 'Taxes', serviceLabels: null, category: '5', icon: 'x' };

      expect(vm.quickHelpScopeState(justChat).broken).toBe(false);
      expect(vm.quickHelpScopeState(scoped).broken).toBe(true);
    });

    it('a sidebar service with no English name refuses the send, and says so', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const tree = [
        {
          catKey: '2',
          name: 'Impuestos',
          nameEN: 'Taxes',
          children: [{ name: 'Declaración de impuestos', nameEN: null }]
        }
      ];
      mockLiveTree(tree);
      vm.serviceCategories = tree;
      vm.serviceCategoriesStatus = 'loaded';

      // The user picked the SERVICE; without its English name the wire
      // would carry the CATEGORY alone — the query silently widening to
      // the whole category while the chip still names the service.
      vm.$store.commit('conversation/addContextItem', {
        service: 'Declaración de impuestos',
        serviceKey: null,
        category: '2',
        selected: true
      });
      vm.currentCategoryId = '2';

      expect(vm.checkContextConfig({ categoryLabel: 'Taxes', serviceLabels: [] })).toBe(false);
      expect(mockNotificationError).toHaveBeenCalledWith('chatbot.scopeNotNameable');
    });

    it('a restored Quick Help scope with a gone LABEL refuses the send, and names it', async () => {
      // The mocked $t returns the key unexpanded; the REAL locale is
      // needed to prove the notification NAMES the gone label.
      const en = require('../../i18n/locales/en').default;
      const wrapper = createChatBotWrapperWithI18n({ en });
      const vm = wrapper.vm;
      const tree = [
        {
          catKey: '2',
          name: 'État civil',
          nameEN: 'Civil Registry',
          children: [{ name: 'Naissances', nameEN: 'Births' }]
        }
      ];
      mockLiveTree(tree);
      vm.serviceCategories = tree;
      vm.serviceCategoriesStatus = 'loaded';

      // The grid refuses this button (a declared label left the
      // hierarchy); the restored scope must refuse it the same way — the
      // old guard checked the category only and sent the dead label.
      vm.$store.commit('conversation/setContextItems', [
        {
          service: 'Civil registry',
          serviceLabels: ['Births', 'Renamed Away'],
          serviceKey: 'identity-civil',
          source: 'quickHelp',
          id: 'identity-civil',
          category: '2',
          selected: true
        }
      ]);
      vm.currentCategoryId = '2';

      expect(
        vm.checkContextConfig({ categoryLabel: 'Civil Registry', serviceLabels: ['Births', 'Renamed Away'] })
      ).toBe(false);
      expect(mockNotificationError).toHaveBeenCalled();
      const message = mockNotificationError.mock.calls.at(-1)[0];
      expect(String(message)).toContain('Renamed Away');
    });

    it('a superseded restore does not commit its scope over the newer one', async () => {
      // The Quick Help config resolves SLOWLY: A's scope wait
      // (Promise.all) stays pending long enough for B — the newer load —
      // to land first. A's wait resolving afterwards must not commit A's
      // scope over B's.
      const configLoader = require('../../config-loader');
      let releaseConfig;
      configLoader.default.mockImplementation(
        () =>
          new Promise((resolve) => {
            releaseConfig = resolve;
          })
      );
      // mockImplementation is not reset between tests, and a LATER test
      // that loads the config through the restore path would inherit a
      // promise nothing ever resolves — it hangs to the timeout. The
      // default comes back the moment this test is done.
      const withConfigRestore = async (fn) => {
        try {
          return await fn();
        } finally {
          configLoader.default.mockResolvedValue({ features: { chat: { quickHelp: { buttons: [] } } } });
        }
      };
      const tree = [{ catKey: '2', name: 'Cultivos', nameEN: 'Crops', children: [] }];
      mockLiveTree(tree);
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      const chatHistoryService = require('../../services/chatHistoryService');
      chatHistoryService.getConversation.mockImplementation(async (id) =>
        id === 'a1'
          ? { _key: 'a1', title: 'A', messages: [], tags: ['Renamed-Away'], categories: [] }
          : { _key: 'b1', title: 'B', messages: [], tags: [], categories: [] }
      );

      await withConfigRestore(async () => {
        const loadA = vm.loadExistingConversation('a1');
        await flushPromises(); // A's getConversation resolved; its scope wait is held
        const loadB = vm.loadExistingConversation('b1');
        await flushPromises(); // B is fully loaded — it owns the view
        expect(vm.currentChatId).toBe('b1');

        releaseConfig({ features: { chat: { quickHelp: { buttons: [] } } } });
        await Promise.all([loadA, loadB]);
        await flushPromises();

        // B still owns the view: A's scope never landed over it.
      });
      expect(vm.currentChatId).toBe('b1');
      expect(vm.selectedContextItems).toHaveLength(0);
    });

    it('a conversation saves no localized display name as a tag', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // A tag is the item's IDENTITY (a button id, an EN label). The
      // localized display name is not: persisting it made the conversation
      // unresolvable on the next open — and locale-dependent.
      vm.$store.commit('conversation/setContextItems', [
        { service: 'Cultivos', serviceKey: null, categoryOnly: true, category: '2', selected: true }
      ]);
      expect(vm.getContextTags()).toEqual([]);

      vm.$store.commit('conversation/setContextItems', [
        { service: 'Nacimientos', serviceKey: 'Births', source: 'sidebar', category: '2', selected: true }
      ]);
      expect(vm.getContextTags()).toEqual(['Births']);
    });

    it('clearing the last chip does not re-install a BROKEN Quick Help scope', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const tree = [
        {
          catKey: '2',
          name: 'État civil',
          nameEN: 'Civil Registry',
          children: [{ name: 'Naissances', nameEN: 'Births' }]
        }
      ];
      mockLiveTree(tree);
      vm.serviceCategories = tree;
      vm.serviceCategoriesStatus = 'loaded';

      // The button of this category declares a label that left the
      // hierarchy: it is broken. Re-installing it would block every
      // subsequent send — and removing the chip again would re-add the
      // same broken button, so the user could not recover.
      vm.quickHelpButtons = [
        {
          id: 'civil',
          service: 'Civil registry',
          serviceLabels: ['Renamed Away'],
          serviceKey: 'civil',
          category: '2',
          icon: 'x'
        }
      ];
      vm.currentCategoryId = '2';
      vm.$store.commit('conversation/setContextItems', [
        { service: 'Cultivos', serviceKey: null, source: 'sidebar', category: '2', selected: true }
      ]);

      vm.removeContextItem(0);

      expect(vm.selectedContextItems).toHaveLength(0);
      expect(vm.currentCategoryId).toBeNull();
      // And the send is not blocked by a scope nobody can name.
      expect(vm.checkContextConfig({ categoryLabel: null, serviceLabels: [] })).toBe(true);
    });

    it('a locale switch shows the localized name of a sidebar chip, not the EN label', async () => {
      const tree = [
        {
          catKey: '2',
          name: 'Impuestos',
          nameEN: 'Taxes',
          children: [{ name: 'Declaración de impuestos', nameEN: 'Tax Filing' }]
        }
      ];
      mockLiveTree(tree);
      const wrapper = await createChatBotWrapperAsync(tree);
      const vm = wrapper.vm;

      // The chip's identity is the EN label; its DISPLAY is the tree's
      // localized name for it. safeTranslate returned the EN string
      // unchanged in a non-English UI.
      vm.$store.commit('conversation/setContextItems', [
        { service: 'Tax Filing', serviceKey: 'Tax Filing', source: 'sidebar', category: '2', selected: true }
      ]);

      // The locale switch is what re-resolves the chips: the watcher must
      // rewrite the display through the tree, not through safeTranslate
      // (which returns the EN string unchanged in a non-English UI).
      wrapper.vm.$i18n.locale = 'fr';
      await vm.$nextTick();
      await flushPromises();

      expect(vm.selectedContextItems[0].service).toBe('Declaración de impuestos');
    });

    it('a locale switch re-resolves a QUICK HELP chip title, not just the buttons', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // The button's title is localized config text. The chip installed
      // from it kept the OLD locale's title: applyQuickHelpButtons
      // re-resolved the BUTTONS, but the store's chip items were never
      // touched — a French UI kept showing the English title.
      vm.cachedConfig = {
        features: {
          chat: {
            quickHelp: {
              buttons: [{ id: 'births', title: { en: 'Births', fr: 'Naissances' }, category: '2' }]
            }
          }
        }
      };
      vm.applyQuickHelpButtons();
      vm.$store.commit('conversation/setContextItems', [
        { service: 'Births', serviceKey: 'births', source: 'quickHelp', id: 'births', category: '2', selected: true }
      ]);

      wrapper.vm.$i18n.locale = 'fr';
      await vm.$nextTick();
      await flushPromises();

      expect(vm.selectedContextItems[0].service).toBe('Naissances');
      // Identity and labels are untouched: only the display moved.
      expect(vm.selectedContextItems[0].id).toBe('births');
      expect(vm.selectedContextItems[0].serviceKey).toBe('births');
    });

    it('pressing a card is a MODE SWITCH: the sidebar selection is replaced, not unioned', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const tree = [
        {
          catKey: '1',
          name: 'Agriculture',
          nameEN: 'Agriculture',
          children: [{ name: 'Cultivos', nameEN: 'Crops' }]
        },
        {
          catKey: '2',
          name: 'État civil',
          nameEN: 'Civil Registry',
          children: [{ name: 'Naissances', nameEN: 'Births' }]
        }
      ];
      mockLiveTree(tree);
      vm.serviceCategories = tree;
      vm.serviceCategoriesStatus = 'loaded';

      // A sidebar service is selected, then a card of ANOTHER category is
      // pressed. Keeping both sent the card's category and the sidebar's
      // service label together — the wire's service-wins rule then
      // dropped the category the card promised, and the two platforms
      // disagreed (the mobile replaces). One scope at a time.
      vm.$store.commit('conversation/setContextItems', [
        { service: 'Naissances', serviceKey: 'Births', source: 'sidebar', category: '2', selected: true }
      ]);
      vm.quickHelpButtons = [
        { id: 'crops', service: 'Crops card', serviceLabels: [], serviceKey: 'crops', category: '1', icon: 'x' }
      ];

      vm.selectQuickHelpOption(vm.quickHelpButtons[0]);

      expect(vm.selectedContextItems).toHaveLength(1);
      expect(vm.selectedContextItems[0].id).toBe('crops');
      // And the follow-up carries the CARD's scope alone.
      expect(vm.currentCategoryId).toBe('1');
    });

    it('a locale switch REFETCHES the tree — the assurer alone would serve the old locale', async () => {
      const tree = [
        { catKey: '2', name: 'Impuestos', nameEN: 'Taxes', children: [{ name: 'Declaración', nameEN: 'Tax Filing' }] }
      ];
      mockLiveTree(tree);
      const wrapper = await createChatBotWrapperAsync(tree);
      const vm = wrapper.vm;
      expect(vm.serviceCategoriesStatus).toBe('loaded');

      const serviceTreeService = require('../../services/serviceTreeService');
      serviceTreeService.getAllCategories.mockClear();
      wrapper.vm.$i18n.locale = 'fr';
      await vm.$nextTick();
      await flushPromises();

      // The names are per-locale tree data: a locale switch without a
      // refetch keeps the OLD locale's names for the whole session (the
      // assurer no-ops once a load succeeded).
      expect(serviceTreeService.getAllCategories).toHaveBeenCalledTimes(1);
    });

    it("a STALE tree response cannot install over a newer locale's tree", async () => {
      const serviceTreeService = require('../../services/serviceTreeService');
      let releaseFirst;
      const heldFirst = new Promise((resolve) => {
        releaseFirst = resolve;
      });
      mockLiveTree([{ catKey: '2', name: 'EN name', nameEN: 'Taxes', children: [] }]);
      const wrapper = await createChatBotWrapperAsync([
        { catKey: '2', name: 'EN name', nameEN: 'Taxes', children: [] }
      ]);
      const vm = wrapper.vm;

      // A Quick Help chip is live before the switches: its title is
      // per-locale config text, and the stale load's own remap must not
      // re-title it in a locale the installed tree does not speak.
      vm.cachedConfig = {
        features: {
          chat: {
            quickHelp: {
              buttons: [{ id: 'b', title: { en: 'EN', fr: 'FR', es: 'ES' }, category: '2' }]
            }
          }
        }
      };
      vm.applyQuickHelpButtons();
      vm.$store.commit('conversation/setContextItems', [
        { service: 'EN', serviceKey: 'b', source: 'quickHelp', id: 'b', category: '2', selected: true }
      ]);

      // Two locale switches in a row: the FIRST fetch is slow, the
      // second fast. The slower OLD request landing last must not
      // install its tree over the newer locale's.
      serviceTreeService.getAllCategories.mockImplementationOnce(() => heldFirst);
      wrapper.vm.$i18n.locale = 'fr';
      await vm.$nextTick();
      serviceTreeService.getAllCategories.mockImplementationOnce(() =>
        Promise.resolve([{ catKey: '2', name: 'ES name', nameEN: 'Taxes', children: [] }])
      );
      wrapper.vm.$i18n.locale = 'es';
      await vm.$nextTick();
      await flushPromises();
      expect(vm.serviceCategories[0].name).toBe('ES name');

      releaseFirst([{ catKey: '2', name: 'FR name (stale)', nameEN: 'Taxes', children: [] }]);
      await flushPromises();
      await flushPromises();

      expect(vm.serviceCategories[0].name).toBe('ES name');
      // The stale load's .then fired its remap on release: the chip
      // carries the CURRENT locale's title, not the stale French one.
      expect(vm.selectedContextItems[0].service).toBe('ES');
    });

    it('chips re-map AFTER the per-locale tree lands, not against the old one', async () => {
      const serviceTreeService = require('../../services/serviceTreeService');
      let releaseFetch;
      const heldFetch = new Promise((resolve) => {
        releaseFetch = resolve;
      });
      // The EN tree is loaded; the FR fetch is held back.
      mockLiveTree([{ catKey: '2', name: 'Taxes', nameEN: 'Taxes', children: [] }]);
      const wrapper = await createChatBotWrapperAsync([{ catKey: '2', name: 'Taxes', nameEN: 'Taxes', children: [] }]);
      const vm = wrapper.vm;

      vm.$store.commit('conversation/setContextItems', [
        { service: 'Taxes', serviceKey: null, categoryOnly: true, category: '2', selected: true }
      ]);

      serviceTreeService.getAllCategories.mockImplementation(() => heldFetch);
      wrapper.vm.$i18n.locale = 'fr';
      await vm.$nextTick();
      await flushPromises();

      // The FR fetch has not landed: the chip still carries the EN name —
      // re-mapping NOW would read the old tree's indexes.
      expect(vm.selectedContextItems[0].service).toBe('Taxes');

      releaseFetch([{ catKey: '2', name: 'Impôts', nameEN: 'Taxes', children: [] }]);
      await flushPromises();
      await flushPromises();

      // The fetch landed: the chip shows the tree's FR name.
      expect(vm.selectedContextItems[0].service).toBe('Impôts');
    });

    it('a locale switch re-resolves a CATEGORY-ONLY chip, not the stale name', async () => {
      const tree = [
        { catKey: '2', name: 'Impuestos', nameEN: 'Taxes', children: [] },
        { catKey: '2', name: 'Impuestos (fr)', nameEN: 'Taxes', children: [] }
      ];
      mockLiveTree(tree);
      const wrapper = await createChatBotWrapperAsync(tree);
      const vm = wrapper.vm;

      // A categoryOnly chip has no serviceKey: the watcher's EN-label
      // branch has nothing to resolve and fell back to the OLD locale's
      // name. The category's display name is what the chip is.
      vm.$store.commit('conversation/setContextItems', [
        { service: 'Impuestos', serviceKey: null, categoryOnly: true, category: '2', selected: true }
      ]);

      vm.loadServiceCategories = jest.fn().mockResolvedValue(); // the reload would overwrite the fr tree mock below
      const frTree = [{ catKey: '2', name: 'Impuestos (fr)', nameEN: 'Taxes', children: [] }];
      vm.serviceCategories = frTree;
      wrapper.vm.$i18n.locale = 'fr';
      await vm.$nextTick();
      await flushPromises();

      expect(vm.selectedContextItems[0].service).toBe('Impuestos (fr)');
    });

    it('a FAILED hierarchy load is retried, not cached for the session', async () => {
      const serviceTreeService = require('../../services/serviceTreeService');
      serviceTreeService.getAllCategories
        .mockRejectedValueOnce(new Error('down'))
        .mockResolvedValueOnce([{ catKey: '2', name: 'Crops', nameEN: 'Crops', children: [] }]);
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      await flushPromises();
      expect(vm.serviceCategoriesStatus).toBe('failed');

      await vm.ensureServiceCategoriesLoaded();
      await flushPromises();

      expect(vm.serviceCategoriesStatus).toBe('loaded');
      expect(serviceTreeService.getAllCategories).toHaveBeenCalledTimes(2);
    });

    it('a category-less card is not refused at send time when the hierarchy failed', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      vm.serviceCategoriesStatus = 'failed';

      // The grid treats a category-less card as scope-free (usable); the
      // send guard must agree — 'general' is the placeholder such a
      // selection is stored under, and it names no category.
      const item = {
        id: 'free',
        service: 'Free chat',
        serviceLabels: [],
        source: 'quickHelp',
        category: 'general',
        selected: true
      };
      const state = vm.quickHelpScopeState(item);
      expect(state.broken).toBe(false);
      expect(vm.checkContextConfig({ categoryLabel: null, serviceLabels: [] })).toBe(true);
    });

    it('one refused send shows ONE scopeNotNameable toast, not two', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const notificationService = require('../../services/notificationService');
      notificationService.error.mockClear();

      // A sidebar item with a set category and NO serviceKey trips BOTH
      // the no-filter refusal and the unnamed-item refusal — the user
      // clicked once; they get one toast, not two identical ones.
      vm.$store.commit('conversation/setContextItems', [
        { service: 'Naissances', serviceKey: null, source: 'sidebar', category: '2', selected: true }
      ]);
      vm.checkContextConfig({ categoryLabel: null, serviceLabels: [] });

      const calls = notificationService.error.mock.calls.filter(
        (c) => c[0] === vm.translate('chatbot.scopeNotNameable', '')
      );
      expect(calls).toHaveLength(1);
    });

    it('a DEAD restored tag re-resolves when a later load names it again', async () => {
      const tree = [
        {
          catKey: '2',
          name: 'État civil',
          nameEN: 'Civil Registry',
          children: [{ name: 'Naissances', nameEN: 'Births' }]
        }
      ];
      mockLiveTree(tree);
      const wrapper = await createChatBotWrapperAsync(tree);
      const vm = wrapper.vm;

      // The conversation was saved with two tags; one was renamed away
      // AT RESTORE TIME (the tree had not caught up), the other is live.
      const chatHistoryService = require('../../services/chatHistoryService');
      chatHistoryService.getConversation.mockResolvedValueOnce({
        _key: 'c14',
        title: 'Saved',
        messages: [],
        tags: ['Births', 'Renamed Away'],
        categories: []
      });
      await vm.loadExistingConversation('c14');
      expect(vm.selectedContextItems.some((i) => i.unresolved)).toBe(true);

      // The hierarchy catches up (a locale switch refetches it): the
      // tag is a label of the live tree again, and the chip re-resolves
      // instead of refusing forever.
      const serviceTreeService = require('../../services/serviceTreeService');
      serviceTreeService.getAllCategories.mockImplementation(() =>
        Promise.resolve([
          {
            catKey: '2',
            name: 'État civil',
            nameEN: 'Civil Registry',
            children: [
              { name: 'Naissances', nameEN: 'Births' },
              { name: 'Renommé', nameEN: 'Renamed Away' }
            ]
          }
        ])
      );
      wrapper.vm.$i18n.locale = 'fr';
      await vm.$nextTick();
      await flushPromises();
      await flushPromises();

      expect(vm.selectedContextItems.some((i) => i.unresolved)).toBe(false);
      expect(vm.selectedContextItems.some((i) => i.serviceKey === 'Renamed Away')).toBe(true);
    });

    it('a DEAD restored tag beside a live label refuses the send, not rides along', async () => {
      const tree = [
        {
          catKey: '2',
          name: 'État civil',
          nameEN: 'Civil Registry',
          children: [{ name: 'Naissances', nameEN: 'Births' }]
        }
      ];
      mockLiveTree(tree);
      const wrapper = await createChatBotWrapperAsync(tree);
      const vm = wrapper.vm;

      // One tag resolves (Births), one names nothing anymore. The dead
      // chip rode along under the 'general' placeholder — the no-filter
      // rule stayed quiet as soon as the live label provided a filter,
      // and the send silently dropped the dead tag's scope.
      const chatHistoryService = require('../../services/chatHistoryService');
      chatHistoryService.getConversation.mockResolvedValueOnce({
        _key: 'c13',
        title: 'Saved',
        messages: [],
        tags: ['Births', 'Renamed Away'],
        categories: []
      });

      await vm.loadExistingConversation('c13');

      expect(vm.selectedContextItems).toHaveLength(2);
      // The send is REFUSED: no partial drop of a saved scope.
      expect(vm.checkContextConfig({ categoryLabel: null, serviceLabels: ['Births'] })).toBe(false);
    });

    it('a LEGACY category.<id> tag restores the category scope, not a dead chip', async () => {
      const tree = [{ catKey: '2', name: 'Cultivos', nameEN: 'Crops', children: [] }];
      mockLiveTree(tree);
      const wrapper = await createChatBotWrapperAsync(tree);
      const vm = wrapper.vm;

      // Conversations saved before the redesign carry 'category.<id>' —
      // the old restore's spelling for a category-only scope. The id
      // still names the category through the live tree, so the scope
      // restores as what it was. Restoring it as a label chip made the
      // conversation refuse EVERY follow-up.
      const chatHistoryService = require('../../services/chatHistoryService');
      chatHistoryService.getConversation.mockResolvedValueOnce({
        _key: 'c11',
        title: 'Saved',
        messages: [],
        tags: ['category.2'],
        categories: []
      });

      await vm.loadExistingConversation('c11');

      expect(vm.selectedContextItems).toHaveLength(1);
      expect(vm.selectedContextItems[0].categoryOnly).toBe(true);
      expect(vm.selectedContextItems[0].serviceKey).toBeNull();
      expect(vm.selectedContextItems[0].category).toBe('2');
      expect(vm.currentCategoryId).toBe('2');
      // And the follow-up carries the category's EN label, not a dead tag.
      expect(vm.getCategoryEnLabel(vm.currentCategoryId)).toBe('Crops');
      expect(vm.getContextTags()).toEqual([]);
    }, 15000);

    it('a LEGACY category.general tag names no scope and restores nothing', async () => {
      const tree = [{ catKey: '2', name: 'Cultivos', nameEN: 'Crops', children: [] }];
      mockLiveTree(tree);
      const wrapper = await createChatBotWrapperAsync(tree);
      const vm = wrapper.vm;

      // 'general' is the placeholder a category-less selection was stored
      // under — it names no category in every rule, the legacy spelling
      // included.
      const chatHistoryService = require('../../services/chatHistoryService');
      chatHistoryService.getConversation.mockResolvedValueOnce({
        _key: 'c12',
        title: 'Saved',
        messages: [],
        tags: ['category.general'],
        categories: []
      });

      await vm.loadExistingConversation('c12');

      expect(vm.selectedContextItems).toHaveLength(0);
    }, 15000);

    it('a category-scoped conversation with NO tags restores its scope', async () => {
      const tree = [{ catKey: '2', name: 'Cultivos', nameEN: 'Crops', children: [] }];
      mockLiveTree(tree);
      const wrapper = await createChatBotWrapperAsync(tree);
      const vm = wrapper.vm;

      // The backend ALWAYS returns tags: [] (an array), so the category
      // branch behind `else if` never fired — the conversation reopened
      // unscoped and its follow-up was answered from the whole corpus.
      const chatHistoryService = require('../../services/chatHistoryService');
      chatHistoryService.getConversation.mockResolvedValueOnce({
        _key: 'c10',
        title: 'Saved',
        messages: [],
        tags: [],
        categories: [{ _key: '2', nameEN: 'Crops' }]
      });

      await vm.loadExistingConversation('c10');

      expect(vm.currentCategoryId).toBe('2');
      expect(vm.selectedContextItems).toHaveLength(1);
      expect(vm.selectedContextItems[0].categoryOnly).toBe(true);
      // A follow-up would carry the category's EN label.
      expect(vm.getCategoryEnLabel(vm.currentCategoryId)).toBe('Crops');
    });

    it('a composer entry with a category keeps its scope on the wire', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // A deployment adds a card with placement 'composer' AND a
      // category: the welcome composer's send used to drop the scope
      // (hardcoded empty labels, nulled category) and the query left
      // unfiltered while the chip showed the card.
      const tree = [{ catKey: '2', name: 'Cultivos', nameEN: 'Crops', children: [] }];
      mockLiveTree(tree);
      vm.serviceCategories = tree;
      vm.serviceCategoriesStatus = 'loaded';
      vm.quickHelpButtons = [
        {
          id: 'crops-entry',
          service: 'Crops card',
          serviceLabels: ['Crops'],
          serviceKey: 'crops-entry',
          category: '2',
          placement: 'composer',
          icon: 'x'
        }
      ];
      vm.newMessage = '¿Qué hay?';

      vm.handleWelcomeSend();

      expect(vm.currentCategoryId).toBe('2');
      const item = vm.selectedContextItems.find((i) => i.id === 'crops-entry');
      expect(item).toBeDefined();
      expect(item.serviceLabels).toEqual(['Crops']);
      expect(mockSubmitQueryStream).toHaveBeenCalled();
      const payload = mockSubmitQueryStream.mock.calls.at(-1)[0];
      expect(payload.context.categoryLabel).toBe('Crops');
      expect(payload.context.serviceLabels).toEqual(['Crops']);
    });

    it('a composer entry refused while the hierarchy is still LOADING says so, not "could not be loaded"', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const notificationService = require('../../services/notificationService');
      notificationService.error.mockClear();

      vm.serviceCategories = [];
      vm.serviceCategoriesStatus = 'loading';
      vm.quickHelpButtons = [
        {
          id: 'crops-entry',
          service: 'Crops card',
          serviceLabels: [],
          serviceKey: 'crops-entry',
          category: '2',
          placement: 'composer',
          icon: 'x'
        }
      ];
      vm.newMessage = '¿Qué hay?';

      vm.handleWelcomeSend();

      expect(mockSubmitQueryStream).not.toHaveBeenCalled();
      const lastError = notificationService.error.mock.calls.at(-1)[0];
      // The hierarchy is ON ITS WAY — naming a configuration problem
      // points the operator at the wrong thing. And the copy is the
      // CHAT's own, not the admin panel's: the toast is read by the
      // person whose question was held, not by an operator. (The
      // wrapper's $t mock returns the key; the KEY is what
      // distinguishes the two copies.)
      expect(lastError).toBe('chatbot.loading');
    });

    it('two services sharing a DISPLAY name are two scopes (identity is the EN key)', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // Same localized display name, different EN names, same category:
      // the dedup keyed on the display swallowed the second pick while
      // the panel highlighted it — and the deselection removed the wrong
      // chip.
      vm.$store.commit('conversation/setContextItems', [
        { service: 'Registro', serviceKey: 'Registry Births', source: 'sidebar', category: '2', selected: true }
      ]);
      vm.handleTreeNodeSelected({ service: 'Registro', serviceKey: 'Registry Taxes', category: '2', selected: true });

      expect(vm.selectedContextItems).toHaveLength(2);
      const keys = vm.selectedContextItems.map((i) => i.serviceKey).sort();
      expect(keys).toEqual(['Registry Births', 'Registry Taxes']);
    });

    it('a PROMPT-ONLY composer entry arms its prompt, not the raw text', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const tree = [{ catKey: '2', name: 'Cultivos', nameEN: 'Crops', children: [] }];
      mockLiveTree(tree);
      vm.serviceCategories = tree;
      vm.serviceCategoriesStatus = 'loaded';
      vm.quickHelpButtons = [
        {
          id: 'persona-entry',
          service: 'Persona card',
          serviceLabels: [],
          serviceKey: 'persona-entry',
          placement: 'composer',
          icon: 'x',
          hiddenPrompt: 'Answer as a domain advisor.'
        }
      ];
      vm.newMessage = 'a plain question';

      vm.handleWelcomeSend();

      expect(mockSubmitQueryStream).toHaveBeenCalled();
      const payload = mockSubmitQueryStream.mock.calls.at(-1)[0];
      expect(payload.messages.at(-1).content).toBe('Answer as a domain advisor.');
      expect(payload.userQuestion).toBe('a plain question');
    });

    it("removing a non-last chip moves the category to the remaining scope's own", async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // Two chips of DIFFERENT categories; the first (whose category the
      // id tracked) is removed: the id must follow the survivor, or the
      // saved conversation names a category nothing in it belongs to.
      vm.$store.commit('conversation/setContextItems', [
        { service: 'A', serviceKey: 'A EN', source: 'sidebar', category: '1', selected: true },
        { service: 'B', serviceKey: 'B EN', source: 'sidebar', category: '2', selected: true }
      ]);
      vm.currentCategoryId = '1';

      vm.removeContextItem(0);

      expect(vm.currentCategoryId).toBe('2');
    });

    it('a saved just-chat tag rebuilds even when the config dropped the entry', async () => {
      const tree = [{ catKey: '2', name: 'Cultivos', nameEN: 'Crops', children: [] }];
      mockLiveTree(tree);
      const wrapper = await createChatBotWrapperAsync(tree);
      const vm = wrapper.vm;

      const chatHistoryService = require('../../services/chatHistoryService');
      chatHistoryService.getConversation.mockResolvedValueOnce({
        _key: 'c15',
        title: 'Saved',
        messages: [],
        tags: ['just-chat'],
        categories: []
      });
      await vm.loadExistingConversation('c15');

      const item = vm.selectedContextItems.find((i) => i.id === 'just-chat');
      expect(item).toBeDefined();
      // And it does not refuse the send: just-chat is unfiltered BY DESIGN.
      expect(vm.checkContextConfig({ categoryLabel: null, serviceLabels: [] })).toBe(true);
    });

    it('selecting a sidebar service REPLACES a live card chip (the mode switch is symmetric)', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const tree = [
        { catKey: '1', name: 'Agriculture', nameEN: 'Agriculture', children: [] },
        {
          catKey: '2',
          name: 'État civil',
          nameEN: 'Civil Registry',
          children: [{ name: 'Naissances', nameEN: 'Births' }]
        }
      ];
      mockLiveTree(tree);
      vm.serviceCategories = tree;
      vm.serviceCategoriesStatus = 'loaded';

      // A card chip is live; the user then picks a sidebar service. Both
      // directions of the mode switch rule: the pick replaces the card,
      // exactly as the card press replaces the pick.
      vm.$store.commit('conversation/setContextItems', [
        {
          service: 'Crops card',
          serviceKey: 'crops',
          source: 'quickHelp',
          id: 'crops',
          serviceLabels: [],
          category: '1',
          selected: true
        }
      ]);
      vm.currentCategoryId = '1';

      vm.handleTreeNodeSelected({ service: 'Naissances', serviceKey: 'Births', category: '2', selected: true });

      expect(vm.selectedContextItems).toHaveLength(1);
      expect(vm.selectedContextItems[0].serviceKey).toBe('Births');
      // The category moved to the pick's own.
      expect(vm.currentCategoryId).toBe('2');
    });

    it('a composer entry with a hiddenPrompt sends it, not the typed text', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const tree = [{ catKey: '2', name: 'Cultivos', nameEN: 'Crops', children: [] }];
      mockLiveTree(tree);
      vm.serviceCategories = tree;
      vm.serviceCategoriesStatus = 'loaded';
      vm.quickHelpButtons = [
        {
          id: 'crops-entry',
          service: 'Crops card',
          serviceLabels: ['Crops'],
          serviceKey: 'crops-entry',
          category: '2',
          placement: 'composer',
          icon: 'x',
          hiddenPrompt: 'You are a crops advisor. Answer in the declared scope.'
        }
      ];
      vm.newMessage = '¿Qué hay?';

      vm.handleWelcomeSend();

      expect(mockSubmitQueryStream).toHaveBeenCalled();
      const payload = mockSubmitQueryStream.mock.calls.at(-1)[0];
      // The typed text is what the user SEES; the configured hidden
      // prompt is what the LLM answers. The tile path always did this.
      // (A scoped send carries the turn inside `messages`.)
      expect(payload.messages.at(-1).content).toBe('You are a crops advisor. Answer in the declared scope.');
      expect(payload.userQuestion).toBe('¿Qué hay?');
      const userTurn = vm.openMessages.filter((m) => m.sender === 'user').at(-1);
      expect(userTurn.content).toBe('¿Qué hay?');
    });

    it('a composer entry send is a MODE SWITCH too: the sidebar selection is replaced', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const tree = [
        { catKey: '1', name: 'Agriculture', nameEN: 'Agriculture', children: [{ name: 'Cultivos', nameEN: 'Crops' }] },
        {
          catKey: '2',
          name: 'État civil',
          nameEN: 'Civil Registry',
          children: [{ name: 'Naissances', nameEN: 'Births' }]
        }
      ];
      mockLiveTree(tree);
      vm.serviceCategories = tree;
      vm.serviceCategoriesStatus = 'loaded';
      vm.quickHelpButtons = [
        {
          id: 'crops-entry',
          service: 'Crops card',
          serviceLabels: [],
          serviceKey: 'crops-entry',
          category: '1',
          placement: 'composer',
          icon: 'x'
        }
      ];
      // A sidebar service of ANOTHER category is selected first.
      vm.$store.commit('conversation/setContextItems', [
        { service: 'Naissances', serviceKey: 'Births', source: 'sidebar', category: '2', selected: true }
      ]);
      vm.newMessage = '¿Qué hay?';

      vm.handleWelcomeSend();

      const item = vm.selectedContextItems.find((i) => i.id === 'crops-entry');
      expect(item).toBeDefined();
      // The card REPLACED the sidebar selection: no union on the wire.
      expect(vm.selectedContextItems).toHaveLength(1);
      expect(mockSubmitQueryStream).toHaveBeenCalled();
      const payload = mockSubmitQueryStream.mock.calls.at(-1)[0];
      expect(payload.context.serviceLabels).toEqual([]);
      expect(payload.context.categoryLabel).toBe('Agriculture');
    });

    it('a BARE-STRING serviceLabels config typo is ONE label, not a scope-less card', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const tree = [
        {
          catKey: '2',
          name: 'État civil',
          nameEN: 'Civil Registry',
          children: [{ name: 'Naissances', nameEN: 'Births' }]
        }
      ];
      mockLiveTree(tree);
      vm.serviceCategories = tree;
      vm.serviceCategoriesStatus = 'loaded';

      // The config declares a bare string where the array belongs. The
      // backend wire rule reads a bare string as ONE label — never as an
      // empty scope — and the card must agree: mapping the typo to null
      // made the card look healthy and sent the question UNFILTERED.
      vm.cachedConfig = {
        features: {
          chat: {
            quickHelp: {
              buttons: [{ id: 'typo', title: 'Typo card', category: '2', serviceLabels: 'Births' }]
            }
          }
        }
      };
      vm.applyQuickHelpButtons();
      vm.quickHelpButtons[0].placement = 'composer';
      vm.newMessage = '¿Qué hay?';

      vm.handleWelcomeSend();

      const payload = mockSubmitQueryStream.mock.calls.at(-1)[0];
      expect(payload.context.serviceLabels).toEqual(['Births']);
    });

    it('a composer entry with LABELS but no category keeps its scope on the wire', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const tree = [
        {
          catKey: '2',
          name: 'État civil',
          nameEN: 'Civil Registry',
          children: [{ name: 'Naissances', nameEN: 'Births' }]
        }
      ];
      mockLiveTree(tree);
      vm.serviceCategories = tree;
      vm.serviceCategoriesStatus = 'loaded';
      // Declares LABELS, no category: the tile path scopes by them; the
      // composer gate keyed on the category alone fell to the else
      // branch, stripped the Quick Help context and sent UNFILTERED.
      vm.quickHelpButtons = [
        {
          id: 'births-entry',
          service: 'Births card',
          serviceLabels: ['Births'],
          serviceKey: 'births-entry',
          placement: 'composer',
          icon: 'x'
        }
      ];
      vm.newMessage = '¿Qué hay?';

      vm.handleWelcomeSend();

      const item = vm.selectedContextItems.find((i) => i.id === 'births-entry');
      expect(item).toBeDefined();
      expect(mockSubmitQueryStream).toHaveBeenCalled();
      const payload = mockSubmitQueryStream.mock.calls.at(-1)[0];
      expect(payload.context.serviceLabels).toEqual(['Births']);
    });

    it('a composer entry whose scope cannot be named yet is refused, not sent unfiltered', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // The composer card renders BEFORE the hierarchy settles (the grid
      // waits for it). Pressing it with the tree still loading installed
      // the chip and sent the query — with no EN category label and no
      // labels, the query left UNFILTERED while the chip showed the card.
      vm.serviceCategories = [];
      vm.serviceCategoriesStatus = 'loading';
      vm.quickHelpButtons = [
        {
          id: 'crops-entry',
          service: 'Crops card',
          serviceLabels: [],
          serviceKey: 'crops-entry',
          category: '2',
          placement: 'composer',
          icon: 'x'
        }
      ];
      vm.newMessage = '¿Qué hay?';

      vm.handleWelcomeSend();

      // Nothing installed, nothing sent — the refusal is visible.
      expect(vm.selectedContextItems).toHaveLength(0);
      expect(vm.currentCategoryId).toBeNull();
      expect(mockSubmitQueryStream).not.toHaveBeenCalled();
      const notificationService = require('../../services/notificationService');
      expect(notificationService.error).toHaveBeenCalled();
    });

    it('two configuration cards sharing an id keep only the FIRST', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // The id is the button's IDENTITY: the conversation tag carries it,
      // the restore resolves it, and the grid's verdict map keys on it.
      // Two cards with one id cannot both be honoured — and keeping both
      // made the wire disagree with the verdict: the map judged the FIRST
      // card (healthy) while the click put the CLICKED card's labels on
      // the wire, a dead label among them, and the corpus abstained
      // silently behind a card that looked healthy. The FIRST card wins,
      // the duplicate never becomes a card at all.
      vm.cachedConfig = {
        features: {
          chat: {
            quickHelp: {
              buttons: [
                { id: 'civil', title: { en: 'First' }, category: '2', serviceLabels: ['Births'] },
                { id: 'civil', title: { en: 'Second' }, category: '2', serviceLabels: ['No Such Service'] }
              ]
            }
          }
        }
      };

      vm.applyQuickHelpButtons();

      expect(vm.quickHelpButtons).toHaveLength(1);
      // The FIRST card's scope is what survives — its labels are the ones
      // a click would put on the wire.
      expect(vm.quickHelpButtons[0].service).toBe('First');
      expect(vm.quickHelpButtons[0].serviceLabels).toEqual(['Births']);
    });

    it('a hidden card sharing an id never lends its title to the surviving chip', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // The hidden filter runs BEFORE the dedup, so the surviving card is
      // the first VISIBLE one. The raw config's first entry for the id is
      // the HIDDEN card — and a locale switch re-resolving the chip's
      // title from the raw list would put a hidden card's title on a chip
      // whose scope is the visible card's. The title must come from the
      // DEDUPED list, the one every other reader (grid, click, restore,
      // send guard) already speaks.
      vm.cachedConfig = {
        features: {
          chat: {
            quickHelp: {
              buttons: [
                { id: 'civil', title: { en: 'Hidden first' }, hidden: true, category: '2' },
                { id: 'civil', title: { en: 'Visible second', fr: 'Second visible' }, category: '2' }
              ]
            }
          }
        }
      };
      vm.applyQuickHelpButtons();
      expect(vm.quickHelpButtons).toHaveLength(1);

      // The title is re-resolved from the card that IS, not from the one
      // the deployment hid.
      expect(vm.quickHelpTitleFor({ id: 'civil', service: 'Visible second' }, 'fr')).toBe('Second visible');
    });

    it('a category-only selection is not refused for lacking a service name', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const tree = [{ catKey: '2', name: 'Impuestos', nameEN: 'Taxes', children: [] }];
      mockLiveTree(tree);
      vm.serviceCategories = tree;
      vm.serviceCategoriesStatus = 'loaded';

      // The restored category-only item's scope IS the category — the
      // categoryLabel carries it, and the send must go through.
      vm.$store.commit('conversation/setContextItems', [
        { service: 'Impuestos', serviceKey: null, categoryOnly: true, category: '2', selected: true }
      ]);
      vm.currentCategoryId = '2';

      expect(vm.checkContextConfig({ categoryLabel: 'Taxes', serviceLabels: [] })).toBe(true);
    });

    it('an EMPTY category id declares no scope', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // A cleared selection is not a scope: the hierarchy cannot deny it,
      // and the button must not be reported as broken because of it.
      const button = { id: 'civil', service: 'État civil', serviceLabels: [], category: '', icon: 'x' };
      vm.serviceCategories = [{ catKey: '2', name: 'État civil', nameEN: 'Civil Registry', children: [] }];
      vm.serviceCategoriesStatus = 'loaded';

      expect(vm.quickHelpScopeState(button).broken).toBe(false);
      expect(vm.quickHelpScopeIsNameable('')).toBe(true);
    });

    it('a hierarchy that could not be loaded breaks every scope, and says so', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      vm.serviceCategoriesStatus = 'failed';

      // The hierarchy is what NAMES a scope. Without it, no scope can be
      // verified — and the button must say that, not look healthy and
      // swallow the click.
      const button = { id: 'civil', service: 'État civil', serviceLabels: [], category: '2', icon: 'x' };
      const state = vm.quickHelpScopeState(button);
      expect(state.broken).toBe(true);
      expect(state.unavailable).toBe(true);
      expect(vm.quickHelpErrorCaption(button)).toBe('chatbot.quickHelpScopeUnavailable');
    });

    it('the Quick Help grid waits for the hierarchy before it offers a click', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // A button rendered before the hierarchy is known cannot say whether
      // its scope is valid — and a click it cannot answer is a dead click.
      vm.serviceCategoriesStatus = 'loading';
      await vm.$nextTick();
      expect(wrapper.find('.quick-help-grid').exists()).toBe(false);

      vm.serviceCategoriesStatus = 'loaded';
      await vm.$nextTick();
      expect(wrapper.find('.quick-help-grid').exists()).toBe(true);
    });

    it('a restored scope the hierarchy can no longer name blocks the send', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const tree = [{ catKey: '2', name: 'Crops', nameEN: 'Crops', children: [] }];
      mockLiveTree(tree);
      vm.serviceCategories = tree;
      vm.serviceCategoriesStatus = 'loaded';

      // A conversation saved with a Quick Help scope whose category has
      // left the hierarchy: the scope cannot be named any more, so the
      // query would leave with NO filter — the corpus answering outside
      // the scope the button declared. The send is refused, and the user
      // is told why (the warning goes to admins alone — not enough).
      vm.$store.commit('conversation/setContextItems', [
        {
          service: 'Taxes',
          serviceKey: 'taxes',
          serviceLabels: null,
          source: 'quickHelp',
          id: 'taxes',
          category: '5',
          selected: true
        }
      ]);
      vm.currentCategoryId = '5';

      expect(vm.checkContextConfig({ categoryLabel: null, serviceLabels: [] })).toBe(false);
      expect(mockNotificationError).toHaveBeenCalledWith('chatbot.quickHelpCategoryGone');
    });

    it('restores the category scope of a saved conversation', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // The conversation is linked to its category through an edge, so the
      // key of the category comes back with it. Without it the restored
      // conversation loses the scope it was asked in.
      const chatHistoryService = require('../../services/chatHistoryService');
      chatHistoryService.getConversation.mockResolvedValueOnce({
        _key: 'c1',
        title: 'Saved chat',
        messages: [],
        categories: [{ _key: '2', nameEN: 'Crops' }]
      });

      await vm.loadExistingConversation('c1');

      expect(vm.currentCategoryId).toBe('2');
    });

    it('the wire accessor returns the ENGLISH label; the display accessor the localized one', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // English is the SSOT of the filter wire; the localized name is what
      // the user reads. One lookup, two spellings.
      mockLiveTree([{ catKey: '2', name: 'Impôts', nameEN: 'Taxes' }]);
      vm.serviceCategories = [{ catKey: '2', name: 'Impôts', nameEN: 'Taxes' }];

      expect(vm.getCategoryEnLabel('2')).toBe('Taxes');
      expect(vm.getCategoryDisplayName('2')).toBe('Impôts');
      expect(vm.getCategoryEnLabel('999999')).toBeNull();
      expect(vm.getCategoryDisplayName('999999')).toBeNull();
    });

    it('a restored category-only scope puts no synthetic label on the wire', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const tree = [{ catKey: '2', name: 'Cultivos', nameEN: 'Crops', children: [] }];
      mockLiveTree(tree);
      vm.serviceCategories = tree;
      vm.serviceCategoriesStatus = 'loaded';

      // A conversation linked to its category but carrying no tags: the
      // restored scope IS the category. 'category.<id>' is not a label —
      // it must never reach the wire as a filter (it matches no chunk and
      // the query would abstain instead of answering from the category).
      const chatHistoryService = require('../../services/chatHistoryService');
      chatHistoryService.getConversation.mockResolvedValueOnce({
        _key: 'c9',
        title: 'Saved',
        messages: [],
        categories: [{ _key: '2', nameEN: 'Crops' }]
      });

      await vm.loadExistingConversation('c9');

      const item = vm.selectedContextItems[0];
      expect(item.categoryOnly).toBe(true);
      expect(item.serviceKey).toBeNull();
    });

    it('refuses the send when the picked entity carries no EN translation', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // An entity without an EN translation has no filterable label at all:
      // the localized name matches no chunk. Sending anyway would either
      // leak it as a label (the old bug) or silently widen the query to
      // the whole category — both are out. The send is refused, visibly.
      const tree = [
        {
          catKey: '2',
          name: 'Cultivos',
          nameEN: 'Crops',
          children: [{ name: 'Impuestos', nameEN: null }]
        }
      ];
      mockLiveTree(tree);
      vm.serviceCategories = tree;
      vm.handleTreeNodeSelected({
        category: '2',
        service: 'Impuestos',
        serviceKey: null,
        selected: true
      });
      vm.currentCategoryId = '2';
      vm.newMessage = '¿Cuánto es?';

      await vm.sendMessage();

      expect(mockSubmitQueryStream).not.toHaveBeenCalled();
      expect(mockNotificationError).toHaveBeenCalledWith('chatbot.scopeNotNameable');
    });

    it('restores a Quick Help card with the category scope it was asked in', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // The card knows its own category. A conversation saved with it may
      // carry no category edge (the chat was started before the card was
      // used) — the restored scope is the card's.
      const tree = [{ catKey: '5', name: 'Impuestos', nameEN: 'Taxes' }];
      mockLiveTree(tree);
      vm.serviceCategories = tree;
      const loadConfig = require('../../config-loader').default;
      loadConfig.mockResolvedValue({
        features: {
          chat: {
            quickHelp: {
              buttons: [
                {
                  id: 'taxes',
                  title: { en: 'Taxes' },
                  category: '5',
                  serviceLabels: []
                }
              ]
            }
          }
        }
      });
      const chatHistoryService = require('../../services/chatHistoryService');
      chatHistoryService.getConversation.mockResolvedValueOnce({
        _key: 'c1',
        title: 'Saved chat',
        messages: [],
        tags: ['taxes']
      });

      await vm.loadExistingConversation('c1');

      expect(vm.currentCategoryId).toBe('5');
    });

    it('shows the localized name of a restored scope, and sends the ENGLISH one', async () => {
      // A conversation carries the EN label (a locale-independent identity);
      // the chip shows the localized name the tree carries for it.
      const tree = [{ catKey: '2', name: 'Impôts', nameEN: 'Taxes' }];
      mockLiveTree(tree);
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const chatHistoryService = require('../../services/chatHistoryService');
      chatHistoryService.getConversation.mockResolvedValueOnce({
        _key: 'c1',
        title: 'Saved chat',
        messages: [],
        categories: [{ _key: '2', nameEN: 'Taxes' }]
      });

      await vm.loadExistingConversation('c1');

      expect(vm.selectedContextItems[0].service).toBe('Impôts');

      vm.newMessage = 'suite';
      await vm.sendMessage();
      const payload = mockSubmitQueryStream.mock.calls[0][0];
      expect(payload.context.categoryLabel).toBe('Taxes');
    });

    it('checkContextConfig blocks a Category NN label for every user', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // The block is user-independent: an unresolved category id filters the
      // corpus down to nothing, whoever asks.
      expect(vm.checkContextConfig({ categoryLabel: 'Category 123', serviceLabels: [] })).toBe(false);

      wrapper.vm.$store.commit('SET_USER', { ...vm.$store.getters.currentUser, roles: ['admin'] });

      expect(vm.checkContextConfig({ categoryLabel: 'Category 123', serviceLabels: [] })).toBe(false);
    });

    it('checkContextConfig blocks when context items present but no filter active', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // Misconfig symptom: a sidebar context item exists but resolved to no
      // labels. A Quick Help item is exempt — it scopes the answer with its
      // own prompt, and every shipped button declares no labels at all.
      vm.$store.commit('conversation/setContextItems', [
        { service: 'Broken', serviceKey: '', serviceLabels: null, source: 'sidebar', selected: true }
      ]);

      const result = vm.checkContextConfig({
        categoryLabel: null,
        serviceLabels: []
      });

      expect(result).toBe(false);
    });

    it('checkContextConfig does not warn about a missing filter for a Quick Help item', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // A Quick Help button carries its own prompt. Blocking it because it
      // declares no label would make the button do nothing at all — and the
      // query is allowed, so there is nothing to warn the admin about either.
      wrapper.vm.$store.commit('SET_USER', { ...vm.$store.getters.currentUser, roles: ['admin'] });

      vm.$store.commit('conversation/setContextItems', [
        {
          service: 'Apply for ID',
          serviceKey: 'identity-civil',
          serviceLabels: null,
          source: 'quickHelp',
          selected: true
        }
      ]);

      const result = vm.checkContextConfig({
        categoryLabel: null,
        serviceLabels: []
      });

      expect(result).toBe(true);
      expect(mockNotificationWarning).not.toHaveBeenCalled();
    });

    it('checkContextConfig blocks when a Quick Help item hides a misconfigured item', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // The Quick Help exemption covers the Quick Help item only. Another
      // selected item that declares no label is a misconfiguration, and the
      // query it would produce is unfiltered.
      vm.$store.commit('conversation/setContextItems', [
        {
          service: 'Apply for ID',
          serviceKey: 'identity-civil',
          serviceLabels: null,
          source: 'quickHelp',
          selected: true
        },
        { service: 'Broken', serviceKey: '', serviceLabels: null, source: 'sidebar', selected: true }
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

    it('query-build uses the declared labels of a Quick Help item and the key of a sidebar item', async () => {
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

      vm.newMessage = 'When do I plant tomatoes?';
      await vm.sendMessage();

      const payload = mockSubmitQueryStream.mock.calls[mockSubmitQueryStream.mock.calls.length - 1][0];
      expect(payload.context.serviceLabels).toEqual(['Tomato', 'Onion', 'Tomato']);
    });

    it('Quick Help button that declares no labels sends no label filter', async () => {
      mockLiveTree(treeCarrying({ 1: ['Tomato', 'Onion'] }));
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      vm.serviceCategories = treeCarrying({ 1: ['Tomato', 'Onion'] });

      // Every shipped button config declares no `serviceLabels`. The button id
      // is not a knowledge label: sending it filtered the corpus down to zero
      // documents and left the LLM with no context at all.
      vm.selectQuickHelpOption({
        service: 'Apply for ID',
        serviceLabels: null,
        serviceKey: 'identity-civil',
        id: 'identity-civil',
        category: '1'
      });

      vm.newMessage = 'How do I apply for an ID card?';
      await vm.sendMessage();

      expect(mockSubmitQueryStream).toHaveBeenCalled();
      const payload = mockSubmitQueryStream.mock.calls[mockSubmitQueryStream.mock.calls.length - 1][0];
      expect(payload.context.serviceLabels).toEqual([]);
    });

    it('Quick Help button that declares labels sends exactly those labels', async () => {
      mockLiveTree(treeCarrying({ 1: ['Tomato', 'Onion'] }));
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      vm.serviceCategories = treeCarrying({ 1: ['Tomato', 'Onion'] });

      vm.selectQuickHelpOption({
        service: 'Grow',
        serviceLabels: ['Tomato', 'Onion'],
        serviceKey: 'Tomato',
        id: 'grow',
        category: '1'
      });

      vm.newMessage = 'How do I grow tomatoes?';
      await vm.sendMessage();

      expect(mockSubmitQueryStream).toHaveBeenCalled();
      const payload = mockSubmitQueryStream.mock.calls[mockSubmitQueryStream.mock.calls.length - 1][0];
      expect(payload.context.serviceLabels).toEqual(['Tomato', 'Onion']);
    });

    it('sidebar item still contributes its service key as a label', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.$store.commit('conversation/setContextItems', [
        { service: 'Tomate', serviceKey: 'Tomato', serviceLabels: null, source: 'sidebar', selected: true }
      ]);

      vm.newMessage = 'When do I plant tomatoes?';
      await vm.sendMessage();

      expect(mockSubmitQueryStream).toHaveBeenCalled();
      const payload = mockSubmitQueryStream.mock.calls[mockSubmitQueryStream.mock.calls.length - 1][0];
      expect(payload.context.serviceLabels).toEqual(['Tomato']);
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
      // The hierarchy BEFORE the mount: the component reads it while
      // mounting, and the chip's label must be one of its labels or the
      // scope cannot be named. This test used to inherit a tree from a
      // previous one — and passed vacuously, its first question being
      // refused before it ever reached the model.
      mockLiveTree(treeCarrying({ 1: ['Tomato'] }));
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

    // A load clears the chips and the transcript BEFORE it awaits, so
    // the welcome grid is clickable while the fetch is still in flight —
    // and a user action in that window is the user SAYING which scope
    // they want. The restore of the loading conversation must not land
    // over it. (The mobile platform closes the same window with its
    // scope epoch; the web's view-ownership token serves the same role.)
    //
    // MUTATION CHECK: delete the loadSeq bump in switchToQuickHelpMode
    // (card-press test) / in handleTreeNodeSelected (sidebar test) and
    // each test fails — the restore replaces the user's chip and takes
    // over the conversation id.
    describe('a user action during a load window supersedes the restore', () => {
      const pressCard = async () => {
        mockLiveTree(treeCarrying({ 2: ['Births'] }));
        const wrapper = createChatBotWrapper();
        const vm = wrapper.vm;
        await vm.ensureServiceCategoriesLoaded();
        // The card carries a hidden prompt; the send is not what is under
        // test here.
        const sendMessageSpy = jest.spyOn(vm, 'sendMessage').mockImplementation(() => {});
        return { wrapper, vm, sendMessageSpy };
      };

      it('a card pressed while a load is in flight keeps its scope — the restore never lands', async () => {
        const { wrapper, vm, sendMessageSpy } = await pressCard();
        const chatHistoryService = require('../../services/chatHistoryService');
        let resolveLoad;
        chatHistoryService.getConversation.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveLoad = resolve;
            })
        );
        const loadHandler = mockEventBusOn.mock.calls.find((c) => c[0] === 'load-conversation')[1];
        const pending = loadHandler('conv-race');
        await vm.$nextTick();

        // The user presses a healthy scoped card DURING the window.
        vm.selectQuickHelpOption({
          service: 'Births',
          visibleText: 'q',
          hiddenPrompt: 'p',
          category: '2',
          id: 'race-card'
        });
        expect(vm.selectedContextItems.some((item) => item.id === 'race-card')).toBe(true);

        // The load lands AFTER the press — with the conversation's own
        // scope, which must not replace the pressed card's.
        resolveLoad({
          _key: 'conv-race',
          title: 'Race',
          messages: [{ sender: 'user', content: 'old turn' }],
          tags: ['Births']
        });
        await pending;
        await vm.$nextTick();

        expect(vm.selectedContextItems.some((item) => item.id === 'race-card')).toBe(true);
        expect(vm.conversationId).toBeNull();
        sendMessageSpy.mockRestore();
        wrapper.unmount();
      });

      it('a sidebar service picked while a load is in flight keeps its chip — the restore never lands', async () => {
        const { wrapper, vm } = await pressCard();
        const chatHistoryService = require('../../services/chatHistoryService');
        let resolveLoad;
        chatHistoryService.getConversation.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveLoad = resolve;
            })
        );
        const loadHandler = mockEventBusOn.mock.calls.find((c) => c[0] === 'load-conversation')[1];
        const pending = loadHandler('conv-race');
        await vm.$nextTick();

        // The user picks a sidebar service DURING the window — the same
        // supersede, through the other scope-setting path.
        vm.handleTreeNodeSelected({ service: 'Births', serviceKey: 'Births', category: '2', selected: true });
        expect(vm.selectedContextItems.some((item) => item.serviceKey === 'Births')).toBe(true);

        resolveLoad({
          _key: 'conv-race',
          title: 'Race',
          messages: [{ sender: 'user', content: 'old turn' }],
          tags: ['Births']
        });
        await pending;
        await vm.$nextTick();

        expect(vm.selectedContextItems.some((item) => item.serviceKey === 'Births')).toBe(true);
        expect(vm.conversationId).toBeNull();
        wrapper.unmount();
      });
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

    it('clearing the last chip of a category shared by SEVERAL buttons re-installs the CATEGORY, not a sibling', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const tree = [
        {
          catKey: '2',
          name: 'État civil',
          nameEN: 'Civil Registry',
          children: [
            { name: 'Naissances', nameEN: 'Births' },
            { name: 'Mariages', nameEN: 'Marriages' }
          ]
        }
      ];
      mockLiveTree(tree);
      vm.serviceCategories = tree;
      vm.serviceCategoriesStatus = 'loaded';

      // Two buttons, one category, DIFFERENT labels. No state remembers
      // which one the user pressed: re-installing either would swap the
      // scope's labels for ones nobody chose. The category itself is the
      // only honest scope left.
      vm.quickHelpButtons = [
        {
          id: 'births',
          service: 'Births',
          serviceLabels: ['Births'],
          serviceKey: 'births',
          category: '2',
          icon: 'x'
        },
        {
          id: 'marriages',
          service: 'Marriages',
          serviceLabels: ['Marriages'],
          serviceKey: 'marriages',
          category: '2',
          icon: 'x'
        }
      ];
      vm.currentCategoryId = '2';
      vm.$store.commit('conversation/setContextItems', [
        { service: 'Naissances', serviceKey: 'Births', source: 'sidebar', category: '2', selected: true }
      ]);

      vm.removeContextItem(0);

      expect(vm.selectedContextItems).toHaveLength(1);
      const reinstalled = vm.selectedContextItems[0];
      // The category scope: no label on the wire, the category edge
      // restores it — never a sibling's invented identity.
      expect(reinstalled.categoryOnly).toBe(true);
      expect(reinstalled.serviceKey).toBeNull();
      expect(reinstalled.serviceLabels).toBeUndefined();
      expect(reinstalled.id).toBeUndefined();
      expect(reinstalled.category).toBe('2');
      // The chip names the category, and the category stays active.
      expect(reinstalled.service).toBe('État civil');
      expect(vm.currentCategoryId).toBe('2');
    });

    it('clearing the last chip of a category with ONE button re-installs that button', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const tree = [
        {
          catKey: '2',
          name: 'État civil',
          nameEN: 'Civil Registry',
          children: [{ name: 'Naissances', nameEN: 'Births' }]
        }
      ];
      mockLiveTree(tree);
      vm.serviceCategories = tree;
      vm.serviceCategoriesStatus = 'loaded';

      vm.quickHelpButtons = [
        {
          id: 'births',
          service: 'Births',
          serviceLabels: ['Births'],
          serviceKey: 'births',
          category: '2',
          icon: 'x'
        }
      ];
      vm.currentCategoryId = '2';
      vm.$store.commit('conversation/setContextItems', [
        { service: 'Naissances', serviceKey: 'Births', source: 'sidebar', category: '2', selected: true }
      ]);

      vm.removeContextItem(0);

      expect(vm.selectedContextItems).toHaveLength(1);
      expect(vm.selectedContextItems[0].id).toBe('births');
      expect(vm.selectedContextItems[0].serviceLabels).toEqual(['Births']);
      expect(vm.selectedContextItems[0].categoryOnly).toBeUndefined();
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

    afterEach(resetQuickHelpButtons);

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

function createChatBotWrapperWithI18n(
  messages = {
    en: {
      chatbot: {
        whatCanIHelp: 'How can {brandwordmark} help you today?'
      }
    }
  }
) {
  const store = createChatBotStore();
  const i18n = createI18n({
    legacy: true,
    locale: 'en',
    fallbackLocale: 'en',
    messages
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
});

// ---------------------------------------------------------------------------
// The category a Quick Help CONFIGURATION names
//
// The configuration writes the category's ENGLISH NAME — the label the
// hierarchy publishes and the corpus filters on. The database key stays
// accepted: a configuration written before the change still names a
// category, and a deployment's configuration is edited on its own.
// ---------------------------------------------------------------------------
describe('Quick Help category reference', () => {
  const TREE = [{ catKey: '2', name: 'Civil Registry', nameEN: 'Civil Registry', children: [] }];

  const configLoader = require('../../config-loader');
  let originalConfig;

  beforeEach(() => {
    originalConfig = configLoader.default.getMockImplementation();
    configLoader.default.mockResolvedValue({
      features: {
        chat: {
          quickHelp: {
            buttons: [{ id: 'civil', title: { en: 'Civil' }, category: 'Civil Registry' }]
          }
        }
      }
    });
    // This block sits OUTSIDE the main ChatBotComponent describe, so the
    // file-level hooks do not run here: the mocks are reset by hand, or a
    // test inherits the implementation an earlier block left behind (a
    // conversation whose tags name buttons this config does not carry).
    jest.clearAllMocks();
    const serviceTreeService = require('../../services/serviceTreeService');
    serviceTreeService.getAllCategories.mockReset();
    serviceTreeService.getAllCategories.mockResolvedValue([]);
    const chatHistoryService = require('../../services/chatHistoryService');
    chatHistoryService.getConversation.mockReset();
    chatHistoryService.getConversation.mockResolvedValue({ messages: [] });
  });

  afterEach(() => {
    configLoader.default.mockImplementation(originalConfig);
    // The block restored mocks its beforeEach mutated — the file-level
    // hooks do not run here, so a later block would inherit the empty
    // hierarchy and the empty conversation this block installed.
    const serviceTreeService = require('../../services/serviceTreeService');
    serviceTreeService.getAllCategories.mockReset();
    serviceTreeService.getAllCategories.mockResolvedValue([]);
    const chatHistoryService = require('../../services/chatHistoryService');
    chatHistoryService.getConversation.mockReset();
    chatHistoryService.getConversation.mockResolvedValue({ messages: [] });
  });

  it('resolves a category named by its ENGLISH name', async () => {
    mockLiveTree(TREE);
    const wrapper = await createChatBotWrapperAsync(TREE);

    expect(wrapper.vm.getCategoryEnLabel('Civil Registry')).toBe('Civil Registry');
    expect(wrapper.vm.getCategoryDisplayName('Civil Registry')).toBe('Civil Registry');
  });

  it('still resolves a category named by its database key', async () => {
    mockLiveTree(TREE);
    const wrapper = await createChatBotWrapperAsync(TREE);

    expect(wrapper.vm.getCategoryEnLabel('2')).toBe('Civil Registry');
  });

  it('a name the hierarchy does not carry names no category', async () => {
    mockLiveTree(TREE);
    const wrapper = await createChatBotWrapperAsync(TREE);

    expect(wrapper.vm.getCategoryEnLabel('Taxes')).toBeNull();
  });

  it('a button whose category is named by its ENGLISH name is not broken', async () => {
    mockLiveTree(TREE);
    const wrapper = await createChatBotWrapperAsync(TREE);

    const state = wrapper.vm.quickHelpScopeState({
      id: 'civil',
      category: 'Civil Registry',
      serviceLabels: []
    });

    expect(state.broken).toBe(false);
  });

  it('an entry the hierarchy cannot address by key cannot be addressed by name', async () => {
    // Resolving one would hand the conversation's edge a name where the
    // backend writes `serviceCategories/<key>`: the card would look
    // healthy and the conversation would silently lose its category.
    const wrapper = await createChatBotWrapperAsync([{ name: 'Orphan', nameEN: 'Orphan', children: [] }]);

    expect(wrapper.vm.getCategoryEnLabel('Orphan')).toBeNull();
    expect(wrapper.vm.quickHelpCategoryKey('Orphan')).toBeNull();
  });

  it('a hierarchy key that equals another category NAME resolves the keyed category', async () => {
    // A re-created hierarchy can mint a key ("2024") that equals another
    // category's name. Every key-typed consumer — the saved conversation's
    // edge, the legacy tags — must keep resolving to the KEYED category:
    // the name interpretation would restore the wrong scope.
    const wrapper = await createChatBotWrapperAsync([
      { catKey: '2024', name: 'The Year Area', nameEN: 'The Year Area', children: [] },
      { catKey: '7', name: '2024', nameEN: '2024', children: [] }
    ]);

    expect(wrapper.vm.getCategoryDisplayName('2024')).toBe('The Year Area');
    expect(wrapper.vm.getCategoryEnLabel('2024')).toBe('The Year Area');
  });

  it('a scope restored while the hierarchy was down carries the key once it lands', async () => {
    // The tree was not there at restore: the chips and the selected
    // category keep the configuration's own spelling. The next save would
    // write that spelling as the conversation's edge
    // (`serviceCategories/<categoryId>`) — a document that does not
    // exist. When the hierarchy lands, the installed scope is
    // re-resolved, like the mobile twin re-resolves its restore.
    const serviceTreeService = require('../../services/serviceTreeService');
    let resolveTree;
    const pendingTree = new Promise((resolve) => {
      resolveTree = resolve;
    });
    // The hierarchy is down at the mount, down again at the restore's
    // bounded retry (each failure SETTLES — the load reports a failure,
    // it does not hang), and only the third attempt is held until the
    // test recovers it.
    serviceTreeService.getAllCategories
      .mockRejectedValueOnce(new Error('hierarchy down'))
      .mockRejectedValueOnce(new Error('hierarchy down'))
      .mockImplementation(() => pendingTree);

    const wrapper = createChatBotWrapper();
    const vm = wrapper.vm;
    await flushPromises();

    const chatHistoryService = require('../../services/chatHistoryService');
    chatHistoryService.getConversation.mockResolvedValueOnce({
      _key: 'c1',
      title: 'Saved chat',
      messages: [],
      tags: ['civil']
    });

    await vm.loadExistingConversation('c1');
    // The tree was down: the scope carries the configuration's spelling.
    expect(vm.currentCategoryId).toBe('Civil Registry');

    resolveTree(TREE);
    await vm.ensureServiceCategoriesLoaded();
    await flushPromises();

    expect(vm.currentCategoryId).toBe('2');
    const chip = vm.selectedContextItems.find((item) => item.source === 'quickHelp');
    expect(chip.category).toBe('2');
    // The recovery moved fields the user cannot edit: a conversation that
    // was clean before the tree landed stays clean.
    expect(vm.hasUnsavedChanges()).toBe(false);
  });

  it('a category-only scope restored while the hierarchy was down is repaired', async () => {
    // A conversation saved with a category edge and no tags restores a
    // category-only chip. While the tree is down its display is blank and
    // its category keeps the configuration's spelling; the recovery
    // resolves both — the chip's display IS the category's own name.
    const serviceTreeService = require('../../services/serviceTreeService');
    let resolveTree;
    const pendingTree = new Promise((resolve) => {
      resolveTree = resolve;
    });
    serviceTreeService.getAllCategories
      .mockRejectedValueOnce(new Error('hierarchy down'))
      .mockRejectedValueOnce(new Error('hierarchy down'))
      .mockImplementation(() => pendingTree);

    const wrapper = createChatBotWrapper();
    const vm = wrapper.vm;
    await flushPromises();

    const chatHistoryService = require('../../services/chatHistoryService');
    chatHistoryService.getConversation.mockResolvedValueOnce({
      _key: 'c2',
      title: 'Category-only chat',
      messages: [],
      categoryId: 'Civil Registry'
    });

    await vm.loadExistingConversation('c2');
    expect(vm.currentCategoryId).toBe('Civil Registry');

    resolveTree(TREE);
    await vm.ensureServiceCategoriesLoaded();
    await flushPromises();

    expect(vm.currentCategoryId).toBe('2');
    const chip = vm.selectedContextItems[0];
    expect(chip.categoryOnly).toBe(true);
    expect(chip.category).toBe('2');
    expect(chip.service).toBe('Civil Registry');
  });

  it('an empty key is no key: a reference resolved to it keeps the card broken', async () => {
    // declaresCategoryScope reads an empty id as NO scope: a reference
    // resolved to one would render the card healthy and send the query
    // unfiltered while the card promised a scope.
    const wrapper = await createChatBotWrapperAsync([{ catKey: '', name: 'Ghost', nameEN: 'Ghost', children: [] }]);

    expect(wrapper.vm.getCategoryEnLabel('Ghost')).toBeNull();
    expect(wrapper.vm.quickHelpCategoryKey('Ghost')).toBeNull();

    const button = wrapper.vm.quickHelpButtons.find((b) => b.id === 'civil');
    expect(button.category).toBe('Civil Registry');

    const state = wrapper.vm.quickHelpScopeState({
      id: 'civil',
      category: 'Civil Registry',
      serviceLabels: []
    });
    expect(state.broken).toBe(true);
  });

  it('the no-scope placeholder is never reinterpreted by the recovery', async () => {
    // 'general' names no category in any spelling. A hierarchy category
    // literally named "general" must not hijack a category-less selection
    // into a real scope when the tree lands.
    const generalTree = [
      { catKey: '2', name: 'Civil Registry', nameEN: 'Civil Registry', children: [] },
      { catKey: '9', name: 'General', nameEN: 'general', children: [] }
    ];
    mockLiveTree(generalTree);
    const wrapper = createChatBotWrapper();
    await flushPromises();

    const vm = wrapper.vm;
    vm.currentCategoryId = 'general';
    vm.selectedContextItems.push({
      service: 'Just Chat',
      serviceKey: 'just-chat',
      source: 'quickHelp',
      id: 'just-chat',
      category: 'general',
      selected: true
    });
    vm.reResolveInstalledScopeAgainstHierarchy();

    expect(vm.currentCategoryId).toBe('general');
    expect(vm.selectedContextItems[0].category).toBe('general');
  });

  it('a configuration card with the no-scope placeholder is never reinterpreted', async () => {
    // 'general' declares NO scope in every rule of the file. A hierarchy
    // category literally named "general" must not hijack such a card into
    // a real scope at the configuration mapping.
    const generalTree = [
      { catKey: '2', name: 'Civil Registry', nameEN: 'Civil Registry', children: [] },
      { catKey: '9', name: 'General', nameEN: 'general', children: [] }
    ];
    const configLoader = require('../../config-loader');
    const previous = configLoader.default.getMockImplementation();
    configLoader.default.mockResolvedValue({
      features: {
        chat: {
          quickHelp: {
            buttons: [{ id: 'open', title: { en: 'Open' }, category: 'general' }]
          }
        }
      }
    });
    try {
      mockLiveTree(generalTree);
      const wrapper = createChatBotWrapper();
      await flushPromises();

      const button = wrapper.vm.quickHelpButtons.find((b) => b.id === 'open');
      expect(button.category).toBe('general');
      expect(wrapper.vm.quickHelpScopeState(button).broken).toBe(false);
    } finally {
      configLoader.default.mockImplementation(previous);
    }
  });

  it('the configuration reference is normalized to the hierarchy key', async () => {
    // The conversation's edge speaks the hierarchy's own key
    // (`serviceCategories/<key>`): the reference the configuration wrote
    // is resolved into it.
    mockLiveTree(TREE);
    const wrapper = createChatBotWrapper();
    await flushPromises();

    const button = wrapper.vm.quickHelpButtons.find((b) => b.id === 'civil');
    expect(button.category).toBe('2');
  });

  it('a restored scope carries the hierarchy key, not the name', async () => {
    // The conversation's category edge is written by the backend as
    // `serviceCategories/<key>`: the scope the restore installs must
    // speak the hierarchy's key, even when the hierarchy landed after
    // the configuration did.
    const serviceTreeService = require('../../services/serviceTreeService');
    let resolveTree;
    serviceTreeService.getAllCategories.mockReturnValue(
      new Promise((resolve) => {
        resolveTree = resolve;
      })
    );

    const wrapper = createChatBotWrapper();
    const vm = wrapper.vm;
    await flushPromises();

    resolveTree(TREE);
    await flushPromises();

    const chatHistoryService = require('../../services/chatHistoryService');
    chatHistoryService.getConversation.mockResolvedValueOnce({
      _key: 'c1',
      title: 'Saved chat',
      messages: [],
      tags: ['civil']
    });

    await vm.loadExistingConversation('c1');

    expect(vm.currentCategoryId).toBe('2');
    expect(vm.selectedContextItems[0].category).toBe('2');
  });

  it('resolves the reference when the hierarchy lands after the configuration', async () => {
    // The two loads are independent: the configuration may be read
    // before the hierarchy is there. The buttons are resolved again when
    // the hierarchy lands.
    const serviceTreeService = require('../../services/serviceTreeService');
    let resolveTree;
    serviceTreeService.getAllCategories.mockReturnValue(
      new Promise((resolve) => {
        resolveTree = resolve;
      })
    );

    const wrapper = createChatBotWrapper();
    await flushPromises();

    resolveTree(TREE);
    await flushPromises();

    const button = wrapper.vm.quickHelpButtons.find((b) => b.id === 'civil');
    expect(button.category).toBe('2');
  });
});

// ---------------------------------------------------------------------------
// A Quick Help card with NO TITLE
//
// The configuration's title resolves to nothing (an absent title, an empty
// locale map, or a map whose every entry is empty). The card then carries no
// label — and the press gate refuses it (selectQuickHelpOption's first rule:
// no service, no selection), so the tap did nothing at all: no caption, no
// toast, no state change. A card that LOOKS alive and swallows the press.
//
// The mobile twin fixed the same shape with quickHelpCardBroken —
// the DISPLAY twin of the press gate: every press refusal has a face. The web
// renders the card as the broken card it is, with the caption naming the
// missing title.
// ---------------------------------------------------------------------------
describe('Quick Help card with no title', () => {
  // A card whose title resolves to nothing: the locale map's every entry
  // is empty, so resolveConfigText finds nothing to show.
  const titleLessButton = {
    id: 'title-less',
    title: { en: '' },
    icon: { type: 'file', value: '/config/quickhelp/just-chat.svg' },
    category: null,
    styles: { backgroundColor: '#fff', hoverColor: '#eee', outlineColor: '#ccc' }
  };

  const titledButton = {
    id: 'titled',
    title: { en: 'A titled card' },
    icon: { type: 'file', value: '/config/quickhelp/just-chat.svg' },
    category: null,
    styles: { backgroundColor: '#fff', hoverColor: '#eee', outlineColor: '#ccc' }
  };

  afterEach(resetQuickHelpButtons);

  it('maps a title that resolves to nothing onto an empty label', async () => {
    const wrapper = await mountWithButtons([titleLessButton]);

    const button = wrapper.vm.quickHelpButtons.find((b) => b.id === 'title-less');
    expect(button.service).toBe('');
  });

  it('marks the card broken, the way a broken scope does', async () => {
    const wrapper = await mountWithButtons([titleLessButton]);
    const vm = wrapper.vm;

    const button = vm.quickHelpButtons.find((b) => b.id === 'title-less');
    // The card's own verdict: the scope is fine, the TITLE is not, and
    // the card is broken all the same — it is the display twin of the
    // press refusal.
    expect(vm.quickHelpScopeState(button).broken).toBe(false);
    expect(vm.quickHelpCardBroken(button)).toBe(true);
  });

  it('leaves a card with a title alone', async () => {
    const wrapper = await mountWithButtons([titledButton]);
    const vm = wrapper.vm;

    const button = vm.quickHelpButtons.find((b) => b.id === 'titled');
    expect(vm.quickHelpCardBroken(button)).toBe(false);
  });

  it('names the missing title in the caption', async () => {
    const en = require('../../i18n/locales/en').default;
    const wrapper = createChatBotWrapperWithI18n({ en });
    const vm = wrapper.vm;
    mockLiveTree([]);
    vm.serviceCategories = [];
    vm.serviceCategoriesStatus = 'loaded';

    const button = {
      id: 'title-less',
      service: '',
      serviceLabels: [],
      category: null,
      icon: 'x'
    };

    // The caption names the defect: the title is missing, so the card
    // cannot be used. The text ships in all 14 locales.
    expect(vm.quickHelpCardCaption(button)).toContain('no title');
  });

  it('shows the caption and the error icon on the card', async () => {
    const wrapper = await mountWithButtons([titleLessButton], { renderStubDefaultSlot: true });
    await wrapper.vm.$nextTick();

    // The card renders as the broken card: the error class, the warning
    // icon and the caption that says why.
    const card = wrapper.find('.quick-help-item');
    expect(card.classes()).toContain('config-error');
    expect(wrapper.find('.config-error-icon').exists()).toBe(true);
    expect(wrapper.find('[data-testid="quick-help-error-caption"]').exists()).toBe(true);
  });

  it('sends no query when the card is pressed', async () => {
    const wrapper = await mountWithButtons([titleLessButton]);
    const vm = wrapper.vm;

    const button = vm.quickHelpButtons.find((b) => b.id === 'title-less');
    await vm.selectQuickHelpOption(button);

    // The press installs nothing and sends nothing — the caption on the
    // card is what the user reads.
    expect(mockSubmitQueryStream).not.toHaveBeenCalled();
    expect(vm.selectedContextItems).toHaveLength(0);
  });
});
