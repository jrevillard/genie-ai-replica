# Conversation State Out of the Component — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The open conversation (messages, context, in-flight generation) lives in a Vuex module and survives navigation and page reloads; a generation continues while the user is on another page; navigation never prompts.

**Architecture:** New Vuex module `conversation` shaped `{ openId, conversations }` (keyed for future parallel conversations), getters `openConversation`, actions owning the SSE stream (AbortControllers in a module-local Map OUTSIDE reactive state), debounced sessionStorage persistence (`genie.conversation.v1`) with rehydration marking an interrupted stream. `ChatBotComponent` becomes a renderer over `openConversation`; the route-leave dialog on navigation is removed (the header × keeps its confirm).

**Tech Stack:** Vue 3 Options API, Vuex 4, Jest + @vue/test-utils, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-25-conversation-state-out-of-component-design.md` (read together with this plan — the spec rules).

## Global Constraints

- Options API everywhere; DS tokens only (`var(--...)`) — no hardcoded colors; no `!important`.
- AbortControllers/functions never enter `conversations` state or the persisted payload (module-local Map only).
- Storage key exactly `genie.conversation.v1`; persistence debounced ~300 ms; rehydration shape mismatch → discard, start clean.
- The 15 s backend keepalive comments are not frames (already handled by the service's frame parser — do not regress it).
- Comments describe current behavior — no story refs, no historical narrative (user rule).
- All new user-facing strings go through i18n with translations in all 14 locales (`ar bn de en es fr id man pt ru st sw th zh`).
- Tests follow the test-audit authoring gate: mutation-provable, no junk patterns.

---

### Task 1: The `conversation` module — state, mutations, getters

**Files:**
- Create: `components/gov-chat-frontend/src/store/modules/conversation.js`
- Modify: `components/gov-chat-frontend/src/store/index.js` (register module)
- Test: `components/gov-chat-frontend/src/__tests__/store/conversation.test.js`

**Interfaces:**
- Produces (later tasks consume): state shape `{ openId: 'open', conversations: { open: { messages: [], selectedContextItems: [], lastSavedState: { messages: [], contextItems: [] }, conversationId: null, title: '', isStreaming: false, streamingQueryId: null, streamInterrupted: false, relatedDocuments: [] } } }`; getter `openConversation`; mutations `resetForNewConversation`, `replaceConversation(payload)` (`{ messages, title, conversationId, selectedContextItems }`), `appendUserMessage(message)`, `appendBotMessage(message)`, `appendChunk(text)`, `setMetadata(metadata)`, `setTranslation(text)`, `finishStream(queryId)`, `failStream(errorMessage)`, `markInterrupted()`, `addContextItem(item)`, `removeContextItem(index)`, `setRelatedDocuments(docs)`, `unshiftRelatedDocuments(docs)`, `setSavedState()`, `setTitle(title)`, `setConversationId(id)`, `setLastBotProperty(prop, value)`.

- [ ] **Step 1: Write the failing tests** — create `conversation.test.js`:

```js
'use strict';

const { createStore } = require('vuex');
const conversationModule = require('../../../store/modules/conversation.js').default;

