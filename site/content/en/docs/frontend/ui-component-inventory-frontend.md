---
title: "Ui Component Inventory Frontend"
weight: 1
section: "frontend"
---

# UI Component Inventory - GENIE.AI Frontend

**Project**: GENIE.AI Web Application
**Framework**: Vue 3 (Options API)
**Location**: `/components/gov-chat-frontend/src/`
**Generated**: 2026-05-13

---

## Summary

- **Total Vue Components**: 55
- **Design System Components**: 12
- **Application Components**: 43

---

## Design System Primitives (`src/components/ds/`)

### Core Primitives

| Component | Description |
|-----------|-------------|
| `Button.vue` | Button primitive with variants (primary, secondary, ghost, danger) |
| `Card.vue` | Container card with shadow and border radius |
| `Input.vue` | Text input field with label, validation states, and error messaging |
| `Modal.vue` | Modal dialog overlay with header, body, footer slots |
| `Select.vue` | Dropdown select component with options |
| `Combobox.vue` | Auto-complete text input with dropdown suggestions |
| `Tabs.vue` | Tab navigation component with panels |
| `Pill.vue` | Small badge/tag component for status or category display |
| `Spinner.vue` | Loading spinner animation |
| `StatusTag.vue` | Status indicator with color coding (success, warning, error, info) |
| `StateDisplay.vue` | Empty state / error state / loading state display component |
| `FormGroup.vue` | Form field wrapper with label and error messaging |

---

## Layout Components

| Component | Description |
|-----------|-------------|
| `App.vue` | Root application component with router-view and global providers |
| `NavBarComponent.vue` | Top navigation bar with user menu, language selector, logout |
| `SideBarComponent.vue` | Left sidebar with conversation history and navigation |
| `SplashScreen.vue` | Initial loading screen with logo and progress indicator |

---

## Chat Components

| Component | Description |
|-----------|-------------|
| `ChatBotComponent.vue` | Main chat interface with message list and input area |
| `ChatFolders.vue` | Conversation folder management (create, rename, delete) |
| `ChatHistoryComponent.vue` | Conversation history list with search and filtering |
| `ChatResponseFeedbackDialog.vue` | Feedback dialog for rating chat responses (thumbs up/down) |
| `RightSideBarComponent.vue` | Right sidebar displaying context, documents, or service info |
| `WeatherPanel.vue` | Weather information display panel (contextual data) |

---

## Admin & Analytics Components

| Component | Description |
|-----------|-------------|
| `AdminDashboard.vue` | Admin dashboard with system metrics and user management |
| `AnalyticsDashboard.vue` | Analytics dashboard with charts and usage statistics |
| `AnalyticsComponent.vue` | Analytics data display with filtering and date ranges |
| `UnifiedAnalytics.vue` | Unified analytics view combining multiple metrics |

### Chart Components (`src/components/charts/`)

| Component | Description |
|-----------|-------------|
| `UsageTrendChart.vue` | Line chart showing query usage over time |
| `CategoryDistributionChart.vue` | Pie/donut chart for service category distribution |
| `SatisfactionGauge.vue` | Gauge chart for user satisfaction scores |
| `SatisfactionHeatmap.vue` | Heatmap chart for satisfaction by time/category |
| `TopQueriesChart.vue` | Bar chart showing most frequent queries |

---

## Authentication & User Profile

| Component | Description |
|-----------|-------------|
| `CallbackView.vue` | OIDC authentication callback handler (view-level component) |
| `UserProfileComponent.vue` | User profile display and edit form |

---

## Settings Components

| Component | Description |
|-----------|-------------|
| `SettingsComponent.vue` | Application settings panel (theme, language, preferences) |
| `LanguageSelector.vue` | Language selection dropdown for i18n |

---

## File Management Components

| Component | Description |
|-----------|-------------|
| `FileUploadComponent.vue` | File upload widget with drag-and-drop support |
| `UploadFilesDialog.vue` | Dialog for uploading multiple files to the knowledge base |
| `AddFromLinkDialog.vue` | Dialog for adding documents via URL/link |
| `FileDetailsDialog.vue` | File metadata display (name, size, upload date, status) |

---

## Service & Context Components

| Component | Description |
|-----------|-------------|
| `ServiceTreePanelComponent.vue` | Hierarchical tree view of service categories |
| `ServiceCategoryPanelComponent.vue` | Service category list/details panel |

---

## Shared UI Components

| Component | Description |
|-----------|-------------|
| `ConfirmDialog.vue` | Generic confirmation dialog (confirm/cancel actions) |
| `ModalDialog.vue` | Generic modal dialog wrapper component |
| `ContextMenu.vue` | Right-click context menu with custom actions |
| `NotificationSystem.vue` | Toast notification system (success, error, warning messages) |
| `OperationResultsModal.vue` | Modal displaying results of batch operations |
| `LogSearchDialog.vue` | Dialog for searching through system logs |
| `SearchableCountryDropdown.vue` | Country selector with search functionality |

---

## Views (`src/views/`)

| Component | Description |
|-----------|-------------|
| `DashboardView.vue` | Main dashboard view (router target) |
| `CallbackView.vue` | Authentication callback view (OIDC redirect handler) |

---

## Component Organization

```
src/
├── App.vue                          # Root component
├── views/                           # Router-level views
│   ├── DashboardView.vue
│   └── CallbackView.vue
├── components/
│   ├── ds/                          # Design system primitives (12)
│   ├── charts/                      # Analytics chart components (5)
│   ├── [Layout]                     # Navigation and layout (4)
│   ├── [Chat]                       # Chat interface (6)
│   ├── [Admin]                      # Admin/analytics (4)
│   ├── [Auth]                       # Authentication (2)
│   ├── [Settings]                   # Settings (2)
│   ├── [Files]                      # File management (4)
│   ├── [Services]                   # Service navigation (2)
│   └── [Shared]                     # Shared UI components (6)
```

---

## Notes

- All components use Vue 3 **Options API** (not Composition API)
- Design system components in `src/components/ds/` are reusable primitives
- Chart components use **ApexCharts** library (via vue3-apexcharts)
- Routing via Vue Router with views in `src/views/`
- i18n via vue-i18n with translations in `/src/i18n/locales/`
