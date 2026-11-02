/**
 * J.2/J.4 + DEC-27/DEC-28 frontend pins — quick-help buttons send no label
 * filters and come from the backend with bilingual stored text.
 *
 * selectQuickHelpOption used to push a fabricated context item (i18n button
 * title + stock category-ID lookup) before sending, so sendMessage took the
 * labels branch and the payload carried context.categoryLabel +
 * context.serviceLabels as retrieval filter labels. The retriever's hard
 * ANY-IN chunk_labels filter matched none of those display strings against
 * the corpus taxonomy labels → 0 chunks → "no information on this" for every
 * button chat. Re-adding the context push (or its two sibling fabricators:
 * removeContextItem's restore branch, loadExistingConversation's legacy
 * restore) must fail these tests.
 *
 * DEC-28: buttons are backend documents { _key, order, enabled, isJustChat,
 * title: {en, st?}, prompt: {en, st?}, icon } — the current locale's text is
 * sent (st falls back to en), so an ST-locale click sends the ST prompt.
 *
 * Seam: same as the G.2a pin — component methods as plain functions, chat
 * services mocked; selectQuickHelpOption drives sendMessage end to end.
 */
import ChatBotComponent from '../ChatBotComponent.vue';
import chatbotService from '../../services/chatbotService';
import { streamChatQuery } from '../../services/streamingService';
import chatHistoryService from '../../services/chatHistoryService';
import quickhelpService from '../../services/quickhelpService';

jest.mock('../../services/chatbotService', () => ({
  submitQuery: jest.fn(),
  submitFeedback: jest.fn(),
}));
jest.mock('../../services/notificationService', () => ({ error: jest.fn(), success: jest.fn() }));
jest.mock('../../services/streamingService', () => ({
  streamChatQuery: jest.fn(),
  abortActiveStream: jest.fn(),
}));
jest.mock('../../services/serviceTreeService', () => ({ getAllCategories: jest.fn().mockResolvedValue([]) }));
jest.mock('../../services/chatHistoryService', () => ({
  getChats: jest.fn().mockResolvedValue([]),
  getConversation: jest.fn(),
}));
jest.mock('../../services/quickhelpService', () => ({
  getButtons: jest.fn().mockResolvedValue([]),
  getAllButtons: jest.fn().mockResolvedValue([]),
  createButton: jest.fn(),
  updateButton: jest.fn(),
  deleteButton: jest.fn(),
}));
jest.mock('../../services/analyticsService', () => ({ logEvent: jest.fn() }));
jest.mock('../../eventBus.js', () => ({
  eventBus: { $emit: jest.fn(), $on: jest.fn(), $off: jest.fn() },
}));

const BUTTON = {
  _key: 'crop-advice',
  order: 2,
  enabled: true,
  isJustChat: false,
  title: { en: 'Crop advice', st: 'Keletso ea lijalo' },
  prompt: {
    en: 'What crops grow best in my region?',
    st: 'Ke lijalo life tse holang hantle sebakeng sa ka?',
  },
  icon: '/config/quickhelp/crop-management.svg',
};

function makeCtx(overrides = {}) {
  return Object.assign(
    {
      newMessage: '',
      isLoading: false,
      chatMessages: [],
      selectedContextItems: [],
      currentCategoryId: null,
      conversationId: null,
      currentSessionId: 'sess-1',
      currentChatId: null,
      currentLocale: 'en',
      serviceCategories: [], // empty taxonomy → the REAL getCategoryLabelById runs
      useStreaming: false,
      showQuickHelp: true,
      relatedDocuments: [],
      systemStatus: {},
      quickHelpButtons: [BUTTON],
      _quickHelpLoadSeq: 0,
      translate: (k) => k,
      getCategoryLabelById: ChatBotComponent.methods.getCategoryLabelById,
      getWeatherLocation: () => null,
      quickHelpText: ChatBotComponent.methods.quickHelpText,
      sendMessage: ChatBotComponent.methods.sendMessage,
      tryStreamQuery: ChatBotComponent.methods.tryStreamQuery,
      scrollToBottom: jest.fn(),
      updateChatInHistory: jest.fn(),
      applySourceDocuments: jest.fn(),
      chatHistoryService,
      $store: { getters: { currentUser: { _key: 'user-1' } } },
    },
    overrides
  );
}

