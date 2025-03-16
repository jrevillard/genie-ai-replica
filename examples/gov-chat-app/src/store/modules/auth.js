// src/store/modules/auth.js
export default {
  state: () => ({
    user: null,
    isAuthenticated: false
  }),
  
  getters: {
    currentUser: state => state.user,
    isAuthenticated: state => state.isAuthenticated,
    userInitials: state => {
      if (!state.user || !state.user.name) return '?';
      return state.user.name
        .split(' ')
        .map(name => name.charAt(0))
        .join('')
        .toUpperCase();
    }
  },
  
  mutations: {
    setUser(state, userData) {
      state.user = userData;
      state.isAuthenticated = Boolean(userData);
    },
    
    logout(state) {
      state.user = null;
      state.isAuthenticated = false;
    }
  },
  
  actions: {
    initAuth({ commit }) {
      // Check if user is already logged in from localStorage
      try {
        const userData = localStorage.getItem('userData');
        if (userData) {
          commit('setUser', JSON.parse(userData));
        }
      } catch (e) {
        console.warn('Unable to retrieve user data:', e);
      }
    },
    
    logout({ commit }) {
      // Remove user data from localStorage
      try {
        localStorage.removeItem('userData');
      } catch (e) {
        console.warn('Unable to clear user data:', e);
      }
      
      // Update state
      commit('logout');
    }
  }
};