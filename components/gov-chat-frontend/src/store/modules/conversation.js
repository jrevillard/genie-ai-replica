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
    relatedDocuments: []
  };
}

// Shared by the abort path and rehydration: close the streaming turn
// and surface the retry affordance through isError. The question that
// triggered the dead answer is marked too — the failed exchange leaves
// the transcript as a unit (the retry splices both), so no half of it
// can leak into a later request's context.
// The question that triggered a dead answer is marked too — the failed
// exchange leaves the transcript as a unit (the retry splices both), so
// no half of it can leak into a later request's context.
function markTriggeringQuestion(entry) {
  for (let i = entry.messages.length - 2; i >= 0; i--) {
    if (entry.messages[i].sender === 'user') {
      entry.messages[i].isError = true;
      break;
    }
  }
}

// Closes the streaming turn and surfaces the retry affordance through
// isError.
function markEntryInterrupted(entry) {
  entry.isStreaming = false;
  const last = entry.messages.at(-1);
  if (last && last.sender === 'bot' && last.isStreaming) {
    last.isStreaming = false;
    last.isError = true;
    markTriggeringQuestion(entry);
  }
}

const state = () => ({
  openId: OPEN_ID,
  conversations: { [OPEN_ID]: emptyConversation() }
});

const getters = {
  openConversation: (st) => st.conversations[st.openId]
};

