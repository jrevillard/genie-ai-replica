# UI Component Inventory - gov-chat-frontend

## Overview
This Vue.js component library contains 38 components organized across multiple categories for a government service chatbot application with RAG capabilities, analytics, multilingual support, and comprehensive user management.

## Component Categories

### 1. Layout Components
| Component | Location | Props | Reusability | Description |
|-----------|----------|-------|-------------|-------------|
| **App.vue** | `/src/App.vue` | - | App-specific | Main application container with sidebar, navigation, and modal management |
| **NavBarComponent** | `/src/components/NavBarComponent.vue` | `isSidebarOpen`, `config` | Medium | Top navigation with logo, menu toggle, language selector, and admin controls |
| **SideBarComponent** | `/src/components/SideBarComponent.vue` | `isOpen` | Medium | Left sidebar with service tree tabs and chat history |
| **RightSideBarComponent** | `/src/components/RightSideBarComponent.vue` | `current-chat-id`, `current-locale` | Medium | Right sidebar for related documents and contextual information |
| **DashboardView** | `/src/views/DashboardView.vue` | - | Medium | Main dashboard container wrapping ChatBotComponent |

### 2. Chat Interface Components
| Component | Location | Props | Reusability | Description |
|-----------|----------|-------|-------------|-------------|
| **ChatBotComponent** | `/src/components/ChatBotComponent.vue` | Complex state | Low | Main chat interface with message display, input, feedback, and document management |
| **ChatResponseFeedbackDialog** | `/src/components/ChatResponseFeedbackDialog.vue` | `visible`, `message` | Medium | Modal for collecting user feedback on chat responses |
| **ChatFolders** | `/src/components/ChatFolders.vue` | `active-tab` | Medium | Advanced conversation management with folders, search, starring |
| **ChatHistoryComponent** | `/src/components/ChatHistoryComponent.vue` | - | Low | Legacy component for displaying chat history |

### 3. Service & Navigation Components
| Component | Location | Props | Reusability | Description |
|-----------|----------|-------|-------------|-------------|
| **ServiceTreePanelComponent** | `/src/components/ServiceTreePanelComponent.vue` | - | Medium | Hierarchical government service tree with search and selection |
| **ServiceCategoryPanelComponent** | `/src/components/ServiceCategoryPanelComponent.vue` | - | Medium | Simplified service category display with icons |
| **WeatherPanel** | `/src/components/WeatherPanel.vue` | - | Medium | Weather widget in sidebar with location-based forecasts |

### 4. Analytics & Dashboard Components
| Component | Location | Props | Reusability | Description |
|-----------|----------|-------|-------------|-------------|
| **UnifiedAnalytics** | `/src/components/UnifiedAnalytics.vue` | `useDynamicData` | Medium | Comprehensive analytics dashboard with charts and metrics |
| **AdminDashboard** | `/src/components/AdminDashboard.vue` | - | Low | Admin panel for system monitoring, logs, and security |
| **AnalyticsDashboard** | `/src/components/AnalyticsDashboard.vue` | - | Low | Simplified KPI dashboard for user engagement |
| **UsageTrendChart** | `/src/components/charts/UsageTrendChart.vue` | `data`, `externalData`, `period` | High | Reusable chart for displaying usage trends over time |
| **SatisfactionGauge** | `/src/components/charts/SatisfactionGauge.vue` | `value`, `target` | High | Visual gauge for displaying user satisfaction metrics |
| **SatisfactionHeatmap** | `/src/components/charts/SatisfactionHeatmap.vue` | `data`, `period` | High | Heatmap visualization for satisfaction patterns |
| **CategoryDistributionChart** | `/src/components/charts/CategoryDistributionChart.vue` | `data`, `render-key` | High | Pie/donut chart for service usage distribution |
| **TopQueriesChart** | `/src/components/charts/TopQueriesChart.vue` | `data`, `externalData` | High | Bar chart for displaying most frequent user queries |

