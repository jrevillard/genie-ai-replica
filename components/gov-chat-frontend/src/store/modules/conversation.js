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
  setStreaming(st, { isStreaming, streamingQueryId }) {
    const entry = st.conversations[st.openId];
    entry.isStreaming = isStreaming;
    entry.streamingQueryId = streamingQueryId;
  }
};

export default {
  namespaced: true,
  state,
  getters,
  mutations
};