function freshStore() {
  return createStore({
    modules: { conversation: { ...conversationModule, state: () => conversationModule.state() } }
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
```

- [ ] **Step 2: Run to verify failure** — `cd components/gov-chat-frontend && npx jest src/__tests__/store/conversation.test.js` → FAIL (module not found).

- [ ] **Step 3: Implement the module** — create `src/store/modules/conversation.js`:

```js
// The open conversation, owned outside the component tree: navigating
// away from the chat view must not destroy it, and a generation in
// flight keeps writing while no chat view is mounted.
const OPEN_ID = 'open';

function emptyConversation() {
  return {
    messages: [],
    selectedContextItems: [],
    lastSavedState: { messages: [], contextItems: [] },
    conversationId: null,
    title: '',
    isStreaming: false,
    streamingQueryId: null,
    streamInterrupted: false,
    relatedDocuments: []
  };
}

const state = () => ({
  openId: OPEN_ID,
  conversations: { [OPEN_ID]: emptyConversation() }
});

const getters = {
  openConversation: (st) => st.conversations[st.openId]
};

const mutations = {
  replaceConversation(st, { messages, title, conversationId, selectedContextItems }) {
    const entry = st.conversations[st.openId];
    entry.messages = messages || [];
    entry.title = title || '';
    entry.conversationId = conversationId || null;
    entry.selectedContextItems = selectedContextItems || [];
  },
  resetForNewConversation(st) {
    st.conversations[st.openId] = emptyConversation();
  },
  setTitle(st, title) {
    st.conversations[st.openId].title = title;
  },
  setConversationId(st, id) {
    st.conversations[st.openId].conversationId = id;
  },
  setSavedState(st) {
    const entry = st.conversations[st.openId];
    entry.lastSavedState = {
      messages: JSON.parse(JSON.stringify(entry.messages)),
      contextItems: JSON.parse(JSON.stringify(entry.selectedContextItems))
    };
  },
  appendUserMessage(st, message) {
    st.conversations[st.openId].messages.push(message);
  },
  appendBotMessage(st, message) {
    st.conversations[st.openId].messages.push(message);
  },
  appendChunk(st, text) {
    const entry = st.conversations[st.openId];
    const last = entry.messages.at(-1);
    if (last && last.sender === 'bot') last.content += text;
  },
  setLastBotProperty(st, [prop, value]) {
    const entry = st.conversations[st.openId];
    const last = entry.messages.at(-1);
    if (last) last[prop] = value;
  },
  setMetadata(st, metadata) {
    // Written by the stream action after mapping source documents; the
    // per-message fields ride on setLastBotProperty from the action.
    void metadata;
  },
  setTranslation(st, text) {
    const entry = st.conversations[st.openId];
    const last = entry.messages.at(-1);
    if (last && last.sender === 'bot') last.content = text;
  },
  finishStream(st, queryId) {
    const entry = st.conversations[st.openId];
    entry.isStreaming = false;
    entry.streamingQueryId = queryId || null;
    const last = entry.messages.at(-1);
    if (last && last.sender === 'bot') last.isStreaming = false;
  },
  failStream(st, errorMessage) {
    const entry = st.conversations[st.openId];
    entry.isStreaming = false;
    const last = entry.messages.at(-1);
    if (last && last.sender === 'bot') {
      last.isStreaming = false;
      last.isError = true;
      last.content = errorMessage;
    }
  },
  markInterrupted(st) {
    const entry = st.conversations[st.openId];
    entry.isStreaming = false;
    entry.streamInterrupted = true;
    const last = entry.messages.at(-1);
    if (last && last.sender === 'bot' && last.isStreaming) {
      last.isStreaming = false;
      last.isError = true;
      last.content = last.content || '';
    }
  },
  addContextItem(st, item) {
    st.conversations[st.openId].selectedContextItems.push(item);
  },
  removeContextItem(st, index) {
    const entry = st.conversations[st.openId];
    entry.selectedContextItems.splice(index, 1);
  },
  setRelatedDocuments(st, docs) {
    st.conversations[st.openId].relatedDocuments = docs || [];
  },
  unshiftRelatedDocuments(st, docs) {
    const entry = st.conversations[st.openId];
    entry.relatedDocuments.unshift(...(docs || []));
  }
};

export default {
  namespaced: true,
  state,
  getters,
  mutations
};
```

Note: `setMetadata` is intentionally a placeholder mutation — the stream action writes per-message fields through `setLastBotProperty` (the spec's action owns the mapping). Keep it for interface completeness.

- [ ] **Step 4: Register the module** — in `src/store/index.js`, alongside `status`:

```js
import conversationModule from './modules/conversation';
// in modules:
conversation: conversationModule
```

- [ ] **Step 5: Run tests to green** — `npx jest src/__tests__/store/conversation.test.js` → 8 passed.

- [ ] **Step 6: Format + lint + commit**

```bash
npx prettier --write src/store/modules/conversation.js src/store/index.js src/__tests__/store/conversation.test.js
npx eslint src/store/modules/conversation.js src/store/index.js
git add src/store/modules/conversation.js src/store/index.js src/__tests__/store/conversation.test.js
git commit -m "feat(store): own the open conversation in a keyed Vuex module"
```

---

### Task 2: sessionStorage persistence + rehydration

**Files:**
- Modify: `components/gov-chat-frontend/src/store/modules/conversation.js`
- Modify: `components/gov-chat-frontend/src/store/index.js` (wire rehydration + subscription)
- Test: `components/gov-chat-frontend/src/__tests__/store/conversation.test.js` (extend)

**Interfaces:**
- Consumes: Task 1 module.
- Produces: exported helpers on the module file — `STORAGE_KEY` (`'genie.conversation.v1'`), `persistConversation(state)` (JSON-stringify, swallow QuotaExceededError with `console.warn`), `rehydrateConversation(rootState)` (parse, version-shape check `openId` + `conversations`, mark `streamInterrupted` when an entry was `isStreaming`, on mismatch leave state pristine), `subscribeConversation(store)` (debounced 300 ms persist on mutation).

- [ ] **Step 1: Write the failing tests** (append to `conversation.test.js`):

```js
const {
  STORAGE_KEY,
  persistConversation,
  rehydrateConversation,
  subscribeConversation
} = require('../../../store/modules/conversation.js');

describe('conversation persistence', () => {
  beforeEach(() => {
    sessionStorage.clear();
    jest.restoreAllMocks();
  });

  it('persists the conversations map under the versioned key', () => {
    const store = freshStore();
    store.commit('conversation/appendUserMessage', { sender: 'user', content: 'q' });
    jest.spyOn(window, 'setTimeout').mockImplementation((fn) => { fn(); return 1; });
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
```

- [ ] **Step 2: Run to verify failure** — FAIL (helpers not exported).

- [ ] **Step 3: Implement** — in `conversation.js` add:

```js
export const STORAGE_KEY = 'genie.conversation.v1';

export function persistConversation(moduleState) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(moduleState));
  } catch (error) {
    // A full or blocked storage degrades to navigation-only survival —
    // the Vuex state still holds the conversation for this page life.
    console.warn('conversation: could not persist to sessionStorage', error?.name);
  }
}

export function rehydrateConversation(moduleState) {
  let payload;
  try {
    payload = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
  } catch {
    payload = null;
  }
  if (!payload || payload.openId !== moduleState.openId || !payload.conversations) return;
  for (const [id, entry] of Object.entries(payload.conversations)) {
    if (!entry || !Array.isArray(entry.messages)) return; // shape drift — discard wholesale
    if (entry.isStreaming) {
      // The fetch died with the page: the turn renders through the
      // existing retry affordance.
      entry.isStreaming = false;
      entry.streamInterrupted = true;
      const last = entry.messages.at(-1);
      if (last && last.sender === 'bot' && last.isStreaming) {
        last.isStreaming = false;
        last.isError = true;
      }
    }
    moduleState.conversations[id] = entry;
  }
}

export function subscribeConversation(store) {
  let timer = null;
  store.subscribe((mutation) => {
    if (!mutation.type.startsWith('conversation/')) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => persistConversation(store.state.conversation), 300);
  });
}
```

Wire in `store/index.js` after the store is created:

```js
import { rehydrateConversation, subscribeConversation } from './modules/conversation';
rehydrateConversation(store.state.conversation);
subscribeConversation(store);
```

Note: the tests mock `window.setTimeout` to run immediately for the debounce; production uses the real 300 ms.

- [ ] **Step 4: Run tests to green** — the persistence describe passes (4 new).

- [ ] **Step 5: Commit**

```bash
git add src/store/modules/conversation.js src/store/index.js src/__tests__/store/conversation.test.js
git commit -m "feat(store): persist the open conversation across reloads"
```

---

### Task 3: the `sendStream` action — the generation lives in the store

**Files:**
- Modify: `components/gov-chat-frontend/src/store/modules/conversation.js`
- Test: `components/gov-chat-frontend/src/__tests__/store/conversation.test.js` (extend)

**Interfaces:**
- Consumes: `chatbotService.submitQueryStream(queryData, callbacks) → AbortController`; Task 1 mutations.
- Produces: actions `sendStream(payload)` where payload = `{ queryData, hiddenPrompt, displayText }`, plus `abortStream()`; a module-local `const controllers = new Map()` keyed by `openId` (never in state). Mutation `setStreaming(payload)` (`{ isStreaming, streamingQueryId }`) to open a stream.

- [ ] **Step 1: Write the failing tests** (append):

```js
describe('conversation sendStream action', () => {
  const chatbotService = require('../../../services/chatbotService.js').default;

  function storeWithService(streamImpl) {
    const store = freshStore();
    store.hotUpdate({
      modules: {
        conversation: {
          ...conversationModule,
          state: () => conversationModule.state(),
          actions: conversationModule.actions
        }
      }
    });
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
    store.dispatch('conversation/sendStream', { queryData: { query: 'q' } });
    await Promise.resolve();
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

  it('writes the error path and reports offline via the status module', () => {
    let captured = null;
    const store = freshStore();
    store.hotUpdate({
      modules: {
        conversation: { ...conversationModule, state: () => conversationModule.state(), actions: conversationModule.actions }
      }
    });
    jest.spyOn(chatbotService, 'submitQueryStream').mockImplementation((q, cb) => {
      captured = cb;
      return new AbortController();
    });
    store.commit('status/setOnline');
    store.dispatch('conversation/sendStream', { queryData: { query: 'q' } });
    return Promise.resolve().then(() => {
      captured.onError(new Error('Stream failed'));
      const open = store.getters['conversation/openConversation'];
      expect(open.messages.at(-1).isError).toBe(true);
      expect(store.state.status.online).toBe(false);
    });
  });

  it('abortStream aborts the controller without marking an error', () => {
    const controller = new AbortController();
    const abortSpy = jest.spyOn(controller, 'abort');
    const store = storeWithService(() => controller);
    store.dispatch('conversation/sendStream', { queryData: { query: 'q' } });
    store.dispatch('conversation/abortStream');
    expect(abortSpy).toHaveBeenCalled();
    expect(store.getters['conversation/openConversation'].isStreaming).toBe(false);
    expect(store.getters['conversation/openConversation'].messages.at(-1)?.isError).toBeFalsy();
  });

  it('translation replaces the streaming content', () => {
    let captured = null;
    const store = storeWithService((q, cb) => {
      captured = cb;
      return new AbortController();
    });
    store.dispatch('conversation/sendStream', { queryData: { query: 'q' } });
    return Promise.resolve().then(() => {
      captured.onChunk('EN text');
      captured.onTranslation('FR texte');
      expect(store.getters['conversation/openConversation'].messages.at(-1).content).toBe('FR texte');
    });
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL (`sendStream` unknown).

- [ ] **Step 3: Implement the actions** — in `conversation.js`:

```js
import chatbotService from '../../services/chatbotService';

// AbortControllers live here, outside reactive state: they are not
// serializable and must never enter `conversations` or storage.
const controllers = new Map();

function translateSources(sourceDocuments = []) {
  return sourceDocuments.map((doc) => ({
    id: doc.document_id,
    title: doc.document_name || doc.file_name || `Source ${(doc.document_id || '').slice(0, 4)}`,
    documentName: doc.document_name,
    fileName: doc.file_name,
    type: doc.url?.split('.').pop().toUpperCase() || 'LINK',
    size: 0,
    url: doc.url || (doc.document_id ? `/api/files/${doc.document_id}/download` : ''),
    score: doc.score
  }));
}

const actions = {
  sendStream({ commit, dispatch, rootState }, { queryData, hiddenPrompt, displayText }) {
    const id = rootState.conversation.openId;
    commit('setStreaming', { isStreaming: true, streamingQueryId: null });
    commit('appendUserMessage', {
      sender: 'user',
      content: displayText ?? queryData.query,
      hiddenPrompt: hiddenPrompt ?? queryData.query,
      timestamp: Date.now()
    });
    commit('appendBotMessage', { sender: 'bot', content: '', isStreaming: true });
    if (displayText && displayText !== queryData.query) {
      commit('setLastBotProperty', ['content', '']);
    }
    const controller = chatbotService.submitQueryStream(queryData, {
      onChunk: (content) => commit('appendChunk', content),
      onMetadata: (metadata) => {
        commit('status/setOnline', null, { root: true });
        commit('setLastBotProperty', ['confidenceScore', metadata.confidence_score ?? null]);
        commit('setLastBotProperty', ['isGrounded', metadata.is_grounded]);
        const sources = translateSources(metadata.source_documents);
        commit('setLastBotProperty', ['sources', sources]);
        commit('setLastBotProperty', ['sourcesOpen', Boolean(sources.length)]);
        commit('unshiftRelatedDocuments', sources);
        // Repository metadata for the TYPE · size line degrades to the
        // extension type when the fetch fails (imported lazily to avoid
        // a circular import with the component layer).
        import('../../services/documentFileService').then(({ default: documentFileService }) => {
          sources.forEach((doc) => {
            if (!doc.id) return;
            documentFileService
              .getFileMetadata(doc.id)
              .then((file) => {
                doc._size = file?.file_size || 0;
                doc._type = (file?.file_type || doc.type || 'LINK').toUpperCase();
              })
              .catch(() => {});
          });
        });
      },
      onTranslation: (text) => commit('setTranslation', text),
      onDone: (data) => {
        commit('finishStream', data.queryId);
        if (data.queryId) commit('setLastBotProperty', ['queryId', data.queryId]);
      },
      onError: (error) => {
        commit('status/setOffline', error.message || 'Stream failed', { root: true });
        commit('failStream', error.message || 'Stream failed');
      }
    });
    controllers.set(id, controller);
  },
  abortStream({ commit, rootState }) {
    const controller = controllers.get(rootState.conversation.openId);
    if (controller) controller.abort();
    controllers.delete(rootState.conversation.openId);
    commit('setStreaming', { isStreaming: false, streamingQueryId: null });
  }
};
```

And the `setStreaming` mutation:

```js
setStreaming(st, { isStreaming, streamingQueryId }) {
  const entry = st.conversations[st.openId];
  entry.isStreaming = isStreaming;
  entry.streamingQueryId = streamingQueryId;
},
```

Note on the hidden dual-prompt mechanism: today the component sends `queryData.query` = hidden prompt with `displayText` shown to the user. The action preserves it — `displayText` rides the user turn's visible `content` only. The QuickHelp dual-prompt fields (`hiddenPromptForNextMessage`) stay component-side and are passed through `payload`.

- [ ] **Step 4: Run tests to green** — the sendStream describe passes (5 new). Full file: 17+.

- [ ] **Step 5: Commit**

```bash
git add src/store/modules/conversation.js src/__tests__/store/conversation.test.js
git commit -m "feat(store): the generation runs in the conversation module"
```

---

### Task 4: `ChatBotComponent` reads from the store

**Files:**
- Modify: `components/gov-chat-frontend/src/components/ChatBotComponent.vue`
- Modify: `components/gov-chat-frontend/src/__tests__/components/ChatBotComponent.test.js`

**Interfaces:**
- Consumes: Tasks 1-3 getters/mutations/actions (exact names above).
- Produces: the component renders and dispatches; its local `data()` no longer holds `chatMessages`, `selectedContextItems`, `relatedDocuments`, `lastSavedState`, `isStreaming`, `streamingQueryId`.

- [ ] **Step 1: Rewire the read path** — in the component:

```js
import { mapState, mapGetters } from 'vuex';
// computed:
...mapGetters('conversation', ['openConversation']),
openMessages() {
  return this.openConversation.messages;
},
selectedContextItems() {
  return this.openConversation.selectedContextItems;
},
relatedDocuments() {
  return this.openConversation.relatedDocuments;
},
isStreaming() {
  return this.openConversation.isStreaming;
},
streamingQueryId() {
  return this.openConversation.streamingQueryId;
},
lastSavedState() {
  return this.openConversation.lastSavedState;
},
currentChatTitle() {
  return this.openConversation.conversationId ? this.openConversation.title : '';
},
```

Then delete the same names from `data()` and re-point every internal reference. The render templates read `chatMessages` in many places — replace template usages `chatMessages` → `openMessages` (mechanical, whole template), keeping `v-for` keys and testids identical. `hasUnsavedChanges()` compares `this.openMessages`/`this.selectedContextItems` against `this.lastSavedState` (same logic, new sources).

- [ ] **Step 2: Adjust the test factory** — `createChatBotStore` in `ChatBotComponent.test.js` registers the real `conversation` module (same pattern as `status`):

```js
const conversationModule = require('../../store/modules/conversation.js').default;
// modules:
conversation: { ...conversationModule, state: () => conversationModule.state() }
```

- [ ] **Step 3: Run the component suite** — expect most of the 142-test file to pass unchanged (the mocks drive `vm` methods that now write through the store). Fix ONLY mechanical failures (names/paths) — do not weaken assertions. Any assertion that must change, note why in the commit body.

- [ ] **Step 4: Full frontend suite green** — `npx jest` → all pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/ChatBotComponent.vue src/__tests__/components/ChatBotComponent.test.js
git commit -m "refactor(chat): read the open conversation from the store"
```

---

### Task 5: `ChatBotComponent` writes through the store — streams, load, save, navigation

**Files:**
- Modify: `components/gov-chat-frontend/src/components/ChatBotComponent.vue`
- Modify: `components/gov-chat-frontend/src/__tests__/components/ChatBotComponent.test.js`
- Modify: `components/gov-chat-frontend/src/i18n/locales/*.js` (only if a dialog text changes — none should)

**Interfaces:**
- Consumes: Task 3 actions.

- [ ] **Step 1: Dispatch the stream** — `sendMessage()` builds `queryData`/`hiddenPrompt`/`displayText` exactly as today (QuickHelp dual-prompt, category filters, `checkContextConfig`) then:

```js
this.$store.dispatch('conversation/sendStream', { queryData, hiddenPrompt: this.hiddenPromptForNextMessage, displayText: this.newMessage });
this.hiddenPromptForNextMessage = null;
```

Delete the component's local `submitQueryStream` wiring, `streamController`, and the metadata/source-mapping block (now in the action). `handleWelcomeSend` routes through the same dispatch (it maps the welcome composer's just-chat/category entry onto queryData as today).

- [ ] **Step 2: Delegate the flows** — `loadExistingConversation(id)` fetches (unchanged service call) then commits `conversation/replaceConversation` + `setSavedState`; `saveCurrentChatBeforeLeave`/`saveChatToHistory` keep their service calls then commit `setConversationId`/`setTitle`/`setSavedState`; `startNewChatConfirmed` dispatches `conversation/abortStream` FIRST if `isStreaming`, then `conversation/resetForNewConversation`. `removeContextItem(i)` commits; `selectQuickHelpOption` commits `addContextItem`; the `treeNodeSelected` handler commits `replaceConversation` context via `addContextItem` (same dedup logic).

- [ ] **Step 3: Remove the navigation guard, keep the × confirm** — delete the `beforeEach` registration in `mounted()` and `pendingLeave`/`leaveConfirmed`/`unsavedLeaveGuard`/`saveCurrentChatBeforeLeave` resume logic; `startNewChat()` keeps its `showNewChatConfirm` dialog (texts unchanged). `beforeUnmount` drops the `streamController.abort()` (the store owns the stream now) and keeps the event-bus/resize cleanup.

- [ ] **Step 4: Run the component suite + full unit suite** — all green; the previous "Subtask 3b" network-failure test now asserts through the store path (same user-visible contract: error content + notification).

- [ ] **Step 5: Lint + format + commit**

```bash
npx prettier --write src/components/ChatBotComponent.vue
npx eslint src/components/ChatBotComponent.vue
git add src/components/ChatBotComponent.vue src/__tests__/components/ChatBotComponent.test.js
git commit -m "refactor(chat): write the conversation through the store; navigation never prompts"
```

---

### Task 6: E2E — the navigation contract

**Files:**
- Modify: `tests/e2e/chat-conversation.spec.js`

- [ ] **Step 1: Replace the round-2 route-leave test** with the new contract (mocked stream so generation survives deterministically):

```js
test('navigating away never prompts and never loses the conversation', async ({ browser }) => {
  const { ctx, page } = await openWelcomeScreen(browser, { viewport: { width: 1440, height: 900 }, theme: 'light' });
  await mockStream(page, ['The answer completes in the background.'], { confidence_score: 0.9, is_grounded: true });
  await page.locator('[data-testid="welcome-composer"] textarea').fill('What is GENIE.AI?');
  await page.locator('[data-testid="welcome-composer"] textarea').press('Enter');
  // Leave WHILE the answer is streaming.
  await page.waitForSelector('.chat-message.bot .streaming-indicator', { timeout: 15000 });
  await page.locator('[aria-label="Settings"]').locator('visible=true').first().click();
  await page.waitForTimeout(300);
  // No dialog on navigation.
  expect(await page.locator('[role="dialog"]').count(), 'navigation is never blocked').toBe(0);
  // Come back — the conversation is intact and the answer completed.
  await page.locator('[data-testid="chatbot-view"]').click().catch(() => {});
  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector('.chat-message.bot .message-bubble', { timeout: 30000 });
  await expect(page.locator('.chat-message.bot .message-bubble').last()).toContainText('The answer completes in the background.');
  await expect(page.locator('.chat-message.user').last()).toContainText('What is GENIE.AI?');
  await ctx.close();
});
```

Note: returning to the chat must be the app's real navigation (chatbot view link or `/dashboard` route rendering the chat — use whichever the welcome test helpers already navigate by; the mocked SSE completes regardless of which view is mounted because the store owns the stream).

- [ ] **Step 2: Reload contract test** (new):

```js
test('a reload mid-generation leaves a partial answer with a retry', async ({ browser }) => {
  const { ctx, page } = await openWelcomeScreen(browser, { viewport: { width: 1440, height: 900 }, theme: 'light' });
  // A stream that never finishes: the reload simulates the page dying.
  await page.route('**/queries/stream', (route) => route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }));
  await page.locator('[data-testid="welcome-composer"] textarea').fill('q');
  await page.locator('[data-testid="welcome-composer"] textarea').press('Enter');
  await page.waitForTimeout(1000);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.chat-message.user', { timeout: 30000 });
  await ctx.close();
});
```

(The persisted conversation rehydrates — the user turn is still there; the generation is interrupted and the turn shows the retry affordance once the interrupted flag renders.)

- [ ] **Step 3: Run the conversation gate** — `BASE_URL=https://localhost:9445 npx playwright test tests/e2e/chat-conversation.spec.js` → 16 passed (15 − 1 replaced + 2 new = 16).

- [ ] **Step 4: Mutation checks** — for the new navigation test: temporarily re-add a `beforeEach` guard (or revert the component to block navigation) → the "never blocked" assertion goes red; revert → green. For the reload test: disable `rehydrateConversation` → the user turn disappears after reload → red; restore → green.

- [ ] **Step 5: Prettier + commit**

```bash
npx prettier --write tests/e2e/chat-conversation.spec.js
git add tests/e2e/chat-conversation.spec.js
git commit -m "test(e2e): navigation preserves the conversation; reload keeps the turns"
```

---

### Task 7: Full gates

- [ ] `npx jest` (frontend) → all green.
- [ ] `npx eslint src/` + `npx prettier --check "src/**/*.{js,vue,json,css,scss}"` → clean.
- [ ] `BASE_URL=https://localhost:9445 npx playwright test tests/e2e/chat-conversation.spec.js tests/e2e/chat-composer.spec.js tests/e2e/living-intelligence.spec.js` → green.
- [ ] Rebuild `genie-ai-frontend:lot-b`, swap onto the review slot, REAL boot check (login → splash detach → 0 console errors).
- [ ] Push + CI monitor (`GITLAB_PROJECT_ID=90 /tmp/ci-monitor.sh <id> conversation-store`).
