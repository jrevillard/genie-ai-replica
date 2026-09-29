---
title: "Frontend (gov-chat Web)"
description: "Vue 3 + Vuex single-page app — UI component inventory, state-management patterns, theme system, auth flow, chat UX, sidebar, and the admin dashboard."
weight: 90
section: "frontend"
---

## Documents in this section

1. [UI Component Inventory](/docs/frontend/ui-component-inventory-frontend/) — canonical map of the 52 `.vue` files (DS primitives, layout, chat, admin, services, files, settings, shared widgets).
2. [State Management](/docs/frontend/state-management-frontend/) — Vuex 4 store, the namespaced `chatHistory` module, the non-namespaced `auth` module, and the localStorage persistence plugin.
3. [Theme System](/docs/frontend/theme-system/) — CSS-native theming with a single brand color, OKLch derivation, dark mode, and config variants.
4. [Auth Flow](/docs/frontend/auth-flow/) — full Keycloak OIDC sequence: login redirect, callback, in-memory tokens, silent renew, and the `genie_post_logout` flag.
5. [Chat UX](/docs/frontend/chat-ux/) — streaming send, Markdown sanitisation, confidence / grounding chips, the feedback dialog, and save / export flows.
6. [Sidebar & Navigation](/docs/frontend/sidebar-and-navigation/) — the left services + saved-chats sidebar, the right related-documents + FAQ sidebar, mobile overlay behaviour.
7. [Admin Dashboard](/docs/frontend/admin-dashboard/) — the 8-tab admin surface (overview, hierarchy, documents, database, logs, query inspector, security, users) and the unsaved-changes guard.
8. [Accessibility](/docs/frontend/accessibility/) — DS primitive ARIA semantics, focus management, the skip-link, and the ConfirmDialog typed-confirmation flow.
9. [Notifications](/docs/frontend/notifications/) — the global toast surface in `App.vue`, the `notificationService` API, and eventBus wiring.
10. [Settings Page](/docs/frontend/settings-page/) — per-user toggles (theme, fontSize, locale, email/sound), localStorage keys, and the destructive data / account flows.
11. [User Profile](/docs/frontend/user-profile/) — the 8-tab profile surface, `/api/me` contract, and the searchable country / nationality dropdowns.

## Where to start

- **New to the codebase?** Read the UI Component Inventory, then State Management, then Theme System.
- **Implementing a chat feature?** Read Chat UX and the chat-related sections of State Management.
- **Wiring auth or troubleshooting the login loop?** Auth Flow is the single source of truth.
- **Touching the admin surface?** Admin Dashboard covers every tab and the role-gating model.

## Source layout

```
components/gov-chat-frontend/
├── src/
│   ├── App.vue                   # Root shell, data-theme, notifications, router-view
│   ├── components/               # 40 application + 12 DS primitive .vue files
│   ├── views/                    # CallbackView, DashboardView (router targets)
│   ├── store/                    # Vuex: index.js + chatHistoryStore + modules/auth
│   ├── services/                 # axios clients with 401 retry
│   ├── router/                   # Vue Router with auth guards
│   ├── config/                   # oidcConfig.js, languageConfig.js
│   ├── i18n/locales/             # vue-i18n message bundles
│   ├── theme-variables.css       # OKLch tokens, dark-mode overrides
│   └── __tests__/                # Jest tests
└── public/config/                # build-time config variants
```

In-repo conventions live in `components/gov-chat-frontend/CLAUDE.md`.
