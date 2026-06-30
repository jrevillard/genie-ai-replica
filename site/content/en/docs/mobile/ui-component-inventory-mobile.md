---
title: "Ui Component Inventory Mobile"
weight: 1
section: "mobile"
---

# UI Component Inventory - GENIE.AI Mobile

**Project**: GENIE.AI Mobile Application
**Framework**: Flutter 3.10+ (Dart)
**Location**: `/mobile/genie_ai_mobile/lib/`
**Generated**: 2026-05-13

---

## Summary

- **Total Dart Files**: 76
- **UI Components**: 14
- **Design System Components**: 6
- **Design System Tokens**: 5
- **Services**: 12
- **Config**: 5
- **i18n Locales**: 13

---

## Design System (`lib/design_system/`)

### DS Components (`lib/design_system/components/`)

| Component | Description |
|-----------|-------------|
| `ds_button.dart` | Button primitive with variants (primary, secondary, ghost, danger) |
| `ds_card.dart` | Container card with elevation and border radius |
| `ds_input.dart` | Text input field with label, validation states, and error messaging |
| `ds_modal.dart` | Modal dialog overlay with content slot |
| `ds_spinner.dart` | Loading spinner animation (circular progress indicator) |
| `ds_state_display.dart` | Empty/error/loading state display component |

### DS Tokens (`lib/design_system/tokens/`)

| Token File | Description |
|------------|-------------|
| `app_tokens.dart` | Global design tokens (typography, colors, spacing scale) |
| `color_utils.dart` | Color utilities (lighten, darken, opacity, theme mapping) |
| `spacing.dart` | Spacing scale constants (xs, sm, md, lg, xl) |
| `radii.dart` | Border radius tokens (sm, md, lg, xl, full) |

### DS Theme (`lib/design_system/theme/`)

| File | Description |
|------|-------------|
| `app_theme.dart` | Material theme configuration (light/dark, color schemes) |

---

## Chat Components (`lib/components/chat/`)

| Component | Description |
|-----------|-------------|
| `chatbot_component.dart` | Main chat interface with message list and input area |
| `right_sidebar_component.dart` | Right sidebar displaying context, documents, or service info |
| `chat_response_feedback_dialog.dart` | Feedback dialog for rating chat responses (thumbs up/down) |
| `web_file_utils.dart` | File utility functions for web platform |
| `stub_file_utils.dart` | File utility stubs for non-web platforms |
| `right_sidebar_stub.dart` | Stub implementation for right sidebar (conditional compilation) |

---

## Sidebar Components (`lib/components/sidebar/`)

| Component | Description |
|-----------|-------------|
| `sidebar_component.dart` | Left sidebar with conversation history and navigation |
| `chat_folders_panel.dart` | Conversation folder management (create, rename, delete) |
| `service_tree_panel.dart` | Hierarchical tree view of service categories |

---

## Authentication Components (`lib/components/auth/`)

| Component | Description |
|-----------|-------------|
| `oidc_login_screen.dart` | OIDC login screen with Keycloak authentication flow |

---

## User Components (`lib/components/user/`)

| Component | Description |
|-----------|-------------|
| `user_profile_component.dart` | User profile display and edit form |

---

## Settings Components (`lib/components/settings/`)

| Component | Description |
|-----------|-------------|
| `settings_component.dart` | Application settings panel (theme, language, preferences) |
| `about_screen.dart` | About screen with app version, license, and links |

---

## Shared Components (`lib/components/shared/`)

| Component | Description |
|-----------|-------------|
| `nav_bar_component.dart` | Bottom navigation bar (mobile app navigation) |
| `confirm_dialog.dart` | Generic confirmation dialog (confirm/cancel actions) |
| `language_selector.dart` | Language selection dropdown for i18n |

---

## Application Structure (`lib/src/`)

| File | Description |
|------|-------------|
| `app.dart` | Root app widget with router and global providers |
| `sample_feature/` | Sample feature code (Flutter template, may be unused) |
| `settings/` | Settings controller and service (legacy, may be unused) |
| `localization/` | App localization delegates |

---

## Services (`lib/services/`)

### Authentication Services (`lib/services/auth/`)

