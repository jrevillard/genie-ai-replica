---
title: "UI Component Inventory"
description: "Canonical catalogue of the 52 Vue components in gov-chat-frontend — DS primitives, layout, chat, admin, services, files, settings, and shared widgets."
weight: 1
mode: reference
persona: developer
owner: "docs-stewards"
last_reviewed: 2026-09-18
---

> **For frontend developers.** The single source of truth for which `.vue` files exist, where they live, and which one to reach for when you need a pattern. Counts are verified against the current source tree.

## When to use this page

- You need to **find an existing component** before writing a new one (DS primitives first, then shared widgets, then feature components).
- You need to **locate the file** that owns a UI behaviour (search the section, then `grep` the file).
- You are **onboarding to the codebase** and want a one-page map of every screen and dialog.

Counts in the tables below come from `find components/gov-chat-frontend/src -name '*.vue' -not -path '*/__tests__/*' | wc -l` and add up to **52** files. Tests live under `src/__tests__/` and are intentionally not part of this inventory.

## Summary

| Group | Count | Where |
|-------|-------|-------|
| Root app shell | 1 | `src/App.vue` |
| Design System primitives | 12 | `src/components/ds/` |
| Chart components | 5 | `src/components/charts/` |
| Layout / navigation | 3 | `src/components/{NavBarComponent,SideBarComponent,SplashScreen}.vue` |
| Chat interface | 6 | `src/components/Chat*.vue`, `RightSideBarComponent.vue`, `WeatherPanel.vue` |
| Admin & analytics | 4 | `src/components/{Admin,Analytics*,UnifiedAnalytics}*.vue` |
| Query inspector (admin) | 3 | `src/components/admin/QueryInspector/` |
| Authentication & user | 3 | `src/views/CallbackView.vue`, `DashboardView.vue`, `UserProfileComponent.vue` |
| Settings | 2 | `src/components/{SettingsComponent,LanguageSelector}.vue` |
| File management | 4 | `src/components/{FileUploadComponent,UploadFilesDialog,AddFromLinkDialog,FileDetailsDialog}.vue` |
| Service / context | 2 | `src/components/Service*Panel*.vue` |
| Shared widgets | 6 | `src/components/{ConfirmDialog,ModalDialog,ContextMenu,OperationResultsModal,LogSearchDialog,SearchableCountryDropdown}.vue` |
| **Total** | **52** | |

> The legacy `src/components/UsageTrendChart.vue` is still on disk (raw ApexCharts) but has been superseded by the wrapper at `src/components/charts/UsageTrendChart.vue`. New code uses the wrapper only.

---

## Design System primitives — `src/components/ds/`

