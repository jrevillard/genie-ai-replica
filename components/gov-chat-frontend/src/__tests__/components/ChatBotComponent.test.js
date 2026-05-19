'use strict';

/**
 * ChatBotComponent tests — AC1 through AC5.
 *
 * Covers: empty render, user message submission, input clearing,
 * loading state, and error state.
 */
const { mount } = require('@vue/test-utils');
const { createStore } = require('vuex');
const { createAuthenticatedState } = require('../fixtures/store-state');

// ---------------------------------------------------------------------------
// Service mocks (closure-based refs for per-test control)
// ---------------------------------------------------------------------------

let capturedCallbacks = {};

const mockSubmitQueryStream = jest.fn((_queryData, callbacks) => {
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

// Mock dynamic import of main.js (loadQuickHelpButtons)
jest.mock('../../main.js', () => ({
  loadConfig: jest.fn().mockResolvedValue({
    features: { chat: { quickHelp: { buttons: [] } } }
  })
}));

// Mock heavy libraries
jest.mock('marked', () => ({
  __esModule: true,
  marked: { parse: jest.fn((c) => c) }
}));
jest.mock('dompurify', () => ({ sanitize: jest.fn((c) => c) }));
jest.mock('jspdf', () => {
  return jest.fn().mockImplementation(() => ({
    text: jest.fn(),
    save: jest.fn(),
    setFontSize: jest.fn(),
    splitTextToSize: jest.fn((t) => [t]),
    internal: { pageSize: { getWidth: () => 210 } }
  }));
});
jest.mock('lucide-vue-next', () => ({
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

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

function createChatBotStore(stateOverrides = {}) {
  const state = createAuthenticatedState(stateOverrides);
  return createStore({
    state: () => state,
    getters: {
      currentUser: (s) => s.user,
      isAuthenticated: (s) => s.isAuthenticated
    },
    mutations: {
      SET_USER(s, user) {
        s.user = user;
      }
    },
    actions: {
      logout: jest.fn().mockResolvedValue(undefined)
    },
    modules: {
      chatHistory: {
        namespaced: true,
        state: () => state.chatHistory,
        getters: {
          getAllFolders: (s) => s.folders,
          getChatById: () => (/* chatId */) => null
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

function createChatBotWrapper(storeOverrides = {}) {
  const store = createChatBotStore(storeOverrides);
  return mount(ChatBotComponent, {
    global: {
      plugins: [store],
      mocks: {
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
  });

  // -----------------------------------------------------------------------
  // AC1 — Renders chat window with empty message list
  // -----------------------------------------------------------------------
  describe('AC1 — renders with empty message list', () => {
    it('renders the chat container without errors', () => {
      const wrapper = createChatBotWrapper();
      expect(wrapper.find('.chatbot-container').exists()).toBe(true);
    });

    it('displays the welcome message in chatMessages', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;
      const botMsgs = vm.chatMessages.filter((m) => m.sender === 'bot');
      expect(botMsgs.length).toBeGreaterThanOrEqual(1);
    });

    it('renders a message input area', () => {
      const wrapper = createChatBotWrapper();
      expect(wrapper.find('input').exists() || wrapper.find('.ds-input').exists()).toBe(true);
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

      const userMsg = vm.chatMessages.find((m) => m.sender === 'user' && m.content === 'Hello, can you help me?');
      expect(userMsg).toBeDefined();
    });

    it('also adds a bot placeholder message for streaming', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.newMessage = 'Test query';
      await vm.sendMessage();
      await wrapper.vm.$nextTick();

      const botMsg = vm.chatMessages.filter((m) => m.sender === 'bot');
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

    it('resets isStreaming when onDone is called', async () => {
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
      expect(vm.systemStatus.errorMessage).toBe('Stream failed');
      // Bot message should have error content
      const streamingMsg = vm.chatMessages[vm.chatMessages.length - 1];
      expect(streamingMsg.content).toBeTruthy();
    });

    it('calls notificationService.error on stream error', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.newMessage = 'Error notification test';
      await vm.sendMessage();
      await wrapper.vm.$nextTick();

      capturedCallbacks.onError(new Error('Stream error'));
      await wrapper.vm.$nextTick();

      expect(mockNotificationError).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Event bus subscriptions
  // -----------------------------------------------------------------------
  describe('event bus subscriptions', () => {
    it('subscribes to eventBus events in created/mounted', () => {
      createChatBotWrapper();
      const events = mockEventBusOn.mock.calls.map((call) => call[0]);
      expect(events).toContain('treeNodeSelected');
      expect(events).toContain('open-chat');
    });

    it('unsubscribes from eventBus in beforeUnmount', () => {
      const wrapper = createChatBotWrapper();
      wrapper.unmount();
      expect(mockEventBusOff).toHaveBeenCalled();
    });
  });
});
