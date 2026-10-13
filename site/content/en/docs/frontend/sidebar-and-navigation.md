---
title: "Sidebar & Navigation"
description: "Both sidebars of the web app — left navigation (services tree, saved chats, weather), right context pane (related documents, FAQ), mobile overlay behaviour."
weight: 6
mode: reference
persona: developer
owner: "docs-stewards"
last_reviewed: 2026-09-18
---

> **For frontend developers and UX readers.** How the left and right sidebars fit into the layout, what they show, what they persist, and how they adapt to small screens and on-screen keyboards.

## Prerequisites

- [UI Component Inventory](/docs/frontend/ui-component-inventory-frontend/) — names and locations of the components referenced below.
- [State Management](/docs/frontend/state-management-frontend/) — the `chatHistory` Vuex module that owns the saved chats list.
- A Keycloak session — both sidebars are mounted only after `currentUser` is truthy.

## Layout overview

```
┌─────────────────────────────────────────────────────────────────────┐
│ NavBarComponent (top) — logo, user menu, language, logout           │
├──────────────┬──────────────────────────────────────────┬───────────┤
│ SideBar (L)  │ Chat / view content                      │ RightSide │
│              │                                          │ Bar       │
│ - services   │                                          │           │
│ - chats      │                                          │ - related │
│ - weather    │                                          │ - FAQ     │
│              │                                          │           │
└──────────────┴──────────────────────────────────────────┴───────────┘
```

Both sidebars live **outside** the central content area but **inside** the authenticated shell. They mount conditionally in `App.vue`:

```html
<side-bar-component v-if="showSidebar" :is-open="isSidebarOpen" />
```

The `showSidebar` flag comes from the current route's `meta.showSidebar` (most authenticated routes set it `true`; the `/callback` route does not).

## Left sidebar — `SideBarComponent.vue`

### Tabs

The sidebar is split into two tabs at the top, rendered with `DsTabs`:

| Tab | Content | Backed by |
|-----|---------|-----------|
| **Government Services** | `ServiceTreePanelComponent` — hierarchical tree of categories | `serviceTreeService.getAllCategories(locale)` |
| **Saved Chats** | `ChatFolders` + `ChatHistoryComponent` — folder sub-tabs + conversation list | `chatHistoryStore` |

The active tab is local component state; it does not persist across reloads (the first tab is selected by default).

### Collapse / expand

A Lucide chevron toggle in the sidebar header flips `isSidebarOpen`. The boolean:

- is **persisted** to `localStorage['sidebarOpen']` (`App.vue:286`).
- is **hydrated** on `mounted` (`App.vue:126-129`).
- is **owned by `App.vue`**, not the sidebar component itself — the sidebar is a controlled widget receiving `:is-open` and emitting `@toggle-sidebar`.

Collapsed state hides the panel on desktop and is irrelevant on mobile (mobile always opens as a full-screen overlay, see below).

### Sub-tabs (Saved Chats)

Inside the Saved Chats tab, `ChatFolders` renders four sub-tabs:

| Sub-tab | Shows |
|---------|-------|
| All | Every conversation (joined with `default` folder contents) |
| Folders | User-created folders (excludes the pinned `default`) |
| Starred | Conversations flagged with the star action |
| Archived | Conversations archived via the per-row menu |

The active sub-tab is local state (not persisted). Searching the list filters in-memory by title and preview; the search field is also local state.

### Per-conversation actions

Each row in `ChatHistoryComponent` exposes a context menu via `ContextMenu.vue`:

| Action | Effect |
|--------|--------|
| Open | Loads the conversation into the chat view. |
| Rename | Inline edit (title only). |
| Star / Unstar | Toggles the star flag (UI-only flag, persisted in `chatHistory.chats[i].starred`). |
| Archive / Unarchive | Moves between active and archived. |
| Move to folder | Sub-menu of folders + "New folder…" inline. |
| Delete | Confirms via `ConfirmDialog`, then dispatches `chatHistory.deleteChat`. |