All visual primitives. **Always use these first.** Component-level rules, variant tables, and the DS token reference live in [`components/gov-chat-frontend/CLAUDE.md`](https://github.com/) (in-repo). What follows is the file map.

| Component | File | Variants | Used for |
|-----------|------|----------|----------|
| `DsButton` | `ds/Button.vue` | primary, secondary, ghost, danger | Every button. `tag="a"` for link styling. |
| `DsCard` | `ds/Card.vue` | default, flat, elevated, outline | Panels, metric cards, list items. `hoverable` for clickable surfaces. |
| `DsInput` | `ds/Input.vue` | sm, md, lg + textarea | Text inputs, search, textareas. Pairs with `DsFormGroup`. |
| `DsFormGroup` | `ds/FormGroup.vue` | — | Label + input wrapper; handles error display. |
| `DsSelect` | `ds/Select.vue` | sm, md, lg | Native dropdowns. |
| `DsCombobox` | `ds/Combobox.vue` | sm, md, lg | Searchable dropdowns (country picker, filter selects). |
| `DsModal` | `ds/Modal.vue` | sm, md, lg, xl | Dialogs and confirmations. |
| `DsPill` | `ds/Pill.vue` | accent, success, warning, danger, info | Status labels, badges. |
| `DsSpinner` | `ds/Spinner.vue` | sm, md, lg + `overlay` mode | Loading states. `overlay=true` for full-area spinners. |
| `DsStatusTag` | `ds/StatusTag.vue` | success, error, warning, info, pending | Document/crawl status mapping. |
| `DsTabs` | `ds/Tabs.vue` | default, fill | Tab navigation. `fill` for full-width tabs. |
| `DsStateDisplay` | `ds/StateDisplay.vue` | empty, loading, error | Empty/error/loading placeholders. |

**Rule:** DS components do not perform i18n internally. Consumers pass translated strings via props or slots. See `i18n` section below.

**Patterns that intentionally do NOT have a DS component:** layout panels (sidebar, navbar), specialised widgets (thumb buttons, skin-tone selectors), chart-library tooltips (ECharts/ApexCharts), and large complex dialogs (`FileDetailsDialog`, `UserProfileComponent` — domain logic is too entangled to safely refactor). See the in-repo `CLAUDE.md` for the full list.

---

## Chart components — `src/components/charts/`

All charts use **ApexCharts** through the `vue3-apexcharts` Vue plugin. The legacy raw-ApexCharts `src/components/UsageTrendChart.vue` is deprecated — migrate to the wrapper under `charts/`.

| Component | Purpose |
|-----------|---------|
| `UsageTrendChart.vue` | Line chart — query volume over time. |
| `CategoryDistributionChart.vue` | Donut chart — distribution of chats across service categories. |
| `SatisfactionGauge.vue` | Gauge chart — aggregate user-satisfaction score. |
| `SatisfactionHeatmap.vue` | Heatmap — satisfaction by time × category. |
| `TopQueriesChart.vue` | Horizontal bar — most frequent queries. |

---

## Layout / navigation

| Component | Purpose |
|-----------|---------|
| `App.vue` | Root shell. Binds `:data-theme="theme"` on `<div id="app">`, owns the global notification toast (no `NotificationSystem.vue` — toasts are inline at `App.vue` lines 36–38 and the auto-dismiss timer around line 149). Mounts `NavBarComponent`, `SideBarComponent`, and `<router-view>`. |
| `NavBarComponent.vue` | Top bar — logo, user menu, language selector, logout. |
| `SideBarComponent.vue` | Left sidebar — services tree + saved chats (see [Sidebar & Navigation](/docs/frontend/sidebar-and-navigation/)). |
| `SplashScreen.vue` | Initial loading screen — logo + progress indicator. |

---

## Chat interface

| Component | Purpose |
|-----------|---------|
| `ChatBotComponent.vue` | Main chat window — message list, input, streaming indicator, status pill, context pills, confidence chip, grounding warning. See [Chat UX](/docs/frontend/chat-ux/). |
| `ChatFolders.vue` | Folder CRUD UI (create/rename/delete) for the saved-chats sidebar. |
| `ChatHistoryComponent.vue` | Conversation list — search, filter, sort. |
| `ChatResponseFeedbackDialog.vue` | Two-column feedback dialog — thumbs + 1–5 rating + comment. See [Chat UX → Feedback](/docs/frontend/chat-ux/#feedback-dialog). |
| `RightSideBarComponent.vue` | Right column — related documents + FAQ. See [Sidebar & Navigation → Right sidebar](/docs/frontend/sidebar-and-navigation/#right-sidebar-related-documents). |
| `WeatherPanel.vue` | Contextual weather widget (right sidebar). Optional — see [Sidebar & Navigation → Weather](/docs/frontend/sidebar-and-navigation/#weather-panel). |

---

## Admin & analytics

| Component | Purpose |
|-----------|---------|
| `AdminDashboard.vue` | 8-tab admin surface (overview / hierarchy / documents / database / logs / query inspector / users / security). See [Admin Dashboard](/docs/frontend/admin-dashboard/). |
| `AnalyticsDashboard.vue` | High-level analytics — KPIs + chart strip. |
| `AnalyticsComponent.vue` | Filterable analytics view (date range, category). |
| `UnifiedAnalytics.vue` | Combined view merging multiple metric panels. |
| `QueryInspector/` (subfolder) | Query log browser with detail view. See [Admin Dashboard → Query inspector](/docs/frontend/admin-dashboard/#query-inspector). |
| `QueryInspector.vue` | Top-level inspector — list + detail side-by-side. |
| `QueryInspectorList.vue` | Filterable list of recent queries. |
| `QueryInspectorDetail.vue` | Per-query detail (request, retrieved chunks, response, metadata). |

---

## Authentication & user profile

| Component | Purpose |
|-----------|---------|
| `CallbackView.vue` | OIDC redirect handler. `/callback` route — completes the Keycloak auth code flow. |
| `DashboardView.vue` | Default authenticated landing — wraps the chat UI. |
| `UserProfileComponent.vue` | Profile view + edit (name, email, language). |

Auth flow details live in [Auth Flow](/docs/frontend/auth-flow/).

---

## Settings

| Component | Purpose |
|-----------|---------|
| `SettingsComponent.vue` | Settings panel — theme, font size, language overrides. |
| `LanguageSelector.vue` | Standalone locale dropdown (also embedded in the navbar). |

---

## File management

| Component | Purpose |
|-----------|---------|
| `FileUploadComponent.vue` | Drag-and-drop upload widget (single file). |
| `UploadFilesDialog.vue` | Multi-file upload dialog — drag-and-drop, allowed extensions, progress. |
| `AddFromLinkDialog.vue` | URL crawl dialog — single page vs full-site async, depth setting. |
| `FileDetailsDialog.vue` | File detail modal — metadata tab + ingestion dashboard tab with live-dot crawl indicator. |

---

## Service / context

| Component | Purpose |
|-----------|---------|
| `ServiceTreePanelComponent.vue` | Hierarchical tree of service categories (sidebar tab). |
| `ServiceCategoryPanelComponent.vue` | Single-category detail panel (children + descriptions). |

Locale-aware labels are loaded via `serviceTreeService.getAllCategories(locale)`. See [Sidebar & Navigation → Service tree](/docs/frontend/sidebar-and-navigation/#service-tree).

---

## Shared widgets

| Component | Purpose |
|-----------|---------|
| `ConfirmDialog.vue` | Generic confirmation dialog (confirm/cancel). |
| `ModalDialog.vue` | Generic modal wrapper (used when `DsModal` does not fit the use case). |
| `ContextMenu.vue` | Right-click context menu with custom actions. |
| `OperationResultsModal.vue` | Bulk-operation result display (success/failure + per-operation detail). |
| `LogSearchDialog.vue` | Search interface for system logs. |
| `SearchableCountryDropdown.vue` | Country selector with text search. |

---

## Views — `src/views/`

| Component | Purpose |
|-----------|---------|
| `DashboardView.vue` | Default authenticated view — composes the chat UI. |
| `CallbackView.vue` | OIDC callback target — completes the auth code flow and redirects. |

---

## Component organization (file tree)

```
src/
├── App.vue                          # Root shell (data-theme, notifications, router-view)
├── views/                           # Router-level views (2)
│   ├── CallbackView.vue
│   └── DashboardView.vue
├── components/
│   ├── ds/                          # DS primitives (12)
│   ├── charts/                      # ApexCharts wrappers (5)
│   ├── admin/QueryInspector/        # Admin query log browser (3)
│   └── (top-level application + shared widgets, 29)
└── i18n/locales/                    # vue-i18n messages
```

The full file map with descriptions is in the tables above.

---

## Notes

- **Vue 3 Options API only.** Options API = component logic declared in `data / computed / methods / watch` blocks. Vue 3 supports this alongside Composition API's `setup()` function. The GENIE.AI codebase uses Options API as the project convention — do not introduce `<script setup>` blocks in new code.
- **State**: Vuex 4. See [State Management](/docs/frontend/state-management-frontend/).
- **Charts**: ApexCharts via [`vue3-apexcharts`](https://apexcharts.com/) (Vue 3 wrapper). Internal usage is via the per-chart components above — call them, do not import ApexCharts directly.
- **Routing**: Vue Router. Routes in `src/router/`; views live in `src/views/`.
- **i18n**: [`vue-i18n`](https://vue-i18n.intlify.dev/) with translations in `src/i18n/locales/`. Whitelist is config-driven — see `VUE_APP_AVAILABLE_LOCALES` in [Configuration](/docs/configure/external-idp-integration-guide/) and the i18n system overview.
- **Icons**: [Lucide](https://lucide.dev/) — `<LucideIcon name="chevron-right" />` style. The styling system and color tokens are defined in `src/theme-variables.css` and described in [Theme System](/docs/frontend/theme-system/).

## Related

- [State Management](/docs/frontend/state-management-frontend/)
- [Theme System](/docs/frontend/theme-system/)
- [Auth Flow](/docs/frontend/auth-flow/)
- [Chat UX](/docs/frontend/chat-ux/)
- [Sidebar & Navigation](/docs/frontend/sidebar-and-navigation/)
- [Admin Dashboard](/docs/frontend/admin-dashboard/)
- `components/gov-chat-frontend/CLAUDE.md` — DS rules, when to extract a new primitive, the per-primitive variant/props table.
