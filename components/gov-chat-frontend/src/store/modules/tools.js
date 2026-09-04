import httpService from '@/services/httpService';

const state = {
  feeds: [],
  isLoadingFeeds: false,
  error: null,
  config: null,
  isLoadingConfig: false,
  configError: null
};

const getters = {
  feeds: (state) => state.feeds,
  isLoadingFeeds: (state) => state.isLoadingFeeds,
  toolsConfig: (state) => state.config,
  isLoadingConfig: (state) => state.isLoadingConfig
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
