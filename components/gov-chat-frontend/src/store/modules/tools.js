import httpService from '@/services/httpService';

const state = {
  feeds: [],
  isLoadingFeeds: false,
  error: null,
  config: null,
  isLoadingConfig: false,
  configError: null,
  auditEntries: [],
  auditNextCursor: null,
  isLoadingAudit: false,
  auditError: null,
  _auditRequestId: 0
};

const getters = {
  feeds: (state) => state.feeds,
  isLoadingFeeds: (state) => state.isLoadingFeeds,
  toolsConfig: (state) => state.config,
  isLoadingConfig: (state) => state.isLoadingConfig,
  auditEntries: (state) => state.auditEntries,
  auditNextCursor: (state) => state.auditNextCursor,
  isLoadingAudit: (state) => state.isLoadingAudit
};

const actions = {
  async fetchToolsConfig({ commit }) {
    commit('SET_CONFIG_LOADING', true);
    commit('SET_CONFIG_ERROR', null);
    try {
      const response = await httpService.get('admin/tools/config');
      if (response.data && response.data.success) {
        commit('SET_TOOLS_CONFIG', response.data.data);
      }
    } catch (error) {
      commit('SET_CONFIG_ERROR', error.response?.data?.message || 'Failed to fetch tools configuration');
      console.error('Error fetching tools config:', error);
    } finally {
      commit('SET_CONFIG_LOADING', false);
    }
  },

  async saveToolsConfig({ commit }, configData) {
    commit('SET_CONFIG_ERROR', null);
    try {
      const response = await httpService.put('admin/tools/config', configData);
      if (response.data && response.data.success) {
        commit('SET_TOOLS_CONFIG', response.data.data);
        return true;
      }
      return false;
    } catch (error) {
      commit('SET_CONFIG_ERROR', error.response?.data?.message || 'Failed to save tools configuration');
      console.error('Error saving tools config:', error);
      return false;
    }
  },

  async fetchAudit({ commit, state }, { append = false, ...filters } = {}) {
    // Race token: a stale slow response must not clobber a newer one
    const request = ++state._auditRequestId;
    commit('SET_AUDIT_LOADING', true);
    commit('SET_AUDIT_ERROR', null);
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') params.append(k, v);
      });
      const response = await httpService.get(`admin/tools/audit?${params.toString()}`);
      if (request !== state._auditRequestId) return;
      if (response.data && response.data.success) {
        commit(append ? 'APPEND_AUDIT' : 'SET_AUDIT', response.data.data);
      } else {
        commit('SET_AUDIT_ERROR', 'Failed to fetch audit entries');
      }
    } catch (error) {
      if (request === state._auditRequestId) {
        commit('SET_AUDIT_ERROR', error.response?.data?.message || 'Failed to fetch audit entries');
      }
      console.error('Error fetching audit:', error);
    } finally {
      if (request === state._auditRequestId) {
        commit('SET_AUDIT_LOADING', false);
      }
    }
  },

  async fetchFeeds({ commit }) {
    commit('SET_LOADING', true);
    commit('CLEAR_ERROR');
    try {
      const response = await httpService.get('admin/tools/feeds');
      if (response.data && response.data.success) {
        commit('SET_FEEDS', response.data.data);
      }
    } catch (error) {
      commit('SET_ERROR', error.response?.data?.message || 'Failed to fetch feeds');
      console.error('Error fetching feeds:', error);
    } finally {
      commit('SET_LOADING', false);
    }
  },

  async addFeed({ commit }, feedData) {
    commit('CLEAR_ERROR');
    try {
      const response = await httpService.post('admin/tools/feeds', feedData);
      if (response.data && response.data.success) {
        commit('ADD_FEED', response.data.data);
        return true;
      }
      return false;
    } catch (error) {
      commit('SET_ERROR', error.response?.data?.message || 'Failed to add feed');
      console.error('Error adding feed:', error);
      return false;
    }
  },

  async updateFeed({ commit }, { id, data }) {
    commit('CLEAR_ERROR');
    try {
      const response = await httpService.put(`admin/tools/feeds/${id}`, data);
      if (response.data && response.data.success) {
        commit('UPDATE_FEED', response.data.data);
        return true;
      }
      return false;
    } catch (error) {
      commit('SET_ERROR', error.response?.data?.message || 'Failed to update feed');
      console.error('Error updating feed:', error);
      return false;
    }
  },

  async deleteFeed({ commit }, id) {
    commit('CLEAR_ERROR');
    try {
      const response = await httpService.delete(`admin/tools/feeds/${id}`);
      if (response.data && response.data.success) {
        commit('REMOVE_FEED', id);
        return true;
      }
      return false;
    } catch (error) {
      commit('SET_ERROR', error.response?.data?.message || 'Failed to delete feed');
      console.error('Error deleting feed:', error);
      return false;
    }
  },

  async testSearch(_, query) {
    try {
      const response = await httpService.post('admin/tools/test-search', { query });
      if (response.data && response.data.success) {
        return response.data.data;
      }
      return null;
    } catch (error) {
      console.error('Error testing search:', error);
      throw error;
    }
  }
};

const mutations = {
  SET_TOOLS_CONFIG(state, config) {
    state.config = config;
  },

  SET_CONFIG_LOADING(state, value) {
    state.isLoadingConfig = value;
  },

  SET_CONFIG_ERROR(state, value) {
    state.configError = value;
  },

  SET_AUDIT(state, { entries, next_cursor }) {
    state.auditEntries = entries;
    state.auditNextCursor = next_cursor || null;
  },

  APPEND_AUDIT(state, { entries, next_cursor }) {
    state.auditEntries = [...state.auditEntries, ...entries];
    state.auditNextCursor = next_cursor || null;
  },

  SET_AUDIT_LOADING(state, value) {
    state.isLoadingAudit = value;
  },

  SET_AUDIT_ERROR(state, value) {
    state.auditError = value;
  },

  SET_FEEDS(state, feeds) {
    state.feeds = feeds;
  },
  ADD_FEED(state, feed) {
    state.feeds.push(feed);
  },
  UPDATE_FEED(state, updatedFeed) {
    const index = state.feeds.findIndex((f) => f._key === updatedFeed._key);
    if (index !== -1) {
      state.feeds.splice(index, 1, updatedFeed);
    }
  },
  REMOVE_FEED(state, id) {
    state.feeds = state.feeds.filter((f) => f._key !== id);
  },
  SET_LOADING(state, isLoading) {
    state.isLoadingFeeds = isLoading;
  },
  SET_ERROR(state, error) {
    state.error = error;
  },
  CLEAR_ERROR(state) {
    state.error = null;
  }
};

export default {
  namespaced: true,
  state,
  getters,
  actions,
  mutations
};
