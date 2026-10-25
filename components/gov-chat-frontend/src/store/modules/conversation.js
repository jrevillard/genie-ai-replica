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
  setSavedStateTo(st, saved) {
    st.conversations[st.openId].lastSavedState = {
      messages: saved?.messages || [],
      contextItems: saved?.contextItems || []
    };
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
    }
  },
  addContextItem(st, item) {
    st.conversations[st.openId].selectedContextItems.push(item);
  },
  removeContextItem(st, index) {
    st.conversations[st.openId].selectedContextItems.splice(index, 1);
  },
  setRelatedDocuments(st, docs) {
    st.conversations[st.openId].relatedDocuments = docs || [];
  },
  unshiftRelatedDocuments(st, docs) {
    st.conversations[st.openId].relatedDocuments.unshift(...(docs || []));
  },
  setMessages(st, messages) {
    st.conversations[st.openId].messages = messages || [];
  },
  spliceMessages(st, [index, count]) {
    st.conversations[st.openId].messages.splice(index, count);
  },
  setContextItems(st, items) {
    st.conversations[st.openId].selectedContextItems = items || [];
  },
  setStreaming(st, { isStreaming, streamingQueryId }) {
    const entry = st.conversations[st.openId];
    entry.isStreaming = isStreaming;
    entry.streamingQueryId = streamingQueryId;
  }
};

import chatbotService from '../../services/chatbotService';

// AbortControllers live here, outside reactive state: they are not
// serializable and must never enter `conversations` or storage.
const controllers = new Map();

function translateSources(sourceDocuments = []) {
  return (sourceDocuments || []).map((doc) => ({
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
  sendStream({ commit, state, rootState }, queryData) {
    const id = rootState.conversation.openId;
    commit('setStreaming', { isStreaming: true, streamingQueryId: null });
    const controller = chatbotService.submitQueryStream(queryData, {
      onChunk: (content) => commit('appendChunk', content),
      onMetadata: (metadata) => {
        commit('status/setOnline', null, { root: true });
        if (metadata.responseTime) {
          commit('status/setResponseTime', metadata.responseTime, { root: true });
        }
        commit('setLastBotProperty', ['confidenceScore', metadata.confidence_score ?? null]);
        commit('setLastBotProperty', ['isGrounded', metadata.is_grounded]);
        const sources = translateSources(metadata.source_documents);
        commit('setLastBotProperty', ['sources', sources]);
        commit('setLastBotProperty', ['sourcesOpen', Boolean(sources.length)]);
        // The sidebar keeps its accumulated view; a source already cited
        // by an earlier turn is not added twice.
        const knownIds = new Set(state.conversations[state.openId].relatedDocuments.map((d) => d.id));
        commit(
          'unshiftRelatedDocuments',
          sources.filter((d) => !knownIds.has(d.id))
        );
        // The repository TYPE · size fields degrade to the extension type
        // when the metadata fetch fails — same as the component did.
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
        commit('status/setOffline', error.message || 'stream unavailable', { root: true });
        commit('failStream', error.message || 'stream unavailable');
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

export default {
  namespaced: true,
  state,
  getters,
  mutations,
  actions
};

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
