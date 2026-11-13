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
// The real en locale: the store's failure wordings must match it, or the
// suite goes red. The mocked i18n module (wired by jest.config.js's
// moduleNameMapper) sends t() to the store's fallback floor, so these
// assertions pin floor == locale.
const enChatbot = require('../../i18n/locales/en.js').default.chatbot;

// CAP-3/CAP-4: the store's title resolver goes through document-opener; mock
// the fetch so title/source-resolution tests stay hermetic.
jest.mock('../../utils/document-opener', () => ({
  __esModule: true,
  fetchOkfConcept: jest.fn(),
  okfConceptTitle: jest.requireActual('../../utils/document-opener').okfConceptTitle
}));
const { fetchOkfConcept } = require('../../utils/document-opener');

// #1817: the restore repair resolves a legacy row's repo through okf-server.
jest.mock('../../services/conceptService', () => ({
  __esModule: true,
  default: { resolveRepo: jest.fn() }
}));
const conceptService = require('../../services/conceptService').default;

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

  it('failStream normalizes a missing errorKey and tolerates an empty payload', () => {
    const store = freshStore();
    store.commit('conversation/appendBotMessage', { sender: 'bot', content: '', isStreaming: true });
    // Server prose carries no key — the recorded value is null, not
    // undefined, so the view's null-check stays a null-check.
    store.commit('conversation/failStream', { message: 'The retriever timed out' });
    expect(store.getters['conversation/openConversation'].messages.at(-1).errorKey).toBeNull();
    // No payload at all must not throw — the turn just closes empty.
    store.commit('conversation/appendBotMessage', { sender: 'bot', content: '', isStreaming: true });
    expect(() => store.commit('conversation/failStream')).not.toThrow();
    expect(store.getters['conversation/openConversation'].messages.at(-1).errorKey).toBeNull();
    expect(store.getters['conversation/openConversation'].messages.at(-1).content).toBe('');
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

  it('RESET drops every conversation, not only the open one', () => {
    // Unlike resetForNewConversation, which keeps the conversations map and
    // only clears the open entry, the full reset must leave the fresh
    // single-entry shape — Reset User Data wipes all of it (#1455).
    const store = freshStore();
    store.commit('conversation/appendUserMessage', { sender: 'user', content: 'q' });
    store.state.conversation.conversations['other-id'] = { messages: [{ sender: 'user', content: 'old' }] };
    store.state.conversation.openId = 'other-id';

    store.commit('conversation/RESET');

    expect(store.state.conversation.openId).toBe('open');
    expect(Object.keys(store.state.conversation.conversations)).toEqual(['open']);
    expect(store.getters['conversation/openConversation'].messages).toEqual([]);
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

  it('replaces the stored payload synchronously on RESET', () => {
    // The subscription owns the storage key: a full reset must write the
    // fresh shape immediately — inside the debounce window a killed tab
    // would otherwise rehydrate the wiped conversation (mutation check:
    // revert the RESET branch in subscribeConversation and the stale
    // payload survives the assertion below).
    const store = freshStore();
    const unsubscribe = subscribeConversation(store);
    try {
      store.commit('conversation/appendUserMessage', { sender: 'user', content: 'old' });
      store.commit('conversation/RESET');
      const raw = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
      expect(raw.conversations.open.messages).toEqual([]);
    } finally {
      unsubscribe();
    }
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
  const documentFileService = require('../../services/documentFileService.js').default;

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

  // An OKF concept is not a repository document: chatqna emits it precisely
  // because the doc-repo lookup cannot answer for it (the concept's markdown
  // never becomes a doc-repo `files` doc). Asking anyway produced one 404
  // per cited concept on every OKF-citing query.
  it('never asks doc-repo about an OKF concept citation', async () => {
    const metadataSpy = jest
      .spyOn(documentFileService, 'getFileMetadata')
      .mockResolvedValue({ file_type: 'pdf', file_size: 4096 });
    let captured = null;
    const store = storeWithService((q, cb) => {
      captured = cb;
      return new AbortController();
    });
    store.commit('conversation/appendBotMessage', { sender: 'bot', content: '', isStreaming: true });
    store.dispatch('conversation/sendStream', { queryData: { query: 'q' } });
    await Promise.resolve();

    captured.onMetadata({
      source_documents: [
        {
          document_id: 'hadith-nawawi-36',
          document_name: 'hadith nawawi 36',
          url: '',
          score: 0.9,
          concept_id: 'hadith-nawawi-36',
          source: 'okf-concept'
        },
        { document_id: 'doc-1', document_name: 'Guide', url: '/api/files/doc-1/download', score: 0.8 }
      ]
    });

    const asked = metadataSpy.mock.calls.map((call) => call[0]);
    expect(asked).not.toContain('hadith-nawawi-36');
    expect(asked).toContain('doc-1');
  });

  it('keeps the OKF marker on the mapped citation', async () => {
    let captured = null;
    const store = storeWithService((q, cb) => {
      captured = cb;
      return new AbortController();
    });
    store.commit('conversation/appendBotMessage', { sender: 'bot', content: '', isStreaming: true });
    store.dispatch('conversation/sendStream', { queryData: { query: 'q' } });
    await Promise.resolve();

    captured.onMetadata({
      source_documents: [
        {
          document_id: 'hadith-nawawi-36',
          document_name: 'hadith nawawi 36',
          url: '',
          score: 0.9,
          concept_id: 'hadith-nawawi-36',
          source: 'okf-concept'
        }
      ]
    });

    const source = store.getters['conversation/openConversation'].messages.at(-1).sources[0];
    expect(source.source).toBe('okf-concept');
    expect(source.conceptId).toBe('hadith-nawawi-36');
    expect(source.title).toBe('hadith nawawi 36');
  });

  // Review fix (2026-11-07): the resolver DISPATCH wiring was unpinned —
  // every suite fed repo-less citations or called the action directly, so
  // deleting the sendStream dispatch left every gate green while cards kept
  // their raw concept-id titles forever. A repo-bearing citation must
  // resolve through the SAME turn's metadata frame.
  it('dispatches the CAP-3 title resolver when the metadata carries a repo-bearing OKF citation', async () => {
    let captured = null;
    const store = storeWithService((q, cb) => {
      captured = cb;
      return new AbortController();
    });
    store.commit('conversation/appendBotMessage', { sender: 'bot', content: '', isStreaming: true });
    store.dispatch('conversation/sendStream', { queryData: { query: 'q' } });
    await Promise.resolve();

    fetchOkfConcept.mockResolvedValueOnce({ frontmatter: { title: 'Alpha Concept' }, sources: [] });
    captured.onMetadata({
      confidence_score: 0.9,
      is_grounded: true,
      source_documents: [
        {
          document_id: 'wire_alpha_concept',
          document_name: 'wire_alpha_concept',
          url: '',
          score: 0.9,
          concept_id: 'wire_alpha_concept',
          source: 'okf-concept',
          repo_id: 'repo-1'
        }
      ]
    });
    // the resolver runs async after the frame — flush the microtask chain
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchOkfConcept).toHaveBeenCalledWith('repo-1', 'wire_alpha_concept');
    const source = store.getters['conversation/openConversation'].messages.at(-1).sources[0];
    expect(source.title).toBe('Alpha Concept');
    expect(source.titleResolved).toBe(true);
  });

  it('status timing survives going back online and dies with an outage', () => {
    const store = freshStore();
    store.commit('status/setResponseTime', 250);
    store.commit('status/setOnline');
    // Coming back online does not invalidate the last completed
    // exchange's timing; only the state where no answer arrived does.
    expect(store.state.status.lastResponseTime).toBe(250);
    store.commit('status/setOffline', 'down');
    expect(store.state.status.lastResponseTime).toBeNull();
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
      expect(open.messages.at(-1).content).toBe(enChatbot.unsupportedLanguage);
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
      expect(open.messages.at(-1).content).toBe(enChatbot.processingError);
      expect(store.state.status.online).toBe(true);
    });

    it('an idle stream times out, offline, under the timeout key', async () => {
      const store = freshStore();
      const timeout = new Error('The stream went idle');
      timeout.code = 'STREAM_IDLE_TIMEOUT';
      await failingStream(store, timeout);
      const open = store.getters['conversation/openConversation'];
      expect(open.messages.at(-1).errorKey).toBe('chatbot.streamTimeout');
      expect(open.messages.at(-1).content).toBe(enChatbot.streamTimeout);
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
      // The shape the transport actually emits for a message-less error
      // frame: chatbotService builds Error(undefined), whose message is ''.
      const store = freshStore();
      const serverError = new Error(undefined);
      serverError.fromServer = true;
      await failingStream(store, serverError);
      const open = store.getters['conversation/openConversation'];
      expect(open.messages.at(-1).errorKey).toBe('chatbot.streamingError');
      expect(open.messages.at(-1).content).toBe(enChatbot.streamingError);
      expect(store.state.status.errorMessage).toBe(enChatbot.streamingError);
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

// ===========================================================================
// CAP-3 (chat-source resolution): OKF concept citation cards. The mint names
// a concept by its id; the doc-repository URL family cannot resolve it —
// concept rows never take it, carry their repo identity, resolve titles
// asynchronously, and persisted pre-W3 rows are re-identified on rehydrate.
// ===========================================================================
describe('CAP-3 okf concept sources', () => {
  const { translateSources } = require('../../store/modules/conversation.js');

  beforeEach(() => {
    sessionStorage.clear();
    fetchOkfConcept.mockReset();
  });

  it('translateSources: an enriched okf row never takes the doc-repo URL and carries its identity', () => {
    const [row] = translateSources([
      {
        document_id: 'alpha_concept',
        document_name: 'alpha_concept',
        url: '',
        source: 'okf-concept',
        repo_id: 'repo-1',
        bundle_version: 3,
        graph_name: 'OKF_repo-1',
        score: 0.9
      }
    ]);
    expect(row.url).toBe('');
    expect(row.source).toBe('okf-concept');
    expect(row.repoId).toBe('repo-1');
    expect(row.bundleVersion).toBe(3);
    expect(row.graphName).toBe('OKF_repo-1');
    expect(row.type).toBe('MD');
  });

  it('translateSources: a legacy document row keeps the exact pre-existing shape', () => {
    const [row] = translateSources([{ document_id: 'doc-9', document_name: 'Report.pdf', score: 0.8 }]);
    expect(row.url).toBe('/api/files/doc-9/download');
    expect(row.source).toBeUndefined();
    expect(row.repoId).toBeUndefined();
    expect(row.type).toBe('LINK');
  });

  it('rehydrate grafts okf identity onto persisted concept rows and clears the dead URL', () => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        openId: 'open',
        conversations: {
          open: {
            messages: [
              { sender: 'user', content: 'q' },
              {
                sender: 'bot',
                content: 'a',
                sources: [{ id: 'alpha_concept', title: 'alpha concept', url: '/api/files/alpha_concept/download' }],
                metadata: {
                  source_documents: [
                    {
                      document_id: 'alpha_concept',
                      document_name: 'alpha_concept',
                      url: '',
                      source: 'okf-concept',
                      repo_id: 'repo-1',
                      bundle_version: 2
                    }
                  ]
                }
              }
            ],
            relatedDocuments: [
              { id: 'alpha_concept', title: 'alpha concept', url: '/api/files/alpha_concept/download' }
            ]
          }
        }
      })
    );
    const store = freshStore();
    rehydrateConversation(store.state.conversation);
    const open = store.getters['conversation/openConversation'];
    for (const row of [...open.relatedDocuments, ...open.messages[1].sources]) {
      expect(row.source).toBe('okf-concept');
      expect(row.repoId).toBe('repo-1');
      expect(row.bundleVersion).toBe(2);
      expect(row.url).toBe('');
    }
  });

  it('rehydrate leaves a legacy document row untouched', () => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        openId: 'open',
        conversations: {
          open: {
            messages: [{ sender: 'user', content: 'q' }],
            relatedDocuments: [{ id: 'doc-9', title: 'Report.pdf', url: '/api/files/doc-9/download' }]
          }
        }
      })
    );
    const store = freshStore();
    rehydrateConversation(store.state.conversation);
    const row = store.getters['conversation/openConversation'].relatedDocuments[0];
    expect(row.url).toBe('/api/files/doc-9/download');
    expect(row.source).toBeUndefined();
    expect(row.repoId).toBeUndefined();
  });

  it('rehydrate marks a pre-CAP-1 concept row (no repo identity) so the UI degrades honestly', () => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        openId: 'open',
        conversations: {
          open: {
            messages: [
              { sender: 'user', content: 'q' },
              {
                sender: 'bot',
                content: 'a',
                sources: [{ id: 'old_concept', title: 'old concept', url: '/api/files/old_concept/download' }],
                metadata: {
                  source_documents: [
                    { document_id: 'old_concept', document_name: 'old_concept', url: '', source: 'okf-concept' }
                  ]
                }
              }
            ],
            relatedDocuments: []
          }
        }
      })
    );
    const store = freshStore();
    rehydrateConversation(store.state.conversation);
    const row = store.getters['conversation/openConversation'].messages[1].sources[0];
    expect(row.source).toBe('okf-concept');
    expect(row.repoId).toBeNull();
    expect(row.url).toBe('');
  });

  it('resolveOkfSourceTitles swaps the id title for the frontmatter title and stashes the origins (CAP-4)', async () => {
    const store = freshStore();
    store.commit('conversation/appendUserMessage', { sender: 'user', content: 'q' });
    store.commit('conversation/appendBotMessage', { sender: 'bot', content: 'a' });
    store.commit('conversation/setRelatedDocuments', [
      { id: 'alpha_concept', title: 'alpha concept', source: 'okf-concept', repoId: 'repo-1' }
    ]);
    fetchOkfConcept.mockResolvedValueOnce({
      frontmatter: { title: 'Alpha Concept' },
      body: '# body',
      sources: [{ kind: 'document', file_id: 'doc-9', file_name: 'Report.pdf', locator: 'whole document' }]
    });
    await store.dispatch('conversation/resolveOkfSourceTitles');
    const row = store.getters['conversation/openConversation'].relatedDocuments[0];
    expect(row.title).toBe('Alpha Concept');
    expect(row.titleResolved).toBe(true);
    expect(fetchOkfConcept).toHaveBeenCalledWith('repo-1', 'alpha_concept');
    // CAP-4: the narrowed sources land on the row for the origin rows —
    // whatever the route shipped (already projected server-side, locator
    // stripped there); absent field degrades to [] (no affordance).
    expect(row.okfSources).toEqual([
      { kind: 'document', file_id: 'doc-9', file_name: 'Report.pdf', locator: 'whole document' }
    ]);
  });

  it('resolveOkfSourceTitles stashes an empty okfSources when the concept is DEFINITIVELY unavailable', async () => {
    const store = freshStore();
    store.commit('conversation/appendUserMessage', { sender: 'user', content: 'q' });
    store.commit('conversation/appendBotMessage', { sender: 'bot', content: 'a' });
    store.commit('conversation/setRelatedDocuments', [
      { id: 'ghost_concept', title: 'ghost concept', source: 'okf-concept', repoId: 'repo-1' }
    ]);
    // The DEFINITIVE unavailable code (restricted/retracted/deleted) — this
    // is the terminal case: the row keeps the id title and the cache pins
    // null. Review fix 2026-11-07: this test previously rejected with a
    // PLAIN error, pinning transient failures as permanent — the exact bug
    // the retry test below now guards.
    fetchOkfConcept.mockRejectedValueOnce(Object.assign(new Error('gone'), { code: 'OKF_CONCEPT_UNAVAILABLE' }));
    await store.dispatch('conversation/resolveOkfSourceTitles');
    const row = store.getters['conversation/openConversation'].relatedDocuments[0];
    expect(row.title).toBe('ghost concept');
    expect(row.titleResolved).toBe(false);
    expect(row.okfSources).toEqual([]);
  });

  it('resolveOkfSourceTitles retries after a TRANSIENT failure — the cache never pins it', async () => {
    const store = freshStore();
    store.commit('conversation/appendUserMessage', { sender: 'user', content: 'q' });
    store.commit('conversation/appendBotMessage', { sender: 'bot', content: 'a' });
    store.commit('conversation/setRelatedDocuments', [
      { id: 'flaky_concept', title: 'flaky concept', source: 'okf-concept', repoId: 'repo-1' }
    ]);
    // A plain error (500, network, token expiry) is transient: the row gets
    // no terminal marker and the cache stays empty — a later dispatch retries.
    fetchOkfConcept.mockRejectedValueOnce(new Error('500 — transient'));
    await store.dispatch('conversation/resolveOkfSourceTitles');
    let row = store.getters['conversation/openConversation'].relatedDocuments[0];
    expect(row.title).toBe('flaky concept');
    expect(row.titleResolved).toBeUndefined();
    expect(row.okfSources).toEqual([]);
    // later dispatch (next message / next open): the fetch runs again
    fetchOkfConcept.mockResolvedValueOnce({ frontmatter: { title: 'Flaky Concept' }, sources: [] });
    await store.dispatch('conversation/resolveOkfSourceTitles');
    expect(fetchOkfConcept).toHaveBeenCalledTimes(2);
    row = store.getters['conversation/openConversation'].relatedDocuments[0];
    expect(row.title).toBe('Flaky Concept');
    expect(row.titleResolved).toBe(true);
  });

  it('resolveOkfSourceTitles serves a fresh same-concept row from the pinned cache (no refetch)', async () => {
    const store = freshStore();
    store.commit('conversation/appendUserMessage', { sender: 'user', content: 'q' });
    store.commit('conversation/appendBotMessage', { sender: 'bot', content: 'a' });
    store.commit('conversation/setRelatedDocuments', [
      { id: 'sealed_concept', title: 'sealed concept', source: 'okf-concept', repoId: 'repo-1' }
    ]);
    fetchOkfConcept.mockRejectedValueOnce(Object.assign(new Error('gone'), { code: 'OKF_CONCEPT_UNAVAILABLE' }));
    await store.dispatch('conversation/resolveOkfSourceTitles');
    expect(fetchOkfConcept).toHaveBeenCalledTimes(1);
    // A fresh row for the SAME (repo, concept) — as a later message would
    // add — is served by the cache's pinned null, not a second fetch.
    store.commit('conversation/setRelatedDocuments', [
      { id: 'sealed_concept', title: 'sealed concept', source: 'okf-concept', repoId: 'repo-1' }
    ]);
    await store.dispatch('conversation/resolveOkfSourceTitles');
    expect(fetchOkfConcept).toHaveBeenCalledTimes(1);
    expect(store.getters['conversation/openConversation'].relatedDocuments[0].titleResolved).toBe(false);
  });

  it('resolveOkfSourceTitles skips legacy rows and rows without repo identity', async () => {
    const store = freshStore();
    store.commit('conversation/appendUserMessage', { sender: 'user', content: 'q' });
    store.commit('conversation/appendBotMessage', { sender: 'bot', content: 'a' });
    store.commit('conversation/setRelatedDocuments', [
      { id: 'doc-9', title: 'Report.pdf', url: '/api/files/doc-9/download' },
      { id: 'no_repo', title: 'no repo', source: 'okf-concept', repoId: null }
    ]);
    await store.dispatch('conversation/resolveOkfSourceTitles');
    expect(fetchOkfConcept).not.toHaveBeenCalled();
  });

  // #1817 — saved-conversation OKF restore: one dispatch repairs the loaded
  // conversation's okf rows (graft + live legacy resolution + title/origins),
  // every failure degrading to the honest unavailable card. Concept ids here
  // are unique per test — the title cache is module-level and shared.
  describe('#1817 repairRestoredOkfIdentity', () => {
    beforeEach(() => {
      // The module-level mocks accumulate calls across tests; each test
      // asserts call COUNTS, so start every test from zero. (The title cache
      // stays shared — every concept id in this describe is unique per test.)
      conceptService.resolveRepo.mockClear();
      fetchOkfConcept.mockClear();
    });

    function legacyEntryStore(conceptId) {
      const store = freshStore();
      store.commit('conversation/appendUserMessage', { sender: 'user', content: 'q' });
      store.commit('conversation/appendBotMessage', { sender: 'bot', content: 'a' });
      const row = { id: conceptId, title: conceptId, source: 'okf-concept', repoId: null, conceptId, url: '' };
      store.commit('conversation/setMessageProperty', [1, 'sources', [{ ...row }]]);
      store.commit('conversation/setRelatedDocuments', [{ ...row }]);
      return store;
    }

    it('restores a pre-CAP-1 row live: resolves the repo, patches every surface, stashes origins', async () => {
      const store = legacyEntryStore('legacy_c1');
      conceptService.resolveRepo.mockResolvedValueOnce({ repo_id: 'repo-9', bundle_version: 4 });
      fetchOkfConcept.mockResolvedValueOnce({
        frontmatter: { title: 'Legacy Concept' },
        sources: [{ file_id: 'file-7', file_name: 'origin.pdf' }]
      });

      await store.dispatch('conversation/repairRestoredOkfIdentity');

      expect(conceptService.resolveRepo).toHaveBeenCalledWith('legacy_c1');
      const open = store.getters['conversation/openConversation'];
      for (const row of [...open.messages[1].sources, ...open.relatedDocuments]) {
        expect(row.repoId).toBe('repo-9');
        expect(row.bundleVersion).toBe(4);
        expect(row.title).toBe('Legacy Concept');
        expect(row.titleResolved).toBe(true);
        expect(row.okfSources).toEqual([{ file_id: 'file-7', file_name: 'origin.pdf' }]);
      }
    });

    it('an unavailable concept degrades the row honestly (no repo resolved, terminal marker)', async () => {
      const store = legacyEntryStore('dead_c2');
      // No visible repo holds the concept: the resolver answers the
      // anti-enumeration null — definitive within this posture, so the row
      // settles with the terminal marker and the concept fetch never runs.
      conceptService.resolveRepo.mockResolvedValueOnce(null);

      await store.dispatch('conversation/repairRestoredOkfIdentity');
      const row = store.getters['conversation/openConversation'].messages[1].sources[0];
      expect(row.repoId).toBeNull();
      expect(row.titleResolved).toBe(false);
      expect(row.okfSources).toEqual([]);
      expect(fetchOkfConcept).not.toHaveBeenCalled();
    });

    it('is idempotent: a re-dispatch serves rows from the cache, not the network', async () => {
      const store = legacyEntryStore('idem_c4');
      conceptService.resolveRepo.mockResolvedValue({ repo_id: 'repo-4', bundle_version: null });
      fetchOkfConcept.mockResolvedValue({ frontmatter: { title: 'Idem Concept' }, sources: [] });

      await store.dispatch('conversation/repairRestoredOkfIdentity');
      await store.dispatch('conversation/repairRestoredOkfIdentity');

      expect(fetchOkfConcept).toHaveBeenCalledTimes(1);
      const row = store.getters['conversation/openConversation'].messages[1].sources[0];
      expect(row.repoId).toBe('repo-4');
      expect(row.title).toBe('Idem Concept');
      expect(row.titleResolved).toBe(true);
    });

    it('a transient resolver failure leaves the row retryable (no terminal marker)', async () => {
      const store = legacyEntryStore('retry_c5');
      conceptService.resolveRepo.mockRejectedValueOnce(new Error('500 — transient'));

      await store.dispatch('conversation/repairRestoredOkfIdentity');
      const row = store.getters['conversation/openConversation'].messages[1].sources[0];
      // The repo never resolved, so the concept fetch never ran and the row
      // carries no terminal marker — the next dispatch retries the whole arm.
      expect(row.repoId).toBeNull();
      expect(row.titleResolved).toBeUndefined();
      expect(fetchOkfConcept).not.toHaveBeenCalled();
    });

    it('a conversation with no okf rows makes no service calls', async () => {
      const store = freshStore();
      store.commit('conversation/appendUserMessage', { sender: 'user', content: 'q' });
      store.commit('conversation/appendBotMessage', { sender: 'bot', content: 'a' });
      store.commit('conversation/setRelatedDocuments', [
        { id: 'doc-9', title: 'Report.pdf', url: '/api/files/doc-9/download' }
      ]);

      await store.dispatch('conversation/repairRestoredOkfIdentity');

      expect(conceptService.resolveRepo).not.toHaveBeenCalled();
      expect(fetchOkfConcept).not.toHaveBeenCalled();
    });

    it('grafts raw identity onto a loaded row that lost its okf tag (the save-side translated shape)', async () => {
      const store = freshStore();
      store.commit('conversation/appendUserMessage', { sender: 'user', content: 'q' });
      store.commit('conversation/appendBotMessage', { sender: 'bot', content: 'a' });
      store.commit('conversation/setMessageProperty', [
        1,
        'sources',
        [{ id: 'g_c3', title: 'g c3', url: '/api/files/g_c3/download' }]
      ]);
      store.commit('conversation/setMessageProperty', [
        1,
        'metadata',
        {
          source_documents: [
            {
              document_id: 'g_c3',
              document_name: 'g c3',
              url: '',
              source: 'okf-concept',
              repo_id: 'repo-3',
              bundle_version: 1
            }
          ]
        }
      ]);
      fetchOkfConcept.mockResolvedValue({ frontmatter: { title: 'Grafted Concept' }, sources: [] });

      await store.dispatch('conversation/repairRestoredOkfIdentity');
      const row = store.getters['conversation/openConversation'].messages[1].sources[0];
      expect(row.source).toBe('okf-concept');
      expect(row.repoId).toBe('repo-3');
      expect(row.bundleVersion).toBe(1);
      // The dead doc-repo URL the translated row carried is cleared.
      expect(row.url).toBe('');
      expect(row.title).toBe('Grafted Concept');
    });
  });
});
