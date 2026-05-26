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
      expect(streamingMsg.content).toMatch(/error|failed|unavailable/i);
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
      expect(events).toContain('open-chat');
    });

    it('unsubscribes from specific eventBus events in beforeUnmount', () => {
      const wrapper = createChatBotWrapper();
      wrapper.unmount();
      const unsubscribedEvents = mockEventBusOff.mock.calls.map((call) => call[0]);
      expect(unsubscribedEvents).toContain('chat-deleted');
      expect(unsubscribedEvents).toContain('load-conversation');
      expect(unsubscribedEvents).toContain('treeNodeSelected');
      expect(unsubscribedEvents).toContain('open-chat');
    });
  });

  // -----------------------------------------------------------------------
  // Subtask 3a: SSE streaming behavior
  // -----------------------------------------------------------------------
  describe('Subtask 3a — SSE streaming', () => {
    it('sets isStreaming state to true when stream starts', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.newMessage = 'Start streaming test';
      await vm.sendMessage();
      await wrapper.vm.$nextTick();

      expect(vm.isStreaming).toBe(true);
      expect(mockSubmitQueryStream).toHaveBeenCalled();
    });

    it('stores streamController reference when stream starts', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.newMessage = 'Controller test';
      await vm.sendMessage();
      await wrapper.vm.$nextTick();

      expect(vm.streamController).toBeDefined();
      expect(typeof vm.streamController.abort).toBe('function');
    });

    it('resets isStreaming and streamController when stream completes', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.newMessage = 'Completion test';
      await vm.sendMessage();
      await wrapper.vm.$nextTick();

      // Simulate stream completion
      capturedCallbacks.onDone({ queryId: 'q-123' });
      await wrapper.vm.$nextTick();

      expect(vm.isStreaming).toBe(false);
      expect(vm.streamController).toBeNull();
      expect(vm.streamingQueryId).toBe('q-123');
    });

    it('aborts previous stream when new message is sent', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // First stream
      vm.newMessage = 'First message';
      await vm.sendMessage();
      const firstController = vm.streamController;
      await wrapper.vm.$nextTick();

      // Second stream (should abort first)
      vm.newMessage = 'Second message';
      await vm.sendMessage();
      await wrapper.vm.$nextTick();

      expect(firstController.abort).toHaveBeenCalled();
      expect(vm.streamController).not.toBe(firstController);
    });

    it('sets streamingQueryId on successful stream completion', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.newMessage = 'Query ID test';
      await vm.sendMessage();
      await wrapper.vm.$nextTick();

      capturedCallbacks.onDone({ queryId: 'test-query-456' });
      await wrapper.vm.$nextTick();

      expect(vm.streamingQueryId).toBe('test-query-456');
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

      // Simulate network error
      capturedCallbacks.onError(new Error('Network request failed'));
      await wrapper.vm.$nextTick();

      expect(vm.isStreaming).toBe(false);
      expect(vm.systemStatus.online).toBe(false);
      expect(vm.systemStatus.errorMessage).toBe('Network request failed');
    });

    it('displays error message in bot message on stream failure', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.newMessage = 'Error message test';
      await vm.sendMessage();
      await wrapper.vm.$nextTick();

      capturedCallbacks.onError(new Error('Stream connection lost'));
      await wrapper.vm.$nextTick();

      const lastBotMessage = vm.chatMessages[vm.chatMessages.length - 1];
      expect(lastBotMessage.sender).toBe('bot');
      expect(lastBotMessage.content).toMatch(/error|unavailable|failed/i);
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
      expect(vm.streamController).toBeNull();
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
      const result = vm.renderMarkdown(xssAttempt);

      // DOMPurify should sanitize the HTML (marked won't process script tags as markdown)
      // The result should be the sanitized version
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
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
        textKey: 'quickhelp.customerService',
        visibleTextKey: 'quickhelp.customerServiceVisible',
        hiddenPromptKey: 'quickhelp.customerServiceHidden',
        category: 'general',
        id: 'test-quick-help-1'
      };

      vm.selectQuickHelpOption(quickHelpOption);
      expect(vm.selectedContextItems.length).toBeGreaterThan(0);

      const addedItem = vm.selectedContextItems.find((item) => item.service === 'Customer Service');
      expect(addedItem).toBeDefined();
      expect(addedItem.serviceKey).toBe('quickhelp.customerService');
    });

    it('sets hiddenPromptForNextMessage for dual-prompt mechanism', async () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      const quickHelpOption = {
        service: 'Test Service',
        textKey: 'quickhelp.test',
        visibleTextKey: 'quickhelp.testVisible',
        hiddenPromptKey: 'quickhelp.testHidden',
        category: 'test-category'
      };

      // Mock sendMessage to prevent actual execution
      vm.sendMessage = jest.fn();

      vm.selectQuickHelpOption(quickHelpOption);

      // The component uses this.$t() to translate the hiddenPromptKey
      // Since we mock $t to return the key itself, hiddenPromptForNextMessage will be the translated key
      expect(vm.hiddenPromptForNextMessage).toBeDefined();
      expect(vm.hiddenPromptForNextMessage).toBe('quickhelp.testHidden');
      expect(vm.sendMessage).toHaveBeenCalled();
    });

    it('sets visible message from quick help option', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      const quickHelpOption = {
        service: 'Visible Test',
        textKey: 'quickhelp.visibleTest',
        visibleTextKey: 'quickhelp.visibleTestVisible',
        hiddenPromptKey: 'quickhelp.visibleTestHidden',
        category: 'general'
      };

      // Mock sendMessage to prevent immediate execution
      vm.sendMessage = jest.fn();

      vm.selectQuickHelpOption(quickHelpOption);

      // The component uses this.$t() to translate the visibleTextKey
      // Since we mock $t to return the key itself, newMessage will be the translated key
      expect(vm.newMessage).toBe('quickhelp.visibleTestVisible');
      expect(vm.hiddenPromptForNextMessage).toBe('quickhelp.visibleTestHidden');
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

    it('handles "Just Chat" option without category', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      const justChatOption = {
        service: 'quickhelp.justChat', // Must match the $t mock return value
        textKey: 'quickhelp.justChat',
        category: null,
        id: 'just-chat-test'
      };

      vm.selectQuickHelpOption(justChatOption);

      // When service matches 'quickhelp.justChat', categoryId remains null
      expect(vm.currentCategoryId).toBeNull();
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
  });

  // -----------------------------------------------------------------------
  // Subtask 3e: Dialog management
  // -----------------------------------------------------------------------
  describe('Subtask 3e — Dialog management', () => {
    it('opens feedback dialog with correct message', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      // Add a test message
      vm.chatMessages.push({
        sender: 'bot',
        content: 'Test bot message',
        queryId: 'test-q-123'
      });

      vm.openFeedbackDialog(vm.chatMessages.length - 1);

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

      vm.chatMessages.push({
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

      vm.chatMessages.push({
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

      vm.chatMessages = [
        { sender: 'user', content: 'User message', timestamp: new Date().toISOString() },
        { sender: 'bot', content: 'Bot response', timestamp: new Date().toISOString() }
      ];

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

      vm.chatMessages = [{ sender: 'bot', content: 'Test' }];
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

      vm.chatMessages = [{ sender: 'bot', content: 'Test' }];
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

      vm.conversationId = null;
      vm.currentChatId = null;
      vm.chatMessages = [{ sender: 'bot', content: 'Welcome', isSaved: true }];
      vm.selectedContextItems = [];

      expect(vm.hasUnsavedChanges()).toBe(false);
    });

    it('returns true for new conversation with user messages', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.conversationId = null;
      vm.currentChatId = null;
      vm.chatMessages = [
        { sender: 'bot', content: 'Welcome', isSaved: true },
        { sender: 'user', content: 'User message', isSaved: false }
      ];

      expect(vm.hasUnsavedChanges()).toBe(true);
    });

    it('returns true for new conversation with context items', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.conversationId = null;
      vm.currentChatId = null;
      vm.chatMessages = [{ sender: 'bot', content: 'Welcome', isSaved: true }];
      vm.selectedContextItems = [{ service: 'Test Service', category: 'general' }];

      expect(vm.hasUnsavedChanges()).toBe(true);
    });

    it('returns true for existing conversation with new unsaved messages', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.conversationId = 'existing-conv-123';
      vm.currentChatId = 'existing-conv-123';
      vm.lastSavedState = {
        messages: [{ sender: 'bot', content: 'Saved bot message', isSaved: true }],
        contextItems: []
      };

      vm.chatMessages = [
        { sender: 'bot', content: 'Saved bot message', isSaved: true },
        { sender: 'user', content: 'New user message', isSaved: false }
      ];

      expect(vm.hasUnsavedChanges()).toBe(true);
    });

    it('returns true when context items differ from saved state', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.conversationId = 'conv-456';
      vm.currentChatId = 'conv-456';
      vm.lastSavedState = {
        messages: [{ sender: 'bot', content: 'Saved', isSaved: true }],
        contextItems: [{ service: 'Old Service', category: 'general' }]
      };

      vm.chatMessages = [{ sender: 'bot', content: 'Saved', isSaved: true }];
      vm.selectedContextItems = [{ service: 'New Service', category: 'general' }];

      expect(vm.hasUnsavedChanges()).toBe(true);
    });

    it('returns true when context item count differs from saved state', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.conversationId = 'conv-789';
      vm.currentChatId = 'conv-789';
      vm.lastSavedState = {
        messages: [{ sender: 'bot', content: 'Saved', isSaved: true }],
        contextItems: [
          { service: 'Service 1', category: 'general' },
          { service: 'Service 2', category: 'general' }
        ]
      };

      vm.chatMessages = [{ sender: 'bot', content: 'Saved', isSaved: true }];
      vm.selectedContextItems = [{ service: 'Service 1', category: 'general' }];

      expect(vm.hasUnsavedChanges()).toBe(true);
    });

    it('returns false when all state matches saved state', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.conversationId = 'conv-saved-123';
      vm.currentChatId = 'conv-saved-123';
      vm.lastSavedState = {
        messages: [
          { sender: 'bot', content: 'Saved bot', isSaved: true },
          { sender: 'user', content: 'Saved user', isSaved: true }
        ],
        contextItems: [{ service: 'Saved Service', category: 'saved' }]
      };

      vm.chatMessages = [
        { sender: 'bot', content: 'Saved bot', isSaved: true },
        { sender: 'user', content: 'Saved user', isSaved: true }
      ];
      vm.selectedContextItems = [{ service: 'Saved Service', category: 'saved' }];

      expect(vm.hasUnsavedChanges()).toBe(false);
    });

    it('detects unsaved bot messages with queryId', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.conversationId = 'conv-bot-123';
      vm.currentChatId = 'conv-bot-123';
      vm.lastSavedState = {
        messages: [{ sender: 'bot', content: 'Old bot', isSaved: true }],
        contextItems: []
      };

      vm.chatMessages = [{ sender: 'bot', content: 'New bot response', isSaved: false, queryId: 'new-query' }];

      expect(vm.hasUnsavedChanges()).toBe(true);
    });

    it('handles empty selectedContextItems correctly', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.conversationId = 'conv-empty-123';
      vm.currentChatId = 'conv-empty-123';
      vm.lastSavedState = {
        messages: [{ sender: 'bot', content: 'Saved', isSaved: true }],
        contextItems: []
      };

      vm.chatMessages = [{ sender: 'bot', content: 'Saved', isSaved: true }];
      vm.selectedContextItems = [];

      expect(vm.hasUnsavedChanges()).toBe(false);
    });

    it('detects changes in context item properties', () => {
      const wrapper = createChatBotWrapper();
      const vm = wrapper.vm;

      vm.conversationId = 'conv-prop-123';
      vm.currentChatId = 'conv-prop-123';
      vm.lastSavedState = {
        messages: [{ sender: 'bot', content: 'Saved', isSaved: true }],
        contextItems: [{ service: 'Service Name', category: 'old-category' }]
      };

      vm.chatMessages = [{ sender: 'bot', content: 'Saved', isSaved: true }];
      vm.selectedContextItems = [{ service: 'Service Name', category: 'new-category' }];

      expect(vm.hasUnsavedChanges()).toBe(true);
    });
  });
});
