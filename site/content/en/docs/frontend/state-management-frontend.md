---
title: "State Management"
description: "Vuex 4 in the Vue 3 web app — store wiring, namespacing rules, the auth and chatHistory modules, and the localStorage persistence plugin."
weight: 2
mode: reference
persona: developer
owner: "docs-stewards"
last_reviewed: 2026-09-18
---

> **For frontend developers.** How the Vue 3 web app keeps state across logins, navigation, and page reloads — and the one rule you must not break.

## Prerequisites

You should already know:

- **Vue 3 Options API** — components declared with `data / computed / methods / watch` (project convention; not Composition API).
- **Vuex 4 core concepts** — `state`, `getters`, `mutations`, `actions`, `modules`. The [Vuex guide](https://vuex.vuejs.org/guide/) covers them; the only oddity here is that **the auth module is NOT namespaced** (read on).
- **ES module imports** — `import auth from '@/store/modules/auth'` etc.

If you only remember one thing: **the auth module lives in the global Vuex namespace, but the chatHistory module is namespaced.** All `dispatch`, `commit`, and `rootGetters` calls below reflect that.

## Overview

`src/store/index.js` creates a single `vuex` store that bundles two modules plus a localStorage persistence plugin. The architecture is intentionally small — auth + chat history, nothing else — because everything else (UI state, form state, ephemeral flags) lives in the component that owns it.

```
src/store/
├── index.js                # createStore() + localStorage plugin
├── chatHistoryStore.js     # namespaced module (folders + chats)
└── modules/
    └── auth.js             # NON-namespaced module (Keycloak OIDC)
```

## Main store

`src/store/index.js`:

```javascript
import { createStore } from 'vuex';
import chatHistoryStore from './chatHistoryStore';
import auth from './modules/auth';

export default createStore({
  modules: {
    chatHistory: chatHistoryStore,  // namespaced: 'chatHistory/'
    auth                            // NOT namespaced — getters/actions are global
  },

  plugins: [
    (store) => {
      // 1. On boot, hydrate chatHistory from localStorage['chatHistory'].
      try {
        const savedChatHistory = localStorage.getItem('chatHistory');
        if (savedChatHistory) {
          const parsedData = JSON.parse(savedChatHistory);
          if (parsedData && typeof parsedData === 'object') {
            store.replaceState({ ...store.state, chatHistory: parsedData });
          }
        }
      } catch (e) {
        console.error('Error loading chat history from localStorage:', e);
      }

      // 2. Subscribe to mutations: persist every chatHistory/* mutation.
      //    CLEAR_FOLDERS wipes localStorage; everything else rewrites the blob.
      store.subscribe((mutation, state) => {
        if (mutation.type.startsWith('chatHistory/')) {
          try {
            if (mutation.type === 'chatHistory/CLEAR_FOLDERS') {
              localStorage.removeItem('chatHistory');
            } else {
              localStorage.setItem('chatHistory', JSON.stringify(state.chatHistory));
            }
          } catch (e) {
            console.error('Error saving chat history to localStorage:', e);
          }
        }
      });
    }
  ]
});
```

**Key features:**

- **One root-level persistence plugin** — only `chatHistory/*` mutations are observed; auth tokens never touch `localStorage`.
- **Replace on boot** — the plugin uses `store.replaceState({...store.state, chatHistory: parsedData})` so the rest of the default state (auth) is preserved.
- **Failure is non-fatal** — JSON parse errors and quota errors are logged but do not break the app.

## Module 1: Authentication — `src/store/modules/auth.js`

Handles Keycloak OIDC via the `keycloakAuthService` wrapper. Tokens live in memory only — never `localStorage`. After intentional logout the store blocks silent re-login via a `genie_post_logout` session flag (see [Auth Flow](/docs/frontend/auth-flow/)).

### Namespacing

**The auth module is NOT namespaced.** The actual `export default { state, getters, actions, mutations }` has no `namespaced: true`. Vuex mounts it at the root, so:

| Vuex call | Resolves to |
|-----------|-------------|
| `this.$store.getters.currentUser` | `state.user` |
| `this.$store.dispatch('login', { returnUrl })` | `auth.login` |
| `commit('setAuth', payload)` | `auth.setAuth` |
| `rootGetters['currentUser']` (from another module) | `state.user` |

The "auth/" prefix is reserved for `chatHistory` mutations only. A `rootGetters['auth/currentUser']` call would resolve to `undefined`.

### State

```javascript
state = () => ({
  isAuthenticated: false,
  user: null,
  accessToken: null,
  error: null,           // string OR { code, message }
  isInitialized: false    // set by setInitialized after first bootstrap attempt
});
```

### Getters

| Getter | Returns |
|--------|---------|
| `isAuthenticated` | `state.isAuthenticated` |
| `currentUser` | `state.user` (mapped from OIDC profile + `realm_access.roles`) |
| `accessToken` | `state.accessToken` |
| `authError` | `state.error.message` if it's an object, else the raw string — backward-compatible single-field lookup |
| `lastAuthErrorCode` | `state.error.code` if it's an object, else `null` |
| `isAuthInitialized` | `state.isInitialized` |

### Actions

| Action | Purpose |
|--------|---------|
| `initialize()` | One-time bootstrap. Honours `sessionStorage.getItem('genie_post_logout')` (intentional logout → block restoration); otherwise calls `keycloakAuthService.initialize()` and rehydrates the user from a still-valid session. Always commits `setInitialized` in `finally`. |
| `login({ returnUrl })` | Clears any `genie_post_logout` flag and redirects to Keycloak via `keycloakAuthService.login`. |
| `handleCallback()` | Runs at `/callback`. Clears the post-logout flag, validates the auth-code response, calls `setAuth`, registers the silent-renew callback. |
| `logout()` | Strips legacy `localStorage` keys (`user`, `auth_token`), sets `sessionStorage.genie_post_logout = 'true'`, removes the silent-renew callback, then calls `keycloakAuthService.logout()` (which navigates away). Always commits `clearAuth` even if the redirect fails. |
| `handleApiError(error)` | Standardises backend error parsing — accepts a string OR `{ code, message }` and writes to `state.error`. Use this from API services that want to surface errors through the auth getter layer. |
| `clearError()` | Commit alias. |

### Mutations

| Mutation | Effect |
|----------|--------|
| `setAuth({ isAuthenticated, user, accessToken })` | Bulk set after successful auth. |
| `clearAuth()` | Resets to logged-out state. |
| `setError(error)` | Accepts string or `{ code, message }`. |
| `clearError()` | `state.error = null`. |
| `setInitialized()` | `state.isInitialized = true` — mark the auth subsystem as bootstrapped. Used by both `initialize()` and `handleCallback()`. |
| `updateAccessToken({ accessToken, user })` | Silent-renew callback writes the rotated token + refreshed profile here without re-running the full login flow. |

### Data flow

```
Login button → router guard → dispatch('login', { returnUrl })
  → keycloakAuthService.login() → Keycloak redirect → /callback
  → dispatch('handleCallback') → commit('setAuth') → re-render

Silent renew (background iframe) → onAccessTokenUpdated → commit('updateAccessToken')

Logout button → dispatch('logout') → sessionStorage.genie_post_logout = 'true'
  → keycloakAuthService.logout() → Keycloak redirect → /logged-out
```

Full step-by-step auth sequence (incl. the post-logout block and silent renew iframe) is in [Auth Flow](/docs/frontend/auth-flow/).

## Module 2: Chat history — `src/store/chatHistoryStore.js`

`namespaced: true` — all dispatches are prefixed with `chatHistory/` and all mutations with `chatHistory/`. The persistence plugin watches every mutation whose type starts with that prefix.

### State

```javascript
state: () => ({
  folders: [
    { id: 'default', name: 'All Chats', isDefault: true, createdAt: <ISO> }
  ],
  chats: [],            // { id, title, preview, createdAt, updatedAt, messageCount }
  folderChats: {        // folderId → [chatId, ...]
    default: []
  }
})
```

The `default` folder is the pinned system folder — `ADD_FOLDER`, `UPDATE_FOLDER`, and `REMOVE_FOLDER` refuse to touch it (`if (!state.folders[i].isDefault) ...`). Chat deletions always re-attach the chat to `default` first so it never gets lost.

### Getters

| Getter | Signature | Notes |
|--------|-----------|-------|
| `getAllFolders` | `() => state.folders` | All folders including `default`. |
| `getChatsByFolderId` | `(folderId) => Chat[]` | Returns chat *objects* (joins `state.chats`). Filters out missing entries. |
| `getFolderById` | `(folderId) => Folder \| undefined` | Linear scan. |
| `getChatById` | `(chatId) => Chat \| undefined` | Linear scan. |

### Mutations (all namespaced — `chatHistory/MUTATION_NAME`)

| Mutation | Payload | Notes |
|----------|---------|-------|
| `setFolders(state, folders)` | `Folder[]` | Wholesale replace. |
| `ADD_FOLDER` | `{ name }` | Generates UUID, pushes, creates empty `folderChats[newId]`. Returns the new id. |
| `UPDATE_FOLDER` | `{ folderId, name }` | Refuses the default folder. |
| `REMOVE_FOLDER` | `folderId` | Refuses the default folder. Re-parents chats to `default`, deletes the `folderChats[folderId]` key. |
| `ADD_CHAT` | `{ id?, title?, preview?, folderId?, messageCount? }` | Auto-creates `folderChats[folderId]` if missing. Pins to `default` if not already there. Returns the new chat id. |
| `UPDATE_CHAT` | `{ chatId, title?, preview? }` | Sets `updatedAt`. |
| `REMOVE_CHAT` | `chatId` | Removes from every folder, deletes the chat object. |
| `ADD_CHAT_TO_FOLDER` | `{ chatId, folderId }` | Idempotent — only pushes if missing. |
| `REMOVE_CHAT_FROM_FOLDER` | `{ chatId, folderId }` | Removes from one folder only. |
| `MOVE_CHAT` | `{ chatId, fromFolderId, toFolderId }` | No-op if `from === to`. Always pins to `default`. |
| `SET_FOLDER_CHATS` | `{ folderId, chats }` | Wholesale replace. Used by the post-move refresh. |
| `CLEAR_FOLDERS` | — | Resets to the default folder only. Persistence plugin wipes `localStorage` when it sees this. |

### Actions

| Action | Behaviour |
|--------|-----------|
| `setFolders(folders)` | `setFolders` mutation. |
| `createFolder({ name })` | `ADD_FOLDER`, returns the new id. |
| `updateFolder({ folderId, name })` | `UPDATE_FOLDER`. |
| `deleteFolder(folderId)` | `REMOVE_FOLDER`. |
| `createChat(chatData)` | `ADD_CHAT`, returns the new id. |
| `updateChat(chatData)` | `UPDATE_CHAT`. |
| `deleteChat(chatId)` | `REMOVE_CHAT`. |
| `addChatToFolder({ chatId, folderId })` | `ADD_CHAT_TO_FOLDER`. |
| `moveChat({ chatId, fromFolderId, toFolderId })` | See below. |
| `removeChatFromFolder(...)` | `REMOVE_CHAT_FROM_FOLDER` plus the auto-default-pin guarantee. |

### `moveChat` — the non-trivial one

```javascript
async moveChat({ commit, rootGetters }, { chatId, fromFolderId, toFolderId }) {
  // auth module is NOT namespaced — getter lives in global namespace
  const currentUser = rootGetters['currentUser'];
  if (!currentUser) throw new Error('User is missing');

  // Authoritative backend operation — a failure here must propagate
  await chatHistoryService.moveConversation(chatId, fromFolderId, toFolderId);

  // Reflect the move locally regardless of the subsequent folder refresh
  commit('MOVE_CHAT', { chatId, fromFolderId, toFolderId });

  // Best-effort folder refresh — a failure here must NOT fail the move,
  // since the backend operation already succeeded (issue #827)
  try {
    const folder = await chatHistoryService.getFolder(toFolderId);
    const chatIds = (folder?.conversations || []).map((conv) => conv._key);
    commit('SET_FOLDER_CHATS', { folderId: toFolderId, chats: chatIds });
  } catch (error) {
    console.error(`Failed to refresh folder ${toFolderId} after moving chat ${chatId}:`, error);
  }
}
```

Two non-obvious things:

1. **`rootGetters['currentUser']` (no `auth/` prefix).** Adding `auth/` returns `undefined` and the action throws `User is missing`.
2. **`MOVE_CHAT` is committed BEFORE the best-effort refresh.** The local state always reflects what the backend has accepted; the refresh only re-syncs the canonical list of chat ids in the destination folder.

## Using the store from components

### Map getters (preferred)

```javascript
import { mapGetters, mapActions } from 'vuex';

export default {
  // ...
  computed: {
    ...mapGetters(['isAuthenticated', 'currentUser']),
    ...mapGetters('chatHistory', ['getAllFolders', 'getChatsByFolderId'])
  },
  methods: {
    ...mapActions(['login', 'logout']),
    ...mapActions('chatHistory', ['createChat', 'moveChat']),

    async archive(chat) {
      // 1. Move chat locally
      await this.moveChat({ chatId: chat.id, fromFolderId: 'default', toFolderId: 'archived' });
      // 2. Mark starred via direct commit (no action for this yet)
      this.$store.commit('chatHistory/UPDATE_CHAT', {
        chatId: chat.id,
        title: chat.title,
        preview: `[archived] ${chat.preview}`
      });
    }
  }
};
```

### Direct access (when mapping is awkward)

```javascript
export default {
  computed: {
    token() { return this.$store.getters.accessToken; }
  },
  methods: {
    async reload() {
      await this.$store.dispatch('chatHistory/setFolders', await fetchFolders());
    }
  }
};
```

The auth getters (`accessToken`, `currentUser`, `isAuthenticated`) and the chatHistory namespaced mutations follow the two rules stated at the top: **no prefix for auth, `chatHistory/` for chatHistory.**

## Service layer integration

| Service | File | Responsibility |
|---------|------|----------------|
| `keycloakAuthService` | `src/services/keycloakAuthService.js` | `oidc-client-ts` `UserManager` wrapper. In-memory token storage; silent renew; `/callback` processing; logout redirect. |
| `chatHistoryService` | `src/services/chatHistoryService.js` | Folder + conversation CRUD against the backend BFF. `moveConversation(chatId, fromFolderId, toFolderId)`, `getFolder(folderId)`, `getUserFolders()`. |
| `httpService` | `src/services/httpService.js` | Axios client with 401 retry and auth headers. |

The auth store **never** touches `localStorage`; the `keycloakAuthService` keeps tokens in memory and uses `sessionStorage` only for the `genie_post_logout` block-flag. The chatHistory store does the opposite: it is persisted to `localStorage` via the plugin, but the underlying service calls the backend for anything user-visible.

## Data flow

```
[ Auth ]
Login button → router guard → dispatch('login')
   → keycloakAuthService.login → Keycloak redirect → /callback
   → dispatch('handleCallback') → setAuth → UI re-render

[ Chat history ]
User clicks "+ New chat" → createChat → chatHistoryService.createConversation
   → ADD_CHAT → plugin → localStorage
Move chat → moveChat → chatHistoryService.moveConversation
   → MOVE_CHAT → SET_FOLDER_CHATS (best-effort refresh)

[ Persistence ]
Mutation type starts with 'chatHistory/' → plugin writes localStorage['chatHistory']
CLEAR_FOLDERS → plugin removes localStorage['chatHistory']
App boot → plugin hydrates store.replaceState({...state, chatHistory: parsed})
```

## Testing the store

Tests live in `src/__tests__/store/`. The two patterns to know:

```javascript
// 1. Namespaced dispatch/commit — pass the third arg.
await store.dispatch('chatHistory/createFolder', { name: 'Inbox' });
expect(store.state.chatHistory.folders).toHaveLength(2);

// 2. Auth is non-namespaced — no prefix.
await store.dispatch('login');
expect(store.getters.isAuthenticated).toBe(true);
```

Mock `localStorage` and the `keycloakAuthService` / `chatHistoryService` modules before importing the store. See `src/__tests__/store/` for worked examples.

## Where to go next

- [Auth Flow](/docs/frontend/auth-flow/) — step-by-step Keycloak OIDC sequence, silent-renew iframe, the `genie_post_logout` flag.
- [Chat UX](/docs/frontend/chat-ux/) — how `chatHistory` state drives the conversation list, the streaming send, save / export.
- [Theme System](/docs/frontend/theme-system/) — design tokens (independent of Vuex).
- [UI Component Inventory](/docs/frontend/ui-component-inventory-frontend/) — which components touch which state.
- `components/gov-chat-frontend/CLAUDE.md` — Testing patterns, `createApp` lifecycle, axios interceptors.
