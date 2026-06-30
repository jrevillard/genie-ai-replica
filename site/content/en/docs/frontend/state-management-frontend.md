---
title: "State Management Frontend"
weight: 2
section: "frontend"
---

# State Management Analysis - gov-chat-frontend

## Overview
The frontend application uses **Vuex 4.x** for centralized state management, with a modular architecture that separates concerns between authentication, chat history, and application state. The implementation follows modern Vue.js 3 patterns with namespaced modules.

## Store Architecture

### Main Store (`/src/store/index.js`)
```javascript
export default createStore({
  modules: {
    chatHistory: chatHistoryStore,
    auth: auth
  },
  plugins: [
    // localStorage persistence plugin for chatHistory
  ]
});
```

**Key Features:**
- Namespaced modules for better organization
- localStorage persistence for chat history data
- Plugin system for state persistence
- Centralized error handling

## Store Modules

### 1. Authentication Module (`/src/store/modules/auth.js`)

#### Purpose
Handles OIDC (OpenID Connect) authentication with Keycloak, including user session management, token handling, and authentication state.

#### State Structure
```javascript
state: {
  isAuthenticated: false,
  user: null,
  accessToken: null,
  error: null,
  isInitialized: false
}
```

#### Key Actions
- **`initialize`**: Initialize OIDC service and restore session
- **`login`**: Redirect to Keycloak login
- **`handleCallback`**: Process OAuth callback
- **`logout`**: Clear auth state and redirect to logout
- **`handleApiError`**: Standardized API error handling

#### Mutations
- **`setAuth`**: Set authenticated state with user data
- **`clearAuth`**: Clear all authentication state
- **`setError`** / **`clearError`**: Error state management
- **`updateAccessToken`**: Update access token during silent refresh

#### Data Flow
```
User Action → Service Call → Vuex Action → State Update → UI Update
```

### 2. Chat History Module (`/src/store/chatHistoryStore.js`)

#### Purpose
Manages chat conversations, folders, and message history with persistent storage.

#### State Structure
```javascript
state: () => ({
  folders: [
    {
      id: 'default',
      name: 'All Chats',
      isDefault: true,
      createdAt: new Date().toISOString()
    }
  ],
  chats: [],
  folderChats: {
    default: []
  }
})
```

#### Key Actions
- **`setFolders`**: Load folders from API
- **`createFolder`** / **`updateFolder`** / **`deleteFolder`**: Folder CRUD operations
- **`createChat`** / **`updateChat`** / **`deleteChat`**: Chat CRUD operations
- **`moveChat`**: Move chat between folders (with API sync)
- **`clearFolders`**: Reset to default state

#### Getters
- **`getAllFolders`**: Get all folders
- **`getChatsByFolderId`**: Get chats for specific folder
- **`getFolderById`**: Get folder by ID
- **`getChatById`**: Get chat by ID

#### Mutations
- **Folder operations**: `ADD_FOLDER`, `UPDATE_FOLDER`, `REMOVE_FOLDER`
- **Chat operations**: `ADD_CHAT`, `UPDATE_CHAT`, `REMOVE_CHAT`
- **Relationship management**: `ADD_CHAT_TO_FOLDER`, `MOVE_CHAT`
- **State management**: `SET_FOLDER_CHATS`, `CLEAR_FOLDERS`

## State Usage in Components

### 1. App.vue (Root Component)
```javascript
computed: {
  ...mapGetters(['isAuthenticated', 'currentUser'])
},
methods: {
  async loadFoldersOnAuth() {
    await this.$store.dispatch('chatHistory/setFolders', allFolders);
  }
}
```

### 2. RightSideBarComponent.vue
```javascript
methods: {
  getAuthToken() {
    return this.$store.getters.accessToken || null;
  }
}
```

## Service Layer Integration

### Key Service Files
- **`keycloakAuthService.js`**: OIDC authentication service
- **`chatHistoryService.js`**: Chat and folder API operations
- **`httpService.js`**: HTTP client with auth headers

### Service-Store Integration
```javascript
async moveChat({ commit, rootGetters }, { chatId, fromFolderId, toFolderId }) {
  const currentUser = rootGetters['auth/currentUser'];
  await chatHistoryService.moveConversation(chatId, fromFolderId, toFolderId);
  commit('SET_FOLDER_CHATS', { folderId: toFolderId, chats: chatIds });
}
```

## Data Flow Architecture

### 1. Authentication Flow
```
Login → keycloakAuthService.login → auth/login → setAuth → Re-render app
Callback → handleCallback → setAuth → Update UI
```

### 2. Chat Management Flow
```
Create Chat → createChat → API sync → ADD_CHAT → Update sidebar
Move Chat → moveChat → API call → MOVE_CHAT → Update folders
```

### 3. Persistence Flow
```
State Change → Vuex Mutation → Plugin → localStorage
App Load → Plugin → localStorage.getItem → Initial State
```

## Key Benefits

1. **Separation of Concerns**: Clear division between auth and chat management
2. **Persistence**: Critical data survives page refreshes
3. **Security**: Sensitive tokens kept in memory only
4. **Scalability**: Modular architecture supports easy extension
5. **Maintainability**: Centralized state management with clear patterns