### 5. User Profile & Settings Components
| Component | Location | Props | Reusability | Description |
|-----------|----------|-------|-------------|-------------|
| **UserProfileComponent** | `/src/components/UserProfileComponent.vue` | - | Medium | Multi-tab modal for comprehensive user data management |
| **SettingsComponent** | `/src/components/SettingsComponent.vue` | - | Medium | Settings dialog for theme, language, and preferences |
| **LanguageSelector** | `/src/components/LanguageSelector.vue` | - | High | Dropdown for switching application language |

### 6. Modal & Dialog Components
| Component | Location | Props | Reusability | Description |
|-----------|----------|-------|-------------|-------------|
| **ModalDialog** | `/src/components/ModalDialog.vue` | `title`, `message`, `useTranslation` | High | Generic reusable modal with header, body, footer slots |
| **ModalComponent** | `/src/components/ModalComponent.vue` | - | Medium | Alternative modal component |
| **ConfirmDialog** | `/src/components/ConfirmDialog.vue` | `visible`, `title`, `message` | High | Specialized confirmation dialog |
| **UploadFilesDialog** | `/src/components/UploadFilesDialog.vue` | - | Low | File upload modal |
| **AddFromLinkDialog** | `/src/components/AddFromLinkDialog.vue` | - | Low | Add content via URL dialog |
| **FileDetailsDialog** | `/src/components/FileDetailsDialog.vue` | - | Low | File details display modal |

### 7. Form & Input Components
| Component | Location | Props | Reusability | Description |
|-----------|----------|-------|-------------|-------------|
| **FileUploadComponent** | `/src/components/FileUploadComponent.vue` | - | Medium | File upload component with progress indication |
| **SearchableCountryDropdown** | `/src/components/SearchableCountryDropdown.vue` | - | High | Country selection dropdown with search functionality |

### 8. Utility & Display Components
| Component | Location | Props | Reusability | Description |
|-----------|----------|-------|-------------|-------------|
| **SplashScreen** | `/src/components/SplashScreen.vue` | - | Low | Application loading screen |
| **ContextMenu** | `/src/components/ContextMenu.vue` | - | Medium | Right-click context menu implementation |
| **CallbackView** | `/src/views/CallbackView.vue` | - | Low | OIDC authentication callback handler |

## Design System Patterns

### 1. Styling Approach
- **Scoped CSS**: All components use scoped styles
- **CSS Variables**: Theme system using CSS variables
- **Dark/Light Mode**: Comprehensive dark mode support
- **Responsive Design**: Mobile-first approach

### 2. State Management Patterns
- **Local State**: Component-specific UI state
- **Vuex Store**: Shared application state
- **Event Bus**: Cross-component communication

### 3. Internationalization
- **Vue i18n**: Full i18n support
- **Locale-specific components**: Components adapt to language changes
- **Translation keys**: Consistent use of translation keys

### 4. Component Architecture Patterns
- **Slots**: Reusable modals with slot-based content
- **Props Validation**: Consistent prop validation
- **Emits**: Standardized event emission patterns
- **Composition**: Chart components built with D3.js

### 5. Mobile & Accessibility Features
- **Android Keyboard Handling**: Special mobile keyboard handling
- **Touch-friendly interfaces**: Mobile-responsive layouts
- **ARIA Labels**: Proper accessibility attributes
- **Responsive Breakpoints**: Consistent breakpoint system

## Reusability Assessment

### Highly Reusable (Cross-project potential)
- ModalDialog, LanguageSelector, UsageTrendChart, SatisfactionGauge, SearchableCountryDropdown

### Moderately Reusable (Project-specific but adaptable)
- NavBarComponent, SideBarComponent, ChatFolders, FileUploadComponent

### Low Reusability (Specific to this application)
- ChatBotComponent, ServiceTreePanelComponent, AdminDashboard

## Key Technical Features

1. **OIDC Integration**: Keycloak authentication handling
2. **RAG Interface**: Specialized components for AI chatbot interactions
3. **Multi-language Support**: English, French, Swahili with i18n
4. **Analytics Integration**: Comprehensive charting and metrics
5. **File Management**: Upload, preview, and export capabilities
6. **Theme System**: Light/dark mode with CSS variables
7. **Mobile Optimization**: Responsive design with mobile-specific interactions
