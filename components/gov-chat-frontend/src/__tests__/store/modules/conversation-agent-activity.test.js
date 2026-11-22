'use strict';

// The agent activity line's store state machine: the turn-scoped root
// state, the frame/collapse-latch mutations, the reset paths, the
// sendStream wiring (frames + verdict translationMode) and the
// nothing-persisted guarantee.
const mockSubmitQueryStream = jest.fn(() => ({ abort: jest.fn(), signal: {} }));

jest.mock('@/services/chatbotService', () => ({
  __esModule: true,
  default: { submitQueryStream: (...a) => mockSubmitQueryStream(...a) }
}));
jest.mock('@/services/documentFileService', () => ({
  __esModule: true,
  default: { getFileMetadata: jest.fn().mockRejectedValue(new Error('mocked')) }
}));
jest.mock('@/services/conceptService', () => ({
  __esModule: true,
  default: { resolveRepo: jest.fn().mockRejectedValue(new Error('mocked')) }
}));

const { createStore } = require('vuex');
const conversationModule = require('@/store/modules/conversation.js').default;
const { persistConversation, rehydrateConversation, STORAGE_KEY } = require('@/store/modules/conversation.js');

// The status mutations sendStream's metadata/error paths commit; a stub is
// enough — the activity machine never reads it.
const statusStub = {
  namespaced: true,
  state: () => ({ online: true, responseTime: null }),
  mutations: {
    setOnline: () => {},
    setOffline: () => {},
    setResponseTime: () => {}
  }
};

function createStoreWithConversation() {
  const store = createStore({
    modules: { conversation: { ...conversationModule, state: () => conversationModule.state() }, status: statusStub }
  });
  return store;
}

function seedStreamingTurn(store) {
  store.commit('conversation/appendUserMessage', { sender: 'user', content: 'q', isSaved: false });
  store.commit('conversation/appendBotMessage', {
    sender: 'bot',
    content: '',
    timestamp: '2026-11-22T00:00:00.000Z',
    isSaved: false,
    metadata: {},
    isStreaming: true,
    translationFailed: false
  });
}

// Dispatch sendStream and hand back the callbacks the service captured —
// the tests drive the stream through them exactly as the parser would.
async function startStream(store) {
  seedStreamingTurn(store);
  await store.dispatch('conversation/sendStream', { text: 'q' });
  expect(mockSubmitQueryStream).toHaveBeenCalledTimes(1);
  return mockSubmitQueryStream.mock.calls.at(-1)[1];
}

