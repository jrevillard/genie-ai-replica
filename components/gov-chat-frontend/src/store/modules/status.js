// The assistant's reachability, shared app-wide: the navbar pill renders it
// on every page, while the chat is usually the component that learns it.
const state = {
  online: true,
  lastResponseTime: null,
  errorMessage: '',
  lastUpdated: null
};

const mutations = {
  setOnline(state) {
    state.online = true;
    state.errorMessage = '';
    state.lastUpdated = new Date();
  },
  setOffline(state, message = '') {
    state.online = false;
    state.errorMessage = message;
    state.lastResponseTime = null;
    state.lastUpdated = new Date();
  },
  setResponseTime(state, ms) {
    state.lastResponseTime = ms;
  }
};

const getters = {
  status: (state) => state
};

export default {
  namespaced: true,
  state,
  mutations,
  getters
};
