/**
 * G.2a (FR13) + K.7 frontend pins — the locale wire and the always-conversation
 * payload.
 *
 * G.2a: the chat payload MUST carry the UI locale (`context.language`,
 * upper-cased — chatqna compares exact "EN"/"ST"). Before G.2a the default
 * branch sent no language at all, chatqna fell back to langdetect (no Sesotho
 * → misdetect) and the whole ST machinery was bypassed — the live 10-01 bug.
 *
 * K.7 (10-06): sendMessage ALWAYS builds the conversation payload (messages
 * array + conversationId + context). The old tree-selection gate sent `text`
 * alone for plain chats, so every plain message reached chatqna as a
 * brand-new conversation. Restoring that conditional, dropping the cap, or
 * letting a UI-only bubble (greeting/error/notice) onto the wire must fail
 * these tests. getCategoryLabelById is NOT stubbed: a DEC-27 regression
 * (null id → fabricated 'General') would silently zero retrieval on the
 * default path — the J.2 bug class.
 *
 * Seam: sendMessage() invoked with a constructed component context (Options
 * API methods are plain functions) and the chat service mocked — the payload
 * construction executes for real without mounting the full component.
 */
import ChatBotComponent, { HISTORY_MESSAGE_CAP } from '../ChatBotComponent.vue';
import chatbotService from '../../services/chatbotService';

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
jest.mock('../../services/chatHistoryService', () => ({ getChats: jest.fn().mockResolvedValue([]) }));
jest.mock('../../services/analyticsService', () => ({ logEvent: jest.fn() }));
jest.mock('../../eventBus.js', () => ({
  eventBus: { $emit: jest.fn(), $on: jest.fn(), $off: jest.fn() },
}));

function makeCtx(overrides = {}) {
  return Object.assign(
    {
      newMessage: 'Ke lijalo life tse holang hantle sebakeng sa ka?',
      isLoading: false,
      chatMessages: [],
      selectedContextItems: [],
      currentCategoryId: null,
      conversationId: null,
      currentSessionId: 'sess-1',
      currentChatId: null,
      currentLocale: 'st', // non-EN locale, lowercase as vue-i18n stores it
      serviceCategories: [], // empty taxonomy → the REAL getCategoryLabelById runs
      useStreaming: false, // pin the classic submit path; streaming shares queryData
      showQuickHelp: false,
      relatedDocuments: [],
      systemStatus: {},
      translate: (k) => k,
      getCategoryLabelById: ChatBotComponent.methods.getCategoryLabelById,
      getWeatherLocation: () => null,
      scrollToBottom: jest.fn(),
      updateChatInHistory: jest.fn(),
      applySourceDocuments: jest.fn(),
      $store: { getters: { currentUser: { _key: 'user-1' } } },
    },
    overrides
  );
}

describe('ChatBotComponent.sendMessage payload locale (G.2a)', () => {
  it('payload carries the upper-cased UI locale in context.language', async () => {
    chatbotService.submitQuery.mockResolvedValue({ response: 'OK', queryId: 'q1' });

    await ChatBotComponent.methods.sendMessage.call(makeCtx());

    expect(chatbotService.submitQuery).toHaveBeenCalledTimes(1);
    const payload = chatbotService.submitQuery.mock.calls[0][0];
    expect(payload.context.language).toBe('ST');
  });
});