The `moveChat` action is the documented non-trivial one — see [State Management → `moveChat`](/docs/frontend/state-management-frontend/#movechat--the-non-trivial-one) for the failure-isolation logic.

### Service tree — `ServiceTreePanelComponent.vue`

| Element | Behaviour |
|---------|-----------|
| Search box | Local substring filter on category names + child labels. |
| Expand-all toggle | Recursively expands every node in the loaded tree. |
| Tree rows | Click-to-select emits `treeNodeSelected` on the global `eventBus`. `ChatBotComponent` listens and adds a context pill. |
| Locale | `serviceTreeService.getAllCategories(currentLocale)` is called on mount and on locale change. |

Empty / loading / error states use `DsStateDisplay`. The failure mode is most often a missing translation: the service returns the canonical English label as a fallback, and the panel logs a warning in the console.

### Weather panel — `WeatherPanel.vue`

A small contextual widget rendered at the bottom of the left sidebar. Data source is `weatherService`, which hits an upstream provider configured per deployment.

| Field | Notes |
|-------|-------|
| Current temperature + icon | Lucide icon: `sun`, `cloud`, `cloud-rain`, `cloud-snow` (mapped server-side). |
| Multi-day forecast | Up to 5 days, scrollable horizontally on narrow viewports. |
| Auto-hide on keyboard | When the on-screen keyboard opens on mobile, the panel hides (see [Mobile behaviour](#mobile-behaviour)). |
| Disable for a deployment | Set the upstream provider URL to empty in the deployment config to render the panel as a `DsStateDisplay` empty-state. |

### Mobile behaviour

Below the `bp-md` breakpoint (768 px), the sidebar switches to a full-screen overlay:

```html
<div v-if="isOpen" class="mobile-sidebar-overlay" @click="closeOverlay"></div>
<!-- sidebar rendered at 100 % width, slides in from the left -->
```

- **Hamburger trigger** in `NavBarComponent` opens the overlay (same `toggle-sidebar` event).
- **Backdrop click** (`mobile-sidebar-overlay`) closes it.
- **VisualViewport handling** — the sidebar listens for `visualViewport.resize` (lines 135-148). When the on-screen keyboard opens (`visualViewport.height` shrinks by ≥ 150 px), the sidebar scrolls its inner container to keep the focused input visible and the weather panel auto-hides (`viewport-height ≤ 400` triggers a `isMobileKeyboardOpen` flag).
- **Focus trap** — when the overlay is open, tabbing cycles within the sidebar; Escape closes it.

State on mobile: the overlay is forced **closed** when the user navigates to a new route (so back-navigation doesn't reveal a stale overlay).

## Right sidebar — `RightSideBarComponent.vue`

The right sidebar is a **context surface**, not a navigation surface. It updates in response to the chat state, not the route.

### Collapse / expand

The right sidebar collapses via a Lucide chevron in its own header. Collapse state is **per-session** (not persisted) — every fresh page load starts expanded.

### Related Documents section

Updated **per message** (every bot response). Each entry shows:

| Field | Source |
|-------|--------|
| Title | `metadata.sources[i].title` |
| URL | `metadata.sources[i].url` |
| Document name | `metadata.sources[i].document_name` |
| File name | `metadata.sources[i].file_name` |
| ID | `metadata.sources[i].id` |
| Labels | `metadata.sources[i].labels` (taxonomy matches) |
| Confidence score | `metadata.sources[i].confidence_score` (same metric as the chat chip — see [Chat UX → Confidence](/docs/frontend/chat-ux/#confidence-chip-and-grounding-flag)) |

Clicking an entry opens the source URL in a new tab (no in-app viewer).

Empty state ("No related documents") shows `DsStateDisplay` until the first bot message arrives.

### FAQ section

A collapsible section below Related Documents. FAQ is loaded from `/FAQ.md` (a single Markdown file); `RightSideBarComponent.vue` parses the markdown by `<h2>` headings (each h2 starts a new Q&A pair; the body becomes the answer). When the current locale is not English, the markdown is translated via `POST /api/translate/markdown` before parsing. The panel renders each Q&A as a `<details>` element so the user can open any combination.

| Source state | Behaviour |
|--------------|-----------|
| FAQ loads successfully | Used as-is (English) or translated then rendered. |
| `/FAQ.md` fetch fails | Section hidden; the `loadFaqContent()` catch sets a single error entry. |

### Interaction with the chat window

The right sidebar **does not own any state of its own**. It receives the related-documents payload from `ChatBotComponent` via a prop or `eventBus` event (depending on the version of the code), and renders it. When the user starts a new conversation, the right sidebar clears (no sources, FAQ empty state).

## Failure modes & troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Sidebar won't stay open after reload | `localStorage['sidebarOpen']` corrupted (e.g. JSON-encoded from a different app). | Clear the key: `localStorage.removeItem('sidebarOpen'); location.reload()`. |
| Sidebar covers the chat on mobile | Overlay opened but backdrop click isn't dismissing. | Check the `mobile-sidebar-overlay` click handler is wired (`SideBarComponent.vue:12`). Often broken after refactoring — verify `@click="closeOverlay"`. |
| Service tree empty | `serviceTreeService.getAllCategories` returned an empty array — usually a backend deployment missing the `serviceCategory` collections. | Check the network response in DevTools; backend log will show the AQL error. |
| Service tree labels are in English regardless of locale | Translation missing in the i18n bundle. | Verify the key exists in `src/i18n/locales/<locale>.json` and the service falls back gracefully. |
| Weather panel shows "—" | Upstream weather provider returned no data or the URL is misconfigured. | Check `weatherService` URL; the panel is non-fatal — empty state replaces the spinner. |
| Related documents list doesn't update | The `metadata` SSE frame didn't include `sources`. | Check the backend RAG pipeline — sources are populated by the retriever. The panel will show empty state. |
| Star/Archive actions appear to do nothing | The mutation runs, but the UI filter still shows the old state. | Sub-tab filter is local state — switch sub-tabs and back, or reload the conversation list. |
| Right sidebar collapses on every refresh | Collapse state is intentionally non-persistent. | If product wants persistence, persist to `localStorage['rightSidebarOpen']` and hydrate on mount. |

## Programmatic access

Both sidebars are mounted as children of `App.vue` and are not directly addressable from arbitrary components. Components that need to drive the sidebar:

```javascript
// Open the left sidebar from anywhere
this.$root.$emit('open-sidebar');   // App.vue listens and sets isSidebarOpen = true

// Or directly via the Vuex store (if you expose it):
this.$store.commit('ui/SET_SIDEBAR', true);
```

The right sidebar is read-only from the application code's perspective — it follows the chat state automatically.

## Related

- [UI Component Inventory](/docs/frontend/ui-component-inventory-frontend/) — full file map.
- [State Management](/docs/frontend/state-management-frontend/) — the `chatHistory` module that backs Saved Chats.
- [Chat UX](/docs/frontend/chat-ux/) — the chat surface the right sidebar serves.
- [Theme System](/docs/frontend/theme-system/) — design tokens both sidebars consume.