describe('conversation store — agent activity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
  });

  describe('the state machine', () => {
    it('starts fresh: no line, nothing collapsed', () => {
      const store = createStoreWithConversation();
      expect(store.state.conversation.agentActivity).toEqual({
        visible: false,
        operation: null,
        status: null,
        collapsed: false
      });
    });

    it.each([
      ['started', 'running'],
      ['completed', 'completed'],
      ['failed', 'failed'],
      // An unmapped wire status degrades to running, never to an unknown state.
      ['some_future_status', 'running']
    ])('maps the wire status %s to the rendered state %s', (wire, rendered) => {
      const store = createStoreWithConversation();
      store.commit('conversation/agentActivityFrame', {
        type: 'agent_activity',
        status: wire,
        operation: 'read_source'
      });
      expect(store.state.conversation.agentActivity).toEqual({
        visible: true,
        operation: 'read_source',
        status: rendered,
        collapsed: false
      });
    });

    it('keeps a null operation as null (the per-op handle is omitted upstream)', () => {
      const store = createStoreWithConversation();
      store.commit('conversation/agentActivityFrame', { type: 'agent_activity', status: 'started', operation: null });
      expect(store.state.conversation.agentActivity.operation).toBeNull();
      expect(store.state.conversation.agentActivity.visible).toBe(true);
    });

    it('a non-string operation degrades to null, not to a rendered value', () => {
      const store = createStoreWithConversation();
      store.commit('conversation/agentActivityFrame', { type: 'agent_activity', status: 'started', operation: 42 });
      expect(store.state.conversation.agentActivity.operation).toBeNull();
    });
  });

  describe('the collapse latch', () => {
    it('the first chunk latches the line shut; later frames are accepted but never rendered', () => {
      const store = createStoreWithConversation();
      store.commit('conversation/agentActivityFrame', {
        type: 'agent_activity',
        status: 'started',
        operation: 'search_knowledge'
      });
      store.commit('conversation/collapseAgentActivity');
      expect(store.state.conversation.agentActivity).toEqual({
        visible: false,
        operation: 'search_knowledge',
        status: 'running',
        collapsed: true
      });
      // Post-chunk frames: parsed upstream, dropped here — the line never re-opens.
      store.commit('conversation/agentActivityFrame', {
        type: 'agent_activity',
        status: 'completed',
        operation: 'search_knowledge'
      });
      expect(store.state.conversation.agentActivity.visible).toBe(false);
      expect(store.state.conversation.agentActivity.collapsed).toBe(true);
    });
  });

  describe('sendStream wiring', () => {
    it('a fresh send resets the previous turn’s activity state before the stream starts', async () => {
      const store = createStoreWithConversation();
      store.commit('conversation/agentActivityFrame', {
        type: 'agent_activity',
        status: 'started',
        operation: 'read_source'
      });
      await startStream(store);
      expect(store.state.conversation.agentActivity).toEqual({
        visible: false,
        operation: null,
        status: null,
        collapsed: false
      });
    });

    it('an activity frame before the first chunk opens the line; the first chunk collapses it', async () => {
      const store = createStoreWithConversation();
      const callbacks = await startStream(store);
      callbacks.onAgentActivity({
        type: 'agent_activity',
        version: 1,
        status: 'started',
        operation: 'search_knowledge'
      });
      expect(store.state.conversation.agentActivity.visible).toBe(true);
      expect(store.state.conversation.agentActivity.status).toBe('running');
      callbacks.onChunk('the answer');
      expect(store.state.conversation.agentActivity.visible).toBe(false);
      expect(store.state.conversation.agentActivity.collapsed).toBe(true);
      // A post-chunk frame rides the same callbacks — accepted, unrendered.
      callbacks.onAgentActivity({
        type: 'agent_activity',
        version: 1,
        status: 'completed',
        operation: 'search_knowledge'
      });
      expect(store.state.conversation.agentActivity.visible).toBe(false);
    });

    it('the verdict frame stores translation_mode on the bot message, ahead of the metadata frame', async () => {
      const store = createStoreWithConversation();
      const callbacks = await startStream(store);
      callbacks.onAgentVerdict({
        type: 'agent_verdict',
        version: 1,
        grounding_status: 'grounded',
        translation_mode: 'streaming-units'
      });
      const last = store.state.conversation.conversations[store.state.conversation.openId].messages.at(-1);
      expect(last.translationMode).toBe('streaming-units');
      // A later metadata frame REPLACES msg.metadata — the property written
      // here must survive that replacement (it lives on the message, not
      // inside metadata).
      callbacks.onMetadata({ confidence_score: 0.9, source_documents: [] });
      expect(last.translationMode).toBe('streaming-units');
      expect(last.metadata.grounding_status).toBeUndefined();
    });

    it('a verdict frame without a translation_mode writes nothing', async () => {
      const store = createStoreWithConversation();
      const callbacks = await startStream(store);
      callbacks.onAgentVerdict({ type: 'agent_verdict', version: 1, grounding_status: 'grounded' });
      const last = store.state.conversation.conversations[store.state.conversation.openId].messages.at(-1);
      expect(last.translationMode).toBeUndefined();
    });

    it('a translation frame marks the post-stream delivery on the bot message', async () => {
      const store = createStoreWithConversation();
      const callbacks = await startStream(store);
      callbacks.onTranslation('Réponse traduite');
      const last = store.state.conversation.conversations[store.state.conversation.openId].messages.at(-1);
      // The caption's second carrier: the whole-answer delivery is the one
      // mode the client can read off the wire itself (a streamed-unit
      // delivery never sends a translation frame — the verdict frame names it).
      expect(last.translationMode).toBe('post-stream');
      expect(last.content).toBe('Réponse traduite');
    });
  });

  describe('the reset paths', () => {
    it.each([
      ['finishStream', (store, cb) => cb.onDone({ queryId: 'q1' })],
      ['failStream', (store, cb) => cb.onError(new Error('boom'))],
      ['abortStream', (store, _cb) => store.dispatch('conversation/abortStream')]
    ])('%s resets the activity state', async (_name, act) => {
      const store = createStoreWithConversation();
      const callbacks = await startStream(store);
      callbacks.onAgentActivity({ type: 'agent_activity', status: 'failed', operation: 'read_source' });
      expect(store.state.conversation.agentActivity.visible).toBe(true);
      act(store, callbacks);
      expect(store.state.conversation.agentActivity).toEqual({
        visible: false,
        operation: null,
        status: null,
        collapsed: false
      });
    });

    it('markInterrupted resets the activity state (the abort path’s mutation)', () => {
      const store = createStoreWithConversation();
      seedStreamingTurn(store);
      store.commit('conversation/agentActivityFrame', {
        type: 'agent_activity',
        status: 'started',
        operation: 'read_source'
      });
      store.commit('conversation/markInterrupted');
      expect(store.state.conversation.agentActivity.visible).toBe(false);
      expect(store.state.conversation.agentActivity.operation).toBeNull();
    });
  });

  describe('the nothing-persisted guarantee', () => {
    it('persistConversation writes no agentActivity key into sessionStorage', () => {
      const store = createStoreWithConversation();
      seedStreamingTurn(store);
      store.commit('conversation/agentActivityFrame', {
        type: 'agent_activity',
        status: 'started',
        operation: 'read_source'
      });
      persistConversation(store.state.conversation);
      const payload = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
      expect(payload).not.toHaveProperty('agentActivity');
      // The rest of the module state still persists.
      expect(payload.conversations).toBeDefined();
      expect(payload.openId).toBe(store.state.conversation.openId);
    });

    it('a payload that somehow carried an agentActivity key rehydrates without it', () => {
      const store = createStoreWithConversation();
      seedStreamingTurn(store);
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          openId: store.state.conversation.openId,
          agentActivity: { visible: true, operation: 'read_source', status: 'failed', collapsed: false },
          conversations: {
            [store.state.conversation.openId]: {
              messages: [{ sender: 'bot', content: 'a', timestamp: '2026-11-22T00:00:00.000Z' }],
              relatedDocuments: [],
              selectedContextItems: [],
              lastSavedState: { messages: [], contextItems: [] },
              conversationId: null,
              title: '',
              isStreaming: false
            }
          }
        })
      );
      rehydrateConversation(store.state.conversation);
      // The restored module state carries the FRESH activity shape — the
      // line never replays from storage.
      expect(store.state.conversation.agentActivity).toEqual({
        visible: false,
        operation: null,
        status: null,
        collapsed: false
      });
    });
  });
});