describe('ChatBotComponent.sendMessage always-conversation payload (K.7)', () => {
  it('plain chat (no tree items) sends the messages array + conversationId with empty labels and a null category', async () => {
    chatbotService.submitQuery.mockClear();
    chatbotService.submitQuery.mockResolvedValue({ response: 'OK', queryId: 'q1' });
    const ctx = makeCtx({
      newMessage: 'How do I plant it?',
      currentLocale: 'en',
      conversationId: 'chat-7',
      chatMessages: [
        { sender: 'user', content: 'What can you tell me about maize?' },
        { sender: 'bot', content: 'Maize is...' },
      ],
    });

    await ChatBotComponent.methods.sendMessage.call(ctx);

    const payload = chatbotService.submitQuery.mock.calls[0][0];
    expect(payload.contextOption).toBe('conversation-with-context-labels');
    expect(payload.conversationId).toBe('chat-7');
    expect(payload.messages).toEqual([
      { role: 'user', content: 'What can you tell me about maize?' },
      { role: 'assistant', content: 'Maize is...' },
      { role: 'user', content: 'How do I plant it?' },
    ]);
    // null id must resolve to null — a fabricated 'General' is the J.2 zero-retrieval bug
    expect(payload.context.categoryLabel).toBeNull();
    expect(payload.context).toMatchObject({ serviceLabels: [], language: 'EN' });
    expect(payload).not.toHaveProperty('text');
  });

  it(`caps the wire at the last ${HISTORY_MESSAGE_CAP} real messages on restored long chats`, async () => {
    chatbotService.submitQuery.mockClear();
    chatbotService.submitQuery.mockResolvedValue({ response: 'OK', queryId: 'q1' });
    // 30 restored messages; sendMessage pushes the 31st (the new user turn)
    const chatMessages = [];
    for (let i = 1; i <= 30; i++) {
      chatMessages.push({ sender: 'user', content: `turn ${i}` });
    }
    const ctx = makeCtx({ newMessage: 'turn 31', currentLocale: 'en', chatMessages });

    await ChatBotComponent.methods.sendMessage.call(ctx);

    const payload = chatbotService.submitQuery.mock.calls[0][0];
    expect(payload.messages).toHaveLength(HISTORY_MESSAGE_CAP);
    const firstKept = 31 - HISTORY_MESSAGE_CAP + 1;
    expect(payload.messages[0].content).toBe(`turn ${firstKept}`);
    expect(payload.messages[HISTORY_MESSAGE_CAP - 1].content).toBe('turn 31');
  });

  it(`sends exactly the last ${HISTORY_MESSAGE_CAP} REAL turns — UI-only bubbles never ship and never displace real ones`, async () => {
    chatbotService.submitQuery.mockClear();
    chatbotService.submitQuery.mockResolvedValue({ response: 'OK', queryId: 'q1' });
    // 31 real turns (30 restored + the new one) with 3 UI-only bubbles
    // sprinkled in, one inside the last-20 window, two at the very front.
    const chatMessages = [
      { sender: 'bot', content: 'Welcome!', isUiOnly: true },
      { sender: 'bot', content: 'chatqna returned 500', isUiOnly: true },
    ];
    for (let i = 1; i <= 30; i++) {
      chatMessages.push({ sender: 'user', content: `turn ${i}` });
    }
    chatMessages.push({ sender: 'bot', content: '> ⚠️ response truncated', isUiOnly: true });
    const ctx = makeCtx({ newMessage: 'turn 31', currentLocale: 'en', chatMessages });

    await ChatBotComponent.methods.sendMessage.call(ctx);

    const payload = chatbotService.submitQuery.mock.calls[0][0];
    expect(payload.messages).toHaveLength(HISTORY_MESSAGE_CAP);
    expect(payload.messages.some((m) => m.content.includes('Welcome!'))).toBe(false);
    expect(payload.messages.some((m) => m.content.includes('500'))).toBe(false);
    expect(payload.messages.some((m) => m.content.includes('truncated'))).toBe(false);
    // 31 real turns − 20 kept: opens on turn 12, closes on the just-sent turn 31
    expect(payload.messages[0].content).toBe('turn 12');
    expect(payload.messages[HISTORY_MESSAGE_CAP - 1].content).toBe('turn 31');
  });

  it('a greeting bubble never ships even as the only prior turn', async () => {
    chatbotService.submitQuery.mockClear();
    chatbotService.submitQuery.mockResolvedValue({ response: 'OK', queryId: 'q1' });
    const ctx = makeCtx({
      newMessage: 'first real question',
      currentLocale: 'en',
      chatMessages: [
        { sender: 'bot', content: 'Welcome to Agrivisory!', isUiOnly: true },
      ],
    });

    await ChatBotComponent.methods.sendMessage.call(ctx);

    const payload = chatbotService.submitQuery.mock.calls[0][0];
    expect(payload.messages).toEqual([
      { role: 'user', content: 'first real question' },
    ]);
  });

  it('drops a leading assistant turn so the shipped history opens on a user turn (pair alignment)', async () => {
    chatbotService.submitQuery.mockClear();
    chatbotService.submitQuery.mockResolvedValue({ response: 'OK', queryId: 'q1' });
    // Restored chat that opens on a real (non-UI) assistant turn
    const ctx = makeCtx({
      newMessage: 'how do I plant it?',
      currentLocale: 'en',
      chatMessages: [
        { sender: 'bot', content: 'Maize is a staple crop...' },
        { sender: 'user', content: 'tell me about maize' },
      ],
    });

    await ChatBotComponent.methods.sendMessage.call(ctx);

    const payload = chatbotService.submitQuery.mock.calls[0][0];
    expect(payload.messages[0].role).toBe('user');
    expect(payload.messages).toEqual([
      { role: 'user', content: 'tell me about maize' },
      { role: 'user', content: 'how do I plant it?' },
    ]);
  });

  it('tree-selected chat keeps real labels in the same conversation payload', async () => {
    chatbotService.submitQuery.mockClear();
    chatbotService.submitQuery.mockResolvedValue({ response: 'OK', queryId: 'q1' });
    const ctx = makeCtx({
      newMessage: 'maize question',
      currentLocale: 'en',
      selectedContextItems: [
        { service: 'Crop Protection', serviceKey: 'Crop Protection', category: '1', selected: true },
      ],
    });

    await ChatBotComponent.methods.sendMessage.call(ctx);

    const payload = chatbotService.submitQuery.mock.calls[0][0];
    expect(payload.context.serviceLabels).toEqual(['Crop Protection']);
    expect(payload.messages.at(-1)).toEqual({ role: 'user', content: 'maize question' });
  });
});