const mutations = {
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
      // Message dirtiness is carried by the per-message isSaved flags;
      // only the context list needs a snapshot, and cloning the whole
      // transcript here would double every persistence write.
      messages: [],
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
  setLastBotMetadata(st, { metadata, sources }) {
    const entry = st.conversations[st.openId];
    const last = entry.messages.at(-1);
    if (!last) return;
    last.metadata = metadata;
    last.confidenceScore = metadata.confidence_score ?? null;
    last.isGrounded = metadata.is_grounded;
    last.sources = sources;
    last.sourcesOpen = Boolean(sources.length);
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
  failStream(st, { message, errorKey }) {
    const entry = st.conversations[st.openId];
    entry.isStreaming = false;
    const last = entry.messages.at(-1);
    if (last && last.sender === 'bot') {
      last.isStreaming = false;
      last.isError = true;
      // A partial answer the user was reading is kept; the error text
      // only fills an empty turn.
      if (!last.content) last.content = message;
      // The i18n key the failure maps to, so the chat view can render
      // the notification in its own translation context; null when the
      // reason is prose the server wrote (shown verbatim).
      last.errorKey = errorKey || null;
      markTriggeringQuestion(entry);
    }
  },
  markInterrupted(st) {
    markEntryInterrupted(st.conversations[st.openId]);
  },
  addContextItem(st, item) {
    st.conversations[st.openId].selectedContextItems.push(item);
  },
  // At most one quickHelp chip: the new item replaces the previous one.
  replaceQuickHelpItem(st, item) {
    const entry = st.conversations[st.openId];
    entry.selectedContextItems = [...entry.selectedContextItems.filter((i) => i.source !== 'quickHelp'), item];
  },
  removeContextItem(st, index) {
    st.conversations[st.openId].selectedContextItems.splice(index, 1);
  },
  setRelatedDocuments(st, docs) {
    st.conversations[st.openId].relatedDocuments = docs || [];
  },
  patchSource(st, [docId, fields]) {
    // The repository metadata arrives after the sources were committed;
    // writing it through a mutation keeps the render triggers alive (the
    // raw closure objects bypass the reactive proxies).
    const entry = st.conversations[st.openId];
    const patch = (doc) => {
      if (doc.id === docId) Object.assign(doc, fields);
    };
    entry.relatedDocuments.forEach(patch);
    const last = entry.messages.at(-1);
    if (last && Array.isArray(last.sources)) last.sources.forEach(patch);
  },
  setMessageProperty(st, [index, prop, value]) {
    const entry = st.conversations[st.openId];
    if (entry.messages[index]) entry.messages[index][prop] = value;
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
import documentFileService from '../../services/documentFileService';
import i18n from '../../i18n';

function t(key, fallback) {
  return i18n.global.te(key) ? i18n.global.t(key) : fallback;
}

// The in-flight stream's AbortController lives here, outside reactive
// state: it is not serializable and must never enter `conversations` or
// storage. One open conversation, one slot.
let activeController = null;

// A turn a save can persist: a real question, or an answer the server
// acknowledged. Failed exchanges are never storable, metadata, context
// or prompt — every consumer of this predicate keeps only its own
// qualifier (isSaved, content).
export function isStorableTurn(message) {
  if (!message || message.isError) return false;
  return message.sender === 'user' || (message.sender === 'bot' && message.queryId);
}

// The sidebar-card shape, from either naming convention (the stream's
// source_documents carry snake_case; the history payload's files carry
// camelCase plus the knowledge-base fields).
export function translateSources(sourceDocuments = []) {
  return (sourceDocuments || []).map((doc) => {
    const documentId = doc.document_id || doc.id;
    const documentName = doc.document_name || doc.documentName;
    const fileName = doc.file_name || doc.fileName;
    return {
      id: documentId,
      title: documentName || fileName || `Source ${(documentId || '').slice(0, 4)}`,
      documentName,
      fileName,
      type: doc.url?.split('.').pop().toUpperCase() || 'LINK',
      size: 0,
      url: doc.url || (documentId ? `/api/files/${documentId}/download` : ''),
      score: doc.score,
      categoryLabel: doc.categoryLabel,
      serviceLabels: doc.labels || doc.serviceLabels || []
    };
  });
}

const actions = {
  sendStream({ commit, state }, queryData) {
    commit('setStreaming', { isStreaming: true, streamingQueryId: null });
    const controller = chatbotService.submitQueryStream(queryData, {
      onChunk: (content) => commit('appendChunk', content),
      onMetadata: (metadata) => {
        commit('status/setOnline', null, { root: true });
        if (metadata.responseTime) {
          commit('status/setResponseTime', metadata.responseTime, { root: true });
        }
        // One array instance for the answer card and the sidebar: the
        // repository metadata patch later lands in both through the same
        // objects.
        const sources = translateSources(metadata.source_documents);
        commit('setLastBotMetadata', { metadata, sources });
        // The sidebar keeps its accumulated view; a source already cited
        // by an earlier turn is not added twice.
        const knownIds = new Set(state.conversations[state.openId].relatedDocuments.map((d) => d.id));
        commit(
          'unshiftRelatedDocuments',
          sources.filter((d) => !knownIds.has(d.id))
        );
        // The repository TYPE · size fields degrade to the extension type
        // when the metadata fetch fails — same as the component did.
        sources.forEach((doc) => {
          if (!doc.id) return;
          documentFileService
            .getFileMetadata(doc.id)
            .then((file) => {
              commit('patchSource', [
                doc.id,
                { _size: file?.file_size || 0, _type: (file?.file_type || doc.type || 'LINK').toUpperCase() }
              ]);
            })
            .catch(() => {});
        });
      },
      onTranslation: (text) => commit('setTranslation', text),
      onDone: (data) => {
        commit('finishStream', data.queryId);
        if (data.queryId) commit('setLastBotProperty', ['queryId', data.queryId]);
        // The answer is complete either way; only its language is affected,
        // and only the message carries that — the status stays healthy.
        commit('setLastBotProperty', ['translationFailed', Boolean(data.translationFailed)]);
      },
      onError: (error) => {
        // A 4xx is a request the backend refused: the deployment is up and
        // answered, so it stays online and the reason it gave is what the
        // user is shown. Anything else — a 5xx, a dropped connection —
        // leaves the deployment down.
        const refused = Number.isInteger(error?.status) && error.status >= 400 && error.status < 500;
        // Server error frames carry their own user-facing message;
        // transport-level failures (timeout, premature close, network)
        // render localized — a raw fetch message is developer text.
        let errorKey = 'chatbot.streamingError';
        let message;
        if (refused) {
          errorKey = error.code === 'UNSUPPORTED_LANGUAGE' ? 'chatbot.unsupportedLanguage' : 'chatbot.processingError';
          message =
            errorKey === 'chatbot.unsupportedLanguage'
              ? t(errorKey, 'This language is not available for this deployment.')
              : t(errorKey, 'Error processing your request.');
        } else if (!error.fromServer && error.code === 'STREAM_IDLE_TIMEOUT') {
          errorKey = 'chatbot.streamTimeout';
          message = t(errorKey, 'The assistant is not responding — the request timed out.');
        } else if (error.fromServer) {
          errorKey = null;
          message = error.message;
        } else {
          message = t(errorKey, 'Response was interrupted. Please try again.');
        }
        if (!refused) {
          commit('status/setOffline', message, { root: true });
        }
        commit('failStream', { message, errorKey });
      }
    });
    activeController = controller;
  },
  abortStream({ commit }) {
    if (!activeController) return;
    const controller = activeController;
    activeController = null;
    controller.abort();
    // The aborted fetch rejects with an AbortError the service swallows,
    // so nothing else closes the turn it was writing — mark it here, and
    // the retry affordance replaces the eternal spinner.
    commit('markInterrupted');
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
  const restored = {};
  for (const [id, entry] of Object.entries(payload.conversations)) {
    // A stored entry is only trusted when every field the chat view
    // reads is present and well-typed — a partial object would crash
    // the first render, so drift discards the whole stored state.
    if (!entry || !Array.isArray(entry.messages)) {
      moduleState.conversations[moduleState.openId] = emptyConversation();
      return;
    }
    const clean = emptyConversation();
    clean.messages = entry.messages.filter((m) => m && typeof m === 'object');
    clean.selectedContextItems = Array.isArray(entry.selectedContextItems) ? entry.selectedContextItems : [];
    clean.relatedDocuments = Array.isArray(entry.relatedDocuments) ? entry.relatedDocuments : [];
    clean.lastSavedState =
      entry.lastSavedState && typeof entry.lastSavedState === 'object'
        ? {
            messages: Array.isArray(entry.lastSavedState.messages) ? entry.lastSavedState.messages : [],
            contextItems: Array.isArray(entry.lastSavedState.contextItems) ? entry.lastSavedState.contextItems : []
          }
        : { messages: [], contextItems: [] };
    clean.conversationId = entry.conversationId || null;
    clean.title = typeof entry.title === 'string' ? entry.title : '';
    clean.isStreaming = Boolean(entry.isStreaming);
    if (clean.isStreaming) {
      // The fetch died with the page: the turn renders through the
      // existing retry affordance.
      markEntryInterrupted(clean);
    }
    restored[id] = clean;
  }
  moduleState.conversations = restored;
}

const PERSIST_DEBOUNCE_MS = 300;
const PERSIST_MAX_WAIT_MS = 2000;

export function subscribeConversation(store) {
  let timer = null;
  let firstChangeAt = 0;
  // The debounce's minimum lag is one full window: a reload that lands
  // inside it would otherwise drop the newest turns entirely. The page
  // lifecycle event fires before the document goes away, so the write
  // through here is what a reload reads back.
  const onPageHide = () => {
    // A null timer means the last debounced write already captured the
    // exact current state — skip the redundant synchronous write on the
    // unload path. Invariant: every write to the conversation state goes
    // through a conversation/-prefixed mutation (the only direct writer,
    // rehydrateConversation, runs before this subscription exists).
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    persistConversation(store.state.conversation);
  };
  document.addEventListener('pagehide', onPageHide);
  const unsubscribeStore = store.subscribe((mutation) => {
    if (!mutation.type.startsWith('conversation/')) return;
    const now = Date.now();
    if (!timer) firstChangeAt = now;
    if (timer) clearTimeout(timer);
    // A trailing debounce alone never fires during a continuous
    // generation — every chunk re-arms it. A wall on the first change
    // caps the wait, so a reload mid-stream still finds the partial
    // answer.
    const delay = Math.min(PERSIST_DEBOUNCE_MS, Math.max(0, PERSIST_MAX_WAIT_MS - (now - firstChangeAt)));
    timer = setTimeout(() => {
      timer = null;
      persistConversation(store.state.conversation);
    }, delay);
  });
  return () => {
    unsubscribeStore();
    document.removeEventListener('pagehide', onPageHide);
    if (timer) clearTimeout(timer);
    timer = null;
  };
}
