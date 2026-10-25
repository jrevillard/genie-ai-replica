'use strict';

const { createStore } = require('vuex');
const conversationModule = require('../../store/modules/conversation.js').default;
const {
  STORAGE_KEY,
  persistConversation,
  rehydrateConversation,
  subscribeConversation
} = require('../../store/modules/conversation.js');

const statusModule = require('../../store/modules/status.js').default;

function freshStore() {
  return createStore({
    modules: {
      conversation: { ...conversationModule, state: () => conversationModule.state() },
      status: { ...statusModule, state: () => ({ ...statusModule.state }) }
    }
  });
}

describe('conversation module', () => {
  it('starts with one open empty conversation', () => {
    const store = freshStore();
    expect(store.state.conversation.openId).toBe('open');
    const open = store.getters['conversation/openConversation'];
    expect(open.messages).toEqual([]);
    expect(open.selectedContextItems).toEqual([]);
    expect(open.isStreaming).toBe(false);
    expect(open.streamInterrupted).toBe(false);
  });

  it('appendChunk appends to the last bot message', () => {
    const store = freshStore();
    store.commit('conversation/appendBotMessage', { sender: 'bot', content: '', isStreaming: true });
    store.commit('conversation/appendChunk', 'Hello');
    store.commit('conversation/appendChunk', ' world');
    const open = store.getters['conversation/openConversation'];
    expect(open.messages.at(-1).content).toBe('Hello world');
  });

  it('appendUserMessage / appendBotMessage grow the transcript', () => {
    const store = freshStore();
    store.commit('conversation/appendUserMessage', { sender: 'user', content: 'q', timestamp: 1 });
    store.commit('conversation/appendBotMessage', { sender: 'bot', content: '', isStreaming: true });
    expect(store.getters['conversation/openConversation'].messages.length).toBe(2);
  });

  it('finishStream stamps the query id and clears streaming state', () => {
    const store = freshStore();
    store.commit('conversation/appendBotMessage', { sender: 'bot', content: 'x', isStreaming: true });
    store.commit('conversation/finishStream', 'q-7');
    const open = store.getters['conversation/openConversation'];
    expect(open.isStreaming).toBe(false);
    expect(open.streamingQueryId).toBe('q-7');
    expect(open.messages.at(-1).isStreaming).toBe(false);
  });

  it('failStream writes the error into the last bot message', () => {
    const store = freshStore();
    store.commit('conversation/appendBotMessage', { sender: 'bot', content: '', isStreaming: true });
    store.commit('conversation/failStream', 'Network request failed');
    const open = store.getters['conversation/openConversation'];
    expect(open.isStreaming).toBe(false);
    expect(open.messages.at(-1).content).toMatch(/failed/i);
    expect(open.messages.at(-1).isError).toBe(true);
  });

  it('setLastBotProperty writes through for arbitrary turn fields', () => {
    const store = freshStore();
    store.commit('conversation/appendBotMessage', { sender: 'bot', content: 'a' });
    store.commit('conversation/setLastBotProperty', ['userFeedback', 'up']);
    expect(store.getters['conversation/openConversation'].messages.at(-1).userFeedback).toBe('up');
  });

  it('resetForNewConversation restores the pristine single entry', () => {
    const store = freshStore();
    store.commit('conversation/appendUserMessage', { sender: 'user', content: 'q' });
    store.commit('conversation/resetForNewConversation');
    const open = store.getters['conversation/openConversation'];
    expect(open.messages).toEqual([]);
    expect(open.conversationId).toBeNull();
    expect(open.relatedDocuments).toEqual([]);
  });

  it('replaceConversation installs a loaded history conversation', () => {
    const store = freshStore();
    store.commit('conversation/replaceConversation', {
      messages: [{ sender: 'user', content: 'old' }],
      title: 'Old chat',
      conversationId: 'conv-1'
    });
    const open = store.getters['conversation/openConversation'];
    expect(open.messages.length).toBe(1);
    expect(open.title).toBe('Old chat');
    expect(open.conversationId).toBe('conv-1');
  });
});

describe('conversation persistence', () => {
  beforeEach(() => {
    sessionStorage.clear();
    jest.restoreAllMocks();
  });

  it('persists the conversations map under the versioned key', () => {
    const store = freshStore();
    store.commit('conversation/appendUserMessage', { sender: 'user', content: 'q' });
    jest.spyOn(window, 'setTimeout').mockImplementation((fn) => {
      fn();
      return 1;
    });
    subscribeConversation(store);
    store.commit('conversation/setTitle', 'Persisted');
    const raw = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
    expect(raw.openId).toBe('open');
    expect(raw.conversations.open.title).toBe('Persisted');
  });

  it('rehydrates a stored conversation and marks an interrupted stream', () => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        openId: 'open',
        conversations: {
          open: {
            messages: [{ sender: 'bot', content: 'partial', isStreaming: true }],
            selectedContextItems: [],
            lastSavedState: { messages: [], contextItems: [] },
            conversationId: null,
            title: '',
            isStreaming: true,
            streamingQueryId: null,
            streamInterrupted: false,
            relatedDocuments: []
          }
        }
      })
    );
    const store = freshStore();
    rehydrateConversation(store.state.conversation);
    const open = store.getters['conversation/openConversation'];
    expect(open.messages.at(-1).content).toBe('partial');
    expect(open.isStreaming).toBe(false);
    expect(open.streamInterrupted).toBe(true);
    expect(open.messages.at(-1).isError).toBe(true);
  });

  it('discards a shape-mismatched payload and starts clean', () => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ messages: [] }));
    const store = freshStore();
    rehydrateConversation(store.state.conversation);
    expect(store.getters['conversation/openConversation'].messages).toEqual([]);
  });

  it('survives a full storage (quota error is degraded, not thrown)', () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(() => persistConversation(freshStore().state.conversation)).not.toThrow();
  });
});

