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
    store.commit('conversation/failStream', { message: 'Network request failed', errorKey: 'chatbot.streamingError' });
    const open = store.getters['conversation/openConversation'];
    expect(open.isStreaming).toBe(false);
    expect(open.messages.at(-1).content).toMatch(/failed/i);
    expect(open.messages.at(-1).isError).toBe(true);
    expect(open.messages.at(-1).errorKey).toBe('chatbot.streamingError');
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
    const unsubscribe = subscribeConversation(store);
    store.commit('conversation/setTitle', 'Persisted');
    unsubscribe();
    const raw = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
    expect(raw.openId).toBe('open');
    expect(raw.conversations.open.title).toBe('Persisted');
  });

  it('persists mid-stream: a chunk storm cannot defer the write past the wall', () => {
    // A trailing debounce alone never fires while frames keep landing —
    // every chunk re-arms it, and a reload mid-generation would find an
    // empty answer. The wall on the first change caps the deferral.
    // Mutation check: revert subscribeConversation to a pure trailing
    // debounce and the stored content stays empty at the end of the storm.
    jest.useFakeTimers();
    const store = freshStore();
    const unsubscribe = subscribeConversation(store);
    try {
      store.commit('conversation/appendUserMessage', { sender: 'user', content: 'q' });
      store.commit('conversation/appendBotMessage', { sender: 'bot', content: '', isStreaming: true });
      for (let i = 0; i < 25; i++) {
        jest.advanceTimersByTime(100);
        store.commit('conversation/appendChunk', 'x');
      }
      // Mid-storm: the wall has already fired while frames keep landing —
      // storage holds a partial answer (a pure trailing debounce holds none).
      const midStream = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
      expect(midStream.conversations.open.messages.at(-1).content.length).toBeGreaterThan(0);
      // And once the frames stop, the trailing write completes the answer.
      jest.advanceTimersByTime(300);
      const final = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
      expect(final.conversations.open.messages.at(-1).content).toBe('x'.repeat(25));
    } finally {
      unsubscribe();
      jest.useRealTimers();
    }
  });

  it('rehydrates a stored conversation and marks an interrupted stream', () => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        openId: 'open',
        conversations: {
          open: {
            messages: [
              { sender: 'user', content: 'the interrupted question' },
              { sender: 'bot', content: 'partial', isStreaming: true }
            ],
            selectedContextItems: [],
            lastSavedState: { messages: [], contextItems: [] },
            conversationId: null,
            title: '',
            isStreaming: true,
            streamingQueryId: null,
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
    expect(open.messages.at(-1).isError).toBe(true);
    // The question leaves with its dead answer, as one unit.
    expect(open.messages[0].isError).toBe(true);
  });

  it('rehydration keeps a failure but drops its reason key', () => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        openId: 'open',
        conversations: {
          open: {
            messages: [
              { sender: 'user', content: 'the failed question' },
              {
                sender: 'bot',
                content: 'This language is not available for this deployment.',
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
      })
    );
    const store = freshStore();
    rehydrateConversation(store.state.conversation);
    const restored = store.getters['conversation/openConversation'].messages.at(-1);
    // The retry affordance survives the reload; the reason key does not —
    // it belonged to the session the failure happened in.
    expect(restored.isError).toBe(true);
    expect(restored.errorKey).toBeUndefined();
  });

  it('markInterrupted marks the aborted question together with its answer', () => {
    // Mutation check: dropping the backward walk from
    // markEntryInterrupted leaves this test green — it is the only
    // coverage of the abort-path pairing.
    const store = freshStore();
    store.commit('conversation/appendUserMessage', { sender: 'user', content: 'the question' });
    store.commit('conversation/appendBotMessage', { sender: 'bot', content: '', isStreaming: true });
    store.commit('conversation/markInterrupted');
    const open = store.getters['conversation/openConversation'];
    expect(open.messages[0].isError).toBe(true);
    expect(open.messages[1].isError).toBe(true);
    expect(open.messages[1].isStreaming).toBe(false);
  });

  it('discards a shape-mismatched payload and starts clean', () => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ messages: [] }));
    const store = freshStore();
    rehydrateConversation(store.state.conversation);
    expect(store.getters['conversation/openConversation'].messages).toEqual([]);
  });

  it('fills defaults for a stored entry missing fields the view reads', () => {
    // A payload with messages but no context/saved-state would crash the
    // chat view's first render if restored verbatim.
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        openId: 'open',
        conversations: {
          open: { messages: [{ sender: 'user', content: 'q' }] }
        }
      })
    );
    const store = freshStore();
    rehydrateConversation(store.state.conversation);
    const open = store.getters['conversation/openConversation'];
    expect(open.messages).toEqual([{ sender: 'user', content: 'q' }]);
    expect(open.selectedContextItems).toEqual([]);
    expect(open.lastSavedState).toEqual({ messages: [], contextItems: [] });
    expect(open.relatedDocuments).toEqual([]);
    expect(open.isStreaming).toBe(false);
  });

  it('restores the persisted related documents', () => {
    const doc = { id: 'doc-1', title: 'Guide', type: 'PDF', url: '/api/files/doc-1/download', size: 0 };
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        openId: 'open',
        conversations: {
          open: {
            messages: [{ sender: 'user', content: 'q' }],
            relatedDocuments: [doc]
          }
        }
      })
    );
    const store = freshStore();
    rehydrateConversation(store.state.conversation);
    expect(store.getters['conversation/openConversation'].relatedDocuments).toEqual([doc]);
  });

  it('flushes the write when the page hides (reload inside the debounce window)', () => {
    const store = freshStore();
    const unsubscribe = subscribeConversation(store);
    store.commit('conversation/appendUserMessage', { sender: 'user', content: 'q' });
    // No timer advance: the pagehide handler must write through
    // synchronously or a reload within the 300 ms window drops the turn.
    document.dispatchEvent(new Event('pagehide'));
    const raw = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
    expect(raw.conversations.open.messages.at(-1).content).toBe('q');
    unsubscribe();
  });

  it('pagehide with an empty debounce writes nothing (the debounced write is already current)', () => {
    // The skip relies on the invariant that every conversation write is
    // a conversation/ mutation — nothing can change the state without
    // arming the timer. Pin the branch: no mutation, no write, no error.
    const store = freshStore();
    const unsubscribe = subscribeConversation(store);
    document.dispatchEvent(new Event('pagehide'));
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    unsubscribe();
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

  // Each classification branch of the store's onError: the errorKey it
  // records is the chat view's notification contract, the status write
  // is the deployment view.
  describe('onError classification', () => {
    async function failingStream(store, error) {
      let captured = null;
      jest.spyOn(chatbotService, 'submitQueryStream').mockImplementation((q, cb) => {
        captured = cb;
        return new AbortController();
      });
      store.commit('conversation/appendBotMessage', { sender: 'bot', content: '', isStreaming: true });
      store.dispatch('conversation/sendStream', { queryData: { query: 'q' } });
      await Promise.resolve();
      captured.onError(error);
    }

    it('a refusal stays online and records the unsupported-language key', async () => {
      const store = freshStore();
      // Start from a genuine outage so the assertion proves restoration,
      // not the status module's pristine default.
      store.commit('status/setOffline', 'Previous outage');
      const refusal = new Error('Unsupported target language');
      refusal.status = 400;
      refusal.code = 'UNSUPPORTED_LANGUAGE';
      await failingStream(store, refusal);
      const open = store.getters['conversation/openConversation'];
      expect(open.messages.at(-1).errorKey).toBe('chatbot.unsupportedLanguage');
      expect(open.messages.at(-1).content).toBe('This language is not available for this deployment.');
      expect(store.state.status.online).toBe(true);
      expect(store.state.status.errorMessage).toBe('');
    });

    it('a refusal of another kind stays online under the generic processing key', async () => {
      const store = freshStore();
      store.commit('status/setOffline', 'Previous outage');
      const refusal = new Error('Bad request');
      refusal.status = 422;
      await failingStream(store, refusal);
      const open = store.getters['conversation/openConversation'];
      expect(open.messages.at(-1).errorKey).toBe('chatbot.processingError');
      expect(open.messages.at(-1).content).toBe('Error processing your request.');
      expect(store.state.status.online).toBe(true);
    });

    it('an idle stream times out, offline, under the timeout key', async () => {
      const store = freshStore();
      const timeout = new Error('The stream went idle');
      timeout.code = 'STREAM_IDLE_TIMEOUT';
      await failingStream(store, timeout);
      const open = store.getters['conversation/openConversation'];
      expect(open.messages.at(-1).errorKey).toBe('chatbot.streamTimeout');
      expect(open.messages.at(-1).content).toBe('The assistant is not responding — the request timed out.');
      expect(store.state.status.online).toBe(false);
    });

    it('a server error frame keeps its prose verbatim, without a key', async () => {
      const store = freshStore();
      const serverError = new Error('The retriever timed out');
      serverError.fromServer = true;
      await failingStream(store, serverError);
      const open = store.getters['conversation/openConversation'];
      expect(open.messages.at(-1).errorKey).toBeNull();
      expect(open.messages.at(-1).content).toBe('The retriever timed out');
      expect(store.state.status.online).toBe(false);
      expect(store.state.status.errorMessage).toBe('The retriever timed out');
    });

    it('a server error frame without prose falls back to the generic failure', async () => {
      const store = freshStore();
      const serverError = new Error('');
      serverError.fromServer = true;
      await failingStream(store, serverError);
      const open = store.getters['conversation/openConversation'];
      expect(open.messages.at(-1).errorKey).toBe('chatbot.streamingError');
      expect(open.messages.at(-1).content).toBe('Response was interrupted. Please try again.');
      expect(store.state.status.errorMessage).toBe('Response was interrupted. Please try again.');
    });
  });

  it('abortStream aborts the controller and marks the abandoned turn for retry', () => {
    const controller = new AbortController();
    const abortSpy = jest.spyOn(controller, 'abort');
    const store = storeWithService(() => controller);
    store.commit('conversation/appendBotMessage', { sender: 'bot', content: '', isStreaming: true });
    store.dispatch('conversation/sendStream', { queryData: { query: 'q' } });
    store.dispatch('conversation/abortStream');
    expect(abortSpy).toHaveBeenCalled();
    const open = store.getters['conversation/openConversation'];
    expect(open.isStreaming).toBe(false);
    // The service swallows the AbortError, so the abort itself must
    // close the turn — the retry affordance replaces the spinner.
    expect(open.messages.at(-1)?.isError).toBe(true);
    expect(open.messages.at(-1)?.isStreaming).toBe(false);
  });

  it('abortStream is a no-op when no stream is running', () => {
    const store = storeWithService(() => new AbortController());
    store.commit('conversation/appendBotMessage', { sender: 'bot', content: 'done', isSaved: true });
    store.dispatch('conversation/abortStream');
    const open = store.getters['conversation/openConversation'];
    expect(open.messages.at(-1)?.isError).toBeFalsy();
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

describe('conversation misc mutations', () => {
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
});
