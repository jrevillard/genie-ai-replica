---
title: "UI Component Inventory (mobile)"
description: "Annotated map of the Flutter mobile app: components, design system, services, providers, and i18n locales."
weight: 1
section: "mobile"
mode: reference
persona: developer
owner: "docs-stewards"
last_reviewed: 2026-09-18
---

## Overview

Reference map of every Dart file under `mobile/genie_ai_mobile/lib/`. Counts are pulled from a snapshot of the source tree and are correct as of the audit date — when adding or removing files, regenerate the snapshot rather than editing the numbers by hand.

For architectural concerns (how the layers compose, what each service is responsible for at the wire level), see [Mobile Architecture](/docs/mobile/mobile-architecture/). For end-user-facing flows, see [User Authentication](/docs/mobile/user-authentication/) and [Chat Pipeline](/docs/mobile/chat-pipeline/).

## Snapshot

| Bucket | Count | Where |
|--------|------:|-------|
| Dart files (whole `lib/`) | **80** | `mobile/genie_ai_mobile/lib/**/*.dart` |
| UI components (`lib/components/`) | **16** | `chat=6, sidebar=3, auth=1, user=1, settings=2, shared=3` |
| Design system primitives (`lib/design_system/components/`) | **6** | `ds_button, ds_card, ds_input, ds_modal, ds_spinner, ds_state_display` |
| Design tokens (`lib/design_system/tokens/`) | **4** | `app_tokens, color_utils, spacing, radii` |
| Services (`lib/services/`) | **18** | `auth/` = 10, `keycloak/` = 1, top-level = 7 |
| Configuration (`lib/config/`) | **6** | root = 4, `flavors/` = 2 |
| Riverpod providers (`lib/providers/`) | **1** | `api_providers.dart` |
| Utilities (`lib/utils/`) | **4** | `theme_manager, chart_theme_utils, dialog_theme_utils, config_resolver` |
| i18n locales (`lib/i18n/locales/`) | **14** | see [Locales](#locales) below |

> "Services = 18" is the count of `*.dart` files in `lib/services/`. The auth subdirectory contains 10 files (`app_auth, auth_interceptor, auth_logger, auth_notifier, auth_state, auth_providers, token_storage, connectivity_checker, network_error_classifier, insecure_http_client`). The keycloak subdirectory contains 1 (`keycloak_service`). The 7 top-level services are `connectivity_service, fallback_localizations, genie_ai_config, i18n_service, notification_service, sse_parser, user_service`.

## Design system

### Primitives (`lib/design_system/components/`)

| Component | Description |
|-----------|-------------|
| `ds_button.dart` | Button with variants: `primary`, `secondary`, `ghost`, `danger` |
| `ds_card.dart` | Container with elevation and border radius |
| `ds_input.dart` | Text field with label, validation states, error message slot |
| `ds_modal.dart` | Modal dialog overlay with content slot |
| `ds_spinner.dart` | Circular progress indicator |
| `ds_state_display.dart` | Empty / error / loading state presenter |

### Tokens (`lib/design_system/tokens/`)

| Token | Description |
|-------|-------------|
| `app_tokens.dart` | Global typography + color tokens |
| `color_utils.dart` | Lighten / darken / opacity / theme mapping |
| `spacing.dart` | Spacing scale constants (`xs`, `sm`, `md`, `lg`, `xl`) |
| `radii.dart` | Border radius tokens (`sm`, `md`, `lg`, `xl`, `full`) |

### Theme (`lib/design_system/theme/`)

| File | Description |
|------|-------------|
| `app_theme.dart` | Material theme configuration (light + dark color schemes) |

## Chat components (`lib/components/chat/`)

| File | Description |
|------|-------------|
| `chatbot_component.dart` | Main chat interface — message list, input, feedback, SSE stream handler, Quick Help overlay, PDF export. The single largest widget in the app (~67 KB). |
| `right_sidebar_component.dart` | Related Documents sidebar — MIME-iconed cards, external launch |
| `chat_response_feedback_dialog.dart` | Per-message feedback dialog (thumbs → star rating → free text → skin-tone selector) |
| `right_sidebar_stub.dart` | Conditional compilation stub for platforms where the right sidebar is not rendered |
| `web_file_utils.dart` | Browser-side file save helpers (used by PDF export on web) |
| `stub_file_utils.dart` | Native fallback stub (no-ops on non-web platforms) |

## Sidebar components (`lib/components/sidebar/`)

| File | Description |
|------|-------------|
| `sidebar_component.dart` | Left sidebar with conversation history and services tabs |
| `chat_folders_panel.dart` | Conversation folders — All / Starred / Archived tabs, CRUD operations |
| `service_tree_panel.dart` | Hierarchical service-category tree with multi-select |

## Auth components (`lib/components/auth/`)

| File | Description |
|------|-------------|
| `oidc_login_screen.dart` | OIDC login screen with branding, error display, retry mechanism |

## User components (`lib/components/user/`)

| File | Description |
|------|-------------|
| `user_profile_component.dart` | User profile form (personal info, preferences, country, ID docs) |

## Settings components (`lib/components/settings/`)

| File | Description |
|------|-------------|
| `settings_component.dart` | Theme, language, notifications, account management (~26 KB) |
| `about_screen.dart` | App version, build info, OSS licenses |

## Shared components (`lib/components/shared/`)

| File | Description |
|------|-------------|
| `nav_bar_component.dart` | Bottom navigation bar |
| `confirm_dialog.dart` | Generic confirm / cancel dialog |
| `language_selector.dart` | Language picker (writes locale to `i18n_service`) |

## App structure (`lib/src/`)

| File | Description |
|------|-------------|
| `app.dart` | Root widget with router and global providers |
| `localization/` | Localization delegates (`flutter_localizations` glue) |
| `sample_feature/` | Flutter template leftover; **unused at runtime** — safe to delete |
| `settings/` | Legacy settings controller; **unused at runtime** — safe to delete |

> `sample_feature/` and `settings/` under `lib/src/` are Flutter project-template artefacts. They are not referenced from `main.dart` or any provider. They inflate the file count but contribute no production behaviour.

## Services

### Authentication (`lib/services/auth/`)

| File | Purpose |
|------|---------|
| `app_auth.dart` | Thin flutter_appauth wrapper |
| `auth_interceptor.dart` | `BaseClient` that injects Bearer tokens and handles 401 → refresh → retry |
| `auth_logger.dart` | Structured event logger (talker-backed) |
| `auth_notifier.dart` | Auth state machine — `init`, `authorize`, `refreshTokens`, `validateTokens`, `logout` |
| `auth_state.dart` | Sealed `AuthState` (`Authenticated` / `Unauthenticated` / `Error`) |
| `auth_providers.dart` | Riverpod provider wiring for the above |
| `token_storage.dart` | `flutter_secure_storage`-backed token persistence |
| `connectivity_checker.dart` | Network state read used by `NetworkErrorClassifier` |
| `network_error_classifier.dart` | Classifies HTTP errors into retryable vs terminal |
| `insecure_http_client.dart` | Dev-only HTTP client that bypasses TLS validation |

### Keycloak (`lib/services/keycloak/`)

| File | Purpose |
|------|---------|
| `keycloak_service.dart` | OIDC discovery + authorize / token / end_session endpoints |

### Top-level (`lib/services/`)

| File | Purpose |
|------|---------|
| `connectivity_service.dart` | Reactive online/offline state driving the offline banner. **Differs from** `connectivity_checker.dart` (which is the per-request classifier hook used by `NetworkErrorClassifier`). |
| `user_service.dart` | User profile operations against `/api/me` |
| `i18n_service.dart` | Locale selection + translation lookups |
| `notification_service.dart` | In-app toast / event bus (success/error/info/warning broadcast over StreamController). No push notification integration is currently wired. |
| `genie_ai_config.dart` | Reads `assets/config/genie-ai-config.json` at startup |
| `fallback_localizations.dart` | English fallback for missing translation keys |
| `sse_parser.dart` | SSE stream → typed `SseEvent` objects (chunk / metadata / translation / done / error) |

## Configuration (`lib/config/`)

| File | Purpose |
|------|---------|
| `keycloak_config.dart` | `KeycloakConfig` schema + `getConfig()` flavor switch + `allSupportedLocaleCodes` |
| `dev_config.dart` | Development flavor |
| `staging_config.dart` | Staging flavor |
| `e2e_config.dart` | E2E test flavor |
| `flavors/itu.dart` | ITU production flavor |
| `flavors/template.dart` | Template to copy for new institutional flavors |

## Providers (`lib/providers/`)

| File | Purpose |
|------|---------|
| `api_providers.dart` | Riverpod providers for backend API clients (one per OpenAPI domain) |

## Utilities (`lib/utils/`)

| File | Purpose |
|------|---------|
| `theme_manager.dart` | Theme switching + persistence |
| `chart_theme_utils.dart` | Chart theme helpers for the analytics view |
| `dialog_theme_utils.dart` | Dialog theme helpers |
| `config_resolver.dart` | Resolves flavor-specific runtime overrides |

## Locales

`lib/i18n/locales/` ships 14 locale files, matched by `allSupportedLocaleCodes` in `lib/config/keycloak_config.dart`:

| Locale | Language | File |
|--------|----------|------|
| `en` | English | `en.dart` |
| `ar` | Arabic | `ar.dart` |
| `bn` | Bengali | `bn.dart` |
| `de` | German | `de.dart` |
| `es` | Spanish | `es.dart` |
| `fr` | French | `fr.dart` |
| `id` | Indonesian | `id.dart` |
| `man` | Mandarin (Pinyin) | `man.dart` |
| `pt` | Portuguese | `pt.dart` |
| `ru` | Russian | `ru.dart` |
| `st` | Sesotho | `st.dart` |
| `sw` | Swahili | `sw.dart` |
| `th` | Thai | `th.dart` |
| `zh` | Chinese (Simplified) | `zh.dart` |

> Deployment-level locale whitelist is **config-driven**. All 14 files stay in the source; a flavor restricts the active set via `KeycloakConfig.supportedLocaleCodes` (see [Mobile Deployment Guide](/docs/mobile/mobile-deployment-guide/) §4).

## Tree

```
mobile/genie_ai_mobile/lib/
├── main.dart                         # App entry point (MyApp root)
├── src/                              # App composition root
│   ├── app.dart                      # Router + theme + locale wiring
│   ├── localization/                 # Flutter localization delegates
│   ├── sample_feature/               # Flutter template (unused at runtime)
│   └── settings/                     # Legacy settings controller (unused)
├── components/                       # UI components (16)
│   ├── auth/                         # Authentication (1)
│   ├── chat/                         # Chat interface (6)
│   ├── sidebar/                      # Sidebar (3)
│   ├── user/                         # User profile (1)
│   ├── settings/                     # Settings (2)
│   └── shared/                       # Shared UI (3)
├── design_system/                    # Design system (11)
│   ├── components/                   # DS primitives (6)
│   ├── tokens/                       # Design tokens (4)
│   └── theme/                        # App theme (1)
├── services/                         # Business logic (18)
│   ├── auth/                         # Auth services (10)
│   ├── keycloak/                     # Keycloak wrapper (1)
│   └── [top-level services]           # (7)
├── config/                           # Configuration (6)
│   └── flavors/                      # Flavor configs (2)
├── providers/                        # Riverpod providers (1)
├── utils/                            # Utilities (4)
└── i18n/                             # Internationalization
    └── locales/                      # Translation files (14)
```

## Related

- [Mobile Architecture](/docs/mobile/mobile-architecture/) — how the layers compose; auth and SSE at the wire level.
- [User Authentication](/docs/mobile/user-authentication/) — user-visible auth flow (PKCE, refresh, logout, error states).
- [Chat Pipeline](/docs/mobile/chat-pipeline/) — SSE event flow, feedback dialog, Quick Help, PDF export.
- [Mobile Deployment Guide](/docs/mobile/mobile-deployment-guide/) — flavor creation, Android signing, iOS provisioning.