describe('conversation sendStream action', () => {
  const chatbotService = require('../../services/chatbotService.js').default;

  function storeWithService(streamImpl) {
    const store = freshStore();
    jest.spyOn(chatbotService, 'submitQueryStream').mockImplementation(streamImpl);
    return store;
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('opens a stream, writes chunks, stamps metadata and finishes', async () => {
    let captured = null;
    const store = storeWithService((queryData, callbacks) => {
      captured = callbacks;
      return new AbortController();
    });
    store.commit('conversation/appendBotMessage', { sender: 'bot', content: '', isStreaming: true });
    store.dispatch('conversation/sendStream', { queryData: { query: 'q' } });
    await Promise.resolve();
    expect(store.getters['conversation/openConversation'].isStreaming).toBe(true);

    captured.onChunk('Hel');
    captured.onChunk('lo');
    captured.onMetadata({
      confidence_score: 0.9,
      is_grounded: true,
      source_documents: [{ document_id: 'd1', document_name: 'A.pdf', score: 0.9 }]
    });
    captured.onDone({ queryId: 'q-1' });

    const open = store.getters['conversation/openConversation'];
    expect(open.messages.at(-1).content).toBe('Hello');
    expect(open.messages.at(-1).confidenceScore).toBe(0.9);
    expect(open.messages.at(-1).queryId).toBe('q-1');
    expect(open.isStreaming).toBe(false);
  });

  it('maps source documents into per-message sources and the sidebar', () => {
    let captured = null;
    const store = storeWithService((q, cb) => {
      captured = cb;
      return new AbortController();
    });
    store.commit('conversation/appendBotMessage', { sender: 'bot', content: '', isStreaming: true });
    store.dispatch('conversation/sendStream', { queryData: { query: 'q' } });
    return Promise.resolve().then(() => {
      captured.onMetadata({
        confidence_score: 0.82,
        is_grounded: true,
        source_documents: [{ document_id: 'doc-1', document_name: 'Guide', score: 0.9 }]
      });
      const open = store.getters['conversation/openConversation'];
      expect(open.messages.at(-1).sources.length).toBe(1);
      expect(open.messages.at(-1).sources[0].url).toBe('/api/files/doc-1/download');
      expect(open.relatedDocuments.length).toBe(1);
    });
  });

  it('writes the error path and reports offline via the status module', async () => {
    let captured = null;
    const store = storeWithService((q, cb) => {
      captured = cb;
      return new AbortController();
    });
    store.commit('status/setOnline');
    store.commit('conversation/appendBotMessage', { sender: 'bot', content: '', isStreaming: true });
    store.dispatch('conversation/sendStream', { queryData: { query: 'q' } });
    await Promise.resolve();
    captured.onError(new Error('Stream failed'));
    const open = store.getters['conversation/openConversation'];
    expect(open.messages.at(-1).isError).toBe(true);
    expect(store.state.status.online).toBe(false);
  });

  it('abortStream aborts the controller without marking an error', () => {
    const controller = new AbortController();
    const abortSpy = jest.spyOn(controller, 'abort');
    const store = storeWithService(() => controller);
    store.commit('conversation/appendBotMessage', { sender: 'bot', content: '', isStreaming: true });
    store.dispatch('conversation/sendStream', { queryData: { query: 'q' } });
    store.dispatch('conversation/abortStream');
    expect(abortSpy).toHaveBeenCalled();
    expect(store.getters['conversation/openConversation'].isStreaming).toBe(false);
    expect(store.getters['conversation/openConversation'].messages.at(-1)?.isError).toBeFalsy();
  });

  it('translation replaces the streaming content', async () => {
    let captured = null;
    const store = storeWithService((q, cb) => {
      captured = cb;
      return new AbortController();
    });
    store.commit('conversation/appendBotMessage', { sender: 'bot', content: '', isStreaming: true });
    store.dispatch('conversation/sendStream', { queryData: { query: 'q' } });
    await Promise.resolve();
    captured.onChunk('EN text');
    captured.onTranslation('FR texte');
    expect(store.getters['conversation/openConversation'].messages.at(-1).content).toBe('FR texte');
  });
});
it('spliceMessages drops turns from a position', () => {
  const store = freshStore();
  for (let i = 0; i < 4; i++) {
    store.commit('conversation/appendUserMessage', { sender: 'user', content: 'q' + i });
  }
  store.commit('conversation/spliceMessages', [1, 2]);
  const msgs = store.getters['conversation/openConversation'].messages;
  expect(msgs.map((m) => m.content)).toEqual(['q0', 'q3']);
});

it('setContextItems replaces the context list', () => {
  const store = freshStore();
  store.commit('conversation/setContextItems', [{ service: 'A', category: 1 }]);
  expect(store.getters['conversation/openConversation'].selectedContextItems.length).toBe(1);
});