| Service | Description |
|---------|-------------|
| `app_auth.dart` | Authentication state management and token handling |
| `auth_interceptor.dart` | HTTP request interceptor for auth token injection |
| `auth_logger.dart` | Authentication event logging |
| `auth_notifier.dart` | Authentication state change notifications |
| `auth_state.dart` | Authentication state enum and data classes |
| `auth_providers.dart` | Riverpod providers for auth services |
| `token_storage.dart` | Secure token storage (Keychain/Keystore) |
| `connectivity_checker.dart` | Network connectivity status checker |
| `network_error_classifier.dart` | Network error classification and retry logic |
| `insecure_http_client.dart` | HTTP client for dev environments (bypasses SSL) |

### Other Services (`lib/services/`)

| Service | Description |
|---------|-------------|
| `keycloak/keycloak_service.dart` | Keycloak OIDC service wrapper |
| `connectivity_service.dart` | Network connectivity monitoring |
| `notification_service.dart` | Push notification handling |
| `user_service.dart` | User profile and preferences service |
| `i18n_service.dart` | Internationalization service |
| `genie_ai_config.dart` | GENIE.AI configuration loader |
| `fallback_localizations.dart` | Fallback localization delegates |
| `sse_parser.dart` | Server-Sent Events (SSE) stream parser |

---

## Configuration (`lib/config/`)

| File | Description |
|------|-------------|
| `keycloak_config.dart` | Keycloak OIDC client configuration |
| `dev_config.dart` | Development environment configuration |
| `staging_config.dart` | Staging environment configuration |
| `e2e_config.dart` | E2E testing configuration |
| `flavors/itu.dart` | ITU flavor-specific configuration |
| `flavors/template.dart` | Flavor configuration template |

---

## Providers (`lib/providers/`)

| File | Description |
|------|-------------|
| `api_providers.dart` | Riverpod providers for API clients |

---

## Utilities (`lib/utils/`)

| File | Description |
|------|-------------|
| `theme_manager.dart` | Theme switching and persistence |
| `chart_theme_utils.dart` | Chart theme utilities (for analytics charts) |
| `dialog_theme_utils.dart` | Dialog theme utilities |

---

## Internationalization (`lib/i18n/locales/`)

Supported languages (13 locales):

| Locale | Language | File |
|--------|----------|------|
| `en` | English | `en.dart` |
| `ar` | Arabic | `ar.dart` |
| `bn` | Bengali | `bn.dart` |
| `de` | German | `de.dart` |
| `es` | Spanish | `es.dart` |
| `fr` | French | `fr.dart` |
| `id` | Indonesian | `id.dart` |
| `man` | Mandarin Chinese | `man.dart` |
| `pt` | Portuguese | `pt.dart` |
| `ru` | Russian | `ru.dart` |
| `st` | Sesotho | `st.dart` |
| `sw` | Swahili | `sw.dart` |
| `th` | Thai | `th.dart` |
| `zh` | Chinese | `zh.dart` |

---

## Component Organization

```
lib/
├── main.dart                       # App entry point
├── src/                            # App structure
│   ├── app.dart                    # Root widget
│   ├── sample_feature/             # Sample feature (template code)
│   ├── settings/                   # Settings (legacy)
│   └── localization/               # Localization delegates
├── components/                     # UI components (14)
│   ├── auth/                       # Authentication (1)
│   ├── chat/                       # Chat interface (6)
│   ├── sidebar/                    # Sidebar (3)
│   ├── user/                       # User profile (1)
│   ├── settings/                   # Settings (2)
│   └── shared/                     # Shared UI (3)
├── design_system/                  # Design system (11)
│   ├── components/                 # DS primitives (6)
│   ├── tokens/                     # Design tokens (4)
│   └── theme/                      # App theme (1)
├── services/                       # Business logic (20)
│   ├── auth/                       # Auth services (10)
│   ├── keycloak/                   # Keycloak wrapper (1)
│   └── [other services]            # Other services (9)
├── config/                         # Configuration (5)
│   └── flavors/                    # Flavor configs (2)
├── providers/                      # Riverpod providers (1)
├── utils/                          # Utilities (3)
└── i18n/                           # Internationalization
    └── locales/                    # Translation files (13)
```

---

## Notes

- **State Management**: Riverpod (provider-based)
- **Authentication**: Keycloak OIDC with secure token storage
- **Networking**: Custom HTTP client with interceptors and SSE support
- **i18n**: 13 language locales with fallback support
- **Design System**: Token-based with DS components and utilities
- **Flavors**: Multi-environment configuration (dev, staging, prod)
- **Platform Support**: Web, Android, iOS (conditional file utilities)