describe('ChatBotComponent.selectQuickHelpOption payload (J.2/J.4, DEC-27/28, K.7)', () => {
  it('button click sends the locale prompt as a conversation turn with empty labels', async () => {
    chatbotService.submitQuery.mockResolvedValue({ response: 'OK', queryId: 'q1' });
    const ctx = makeCtx();

    await ChatBotComponent.methods.selectQuickHelpOption.call(ctx, BUTTON);

    expect(ctx.showQuickHelp).toBe(false);
    expect(ctx.selectedContextItems).toHaveLength(0);
    expect(ctx.currentCategoryId).toBeNull();
    expect(chatbotService.submitQuery).toHaveBeenCalledTimes(1);
    const payload = chatbotService.submitQuery.mock.calls[0][0];
    expect(payload.contextOption).toBe('conversation-with-context-labels');
    expect(payload.messages).toEqual([
      { role: 'user', content: 'What crops grow best in my region?' },
    ]);
    expect(payload.context).toEqual({
      // no category picked → null (a fabricated 'General' is the J.2 zero-retrieval bug)
      categoryLabel: null,
      serviceLabels: [],
      language: 'EN',
      weatherLocation: null,
    });
    expect(payload.conversationId).toBeNull(); // fresh chat — set once a conversation loads
  });

  it('button mid-conversation joins the running history (K.7)', async () => {
    chatbotService.submitQuery.mockClear();
    chatbotService.submitQuery.mockResolvedValue({ response: 'OK', queryId: 'q1' });
    const ctx = makeCtx({
      conversationId: 'chat-3',
      chatMessages: [
        { sender: 'user', content: 'What can you tell me about maize?' },
        { sender: 'bot', content: 'Maize is a staple crop...' },
      ],
    });

    await ChatBotComponent.methods.selectQuickHelpOption.call(ctx, BUTTON);

    const payload = chatbotService.submitQuery.mock.calls[0][0];
    expect(payload.conversationId).toBe('chat-3');
    expect(payload.messages).toEqual([
      { role: 'user', content: 'What can you tell me about maize?' },
      { role: 'assistant', content: 'Maize is a staple crop...' },
      { role: 'user', content: 'What crops grow best in my region?' },
    ]);
  });

  it('ST locale sends the Sesotho prompt; missing st falls back to en', async () => {
    chatbotService.submitQuery.mockClear();
    chatbotService.submitQuery.mockResolvedValue({ response: 'OK', queryId: 'q1' });
    const stOnly = makeCtx({ currentLocale: 'st' });
    const noSt = makeCtx({ currentLocale: 'st' });
    const noStButton = { ...BUTTON, title: { en: 'Maize' }, prompt: { en: 'What about maize?' } };

    await ChatBotComponent.methods.selectQuickHelpOption.call(stOnly, BUTTON);
    await ChatBotComponent.methods.selectQuickHelpOption.call(noSt, noStButton);

    const lastContent = (call) =>
      chatbotService.submitQuery.mock.calls[call][0].messages.at(-1).content;
    expect(lastContent(0)).toBe('Ke lijalo life tse holang hantle sebakeng sa ka?');
    expect(lastContent(1)).toBe('What about maize?');
  });

  it('button click on the streaming transport (production default) carries the same clean payload', async () => {
    streamChatQuery.mockResolvedValue({ queryId: 'q2', metadata: {}, sessionId: 'sess-2' });
    const ctx = makeCtx({ useStreaming: true });

    await ChatBotComponent.methods.selectQuickHelpOption.call(ctx, BUTTON);

    expect(streamChatQuery).toHaveBeenCalledTimes(1);
    const payload = streamChatQuery.mock.calls[0][0];
    expect(payload.contextOption).toBe('conversation-with-context-labels');
    expect(payload.context.serviceLabels).toEqual([]);
    expect(payload.messages.at(-1).content).toBe('What crops grow best in my region?');
  });
});

describe('ChatBotComponent quick-help fabricators stay dead (J.2 review, DEC-27)', () => {
  it('removeContextItem clears state instead of resurrecting a quick-help chip', () => {
    const ctx = makeCtx({
      selectedContextItems: [{ service: 'Crop advice', serviceKey: 'quickhelp.cropManagement', category: '248445', selected: true }],
      currentCategoryId: '248445',
    });

    ChatBotComponent.methods.removeContextItem.call(ctx, 0);

    expect(ctx.selectedContextItems).toHaveLength(0);
    expect(ctx.currentCategoryId).toBeNull();
  });

  it('loadExistingConversation scrubs legacy quick-help tags and stock category IDs', async () => {
    chatHistoryService.getConversation.mockResolvedValue({
      _key: 'chat-1',
      title: 'Old button chat',
      messages: [{ sender: 'user', content: 'hi' }],
      files: [],
      categoryId: '248445',
      tags: ['quickhelp.cropManagement', 'Some Real Service'],
    });
    const ctx = makeCtx({ safeTranslate: (k) => k });

    await ChatBotComponent.methods.loadExistingConversation.call(ctx, 'chat-1');

    expect(ctx.currentCategoryId).toBeNull();
    const keys = ctx.selectedContextItems.map((item) => item.serviceKey);
    expect(keys).toEqual(['Some Real Service']);
  });

  it('loadExistingConversation scrubs the no-tags fallback too (category.<stock-id> shape)', async () => {
    chatHistoryService.getConversation.mockResolvedValue({
      _key: 'chat-2',
      title: 'Older button chat',
      messages: [{ sender: 'user', content: 'hi' }],
      files: [],
      categoryId: '248447',
      // no tags → the restore fallback fabricates a category.248447 item
    });
    const ctx = makeCtx({ safeTranslate: (k) => k, getCategoryLabelById: () => 'Pest control' });

    await ChatBotComponent.methods.loadExistingConversation.call(ctx, 'chat-2');

    expect(ctx.selectedContextItems).toHaveLength(0);
    expect(ctx.currentCategoryId).toBeNull();
  });
});

describe('ChatBotComponent quick-help loader (J.4, DEC-28)', () => {
  it('backend failure = loud error + empty grid, never a baked-config fallback', async () => {
    const { getButtons } = require('../../services/quickhelpService');
    getButtons.mockRejectedValueOnce(new Error('backend down'));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = makeCtx({ _quickHelpLoadSeq: 0, quickHelpButtons: [BUTTON] });

    try {
      await ChatBotComponent.methods.loadQuickHelpButtons.call(ctx);
    } finally {
      errorSpy.mockRestore();
    }

    expect(ctx.quickHelpButtons).toEqual([]);
    expect(getButtons).toHaveBeenCalledTimes(1);
  });
});
