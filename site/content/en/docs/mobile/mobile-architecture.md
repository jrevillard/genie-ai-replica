---
title: "Mobile Architecture"
description: "Architecture of the GENIE.AI Flutter mobile app: layers, state, and platform integration."
weight: 2
section: "mobile"
---

## Overview
The Flutter mobile app (`genie_ai_mobile`) is a sophisticated AI chat application with OIDC authentication, multi-language support, and responsive design patterns.

## 1. API Layer

### Service & Provider Layer

The app does **not** use a proxy pattern. API access is structured around
Riverpod providers and a thin set of domain services:

- **Riverpod providers** (`lib/providers/api_providers.dart`) — define the API
  calls (chat/query, feedback, user profile, analytics, admin) as providers
  consumed by the UI.
- **Domain services** (`lib/services/`):
  - `user_service.dart` — user profile operations.
  - `connectivity_service.dart` — network connectivity state.
  - `i18n_service.dart` — locale and translation orchestration.
  - `notification_service.dart`, `sse_parser.dart`, `genie_ai_config.dart`,
    `fallback_localizations.dart`.
  - `auth/` and `keycloak/` subdirectories — OIDC auth state, token storage,
    and Keycloak integration.

The flavor-specific base URL comes from the flavor config (see §2).

### Authentication API Integration
- **`AuthInterceptor`** - Automatic Bearer token injection
- **`KeycloakService`** - OIDC endpoint discovery and operations
- **`TokenStorage`** - Secure token persistence

### API Contracts
- **Chat**: `/queries` (POST), `/queries/{id}/feedback` (POST)
- **User**: `/me` (GET/PUT), `/me/reset-data` (POST), `/me/delete` (POST)
- **Auth**: `/auth/logout` (POST)

## 2. Data Models

### Authentication Models
- **`AuthState`** (`/lib/services/auth/auth_state.dart`)
  - Enum: `authenticated | unauthenticated | error`
  - User data: `userId`, `displayName`
  - Error handling: `errorMessage`, `retryable` flag

### Token Models
- **`TokenStorage`** interface (`/lib/services/auth/token_storage.dart`)
  - Secure storage using `flutter_secure_storage`
  - In-memory storage for testing
  - Token lifecycle management

### Configuration Models
- **`KeycloakConfig`** (`/lib/config/keycloak_config.dart`) — base schema + the `getConfig()` flavor switch.
- **Flavor configs** — `lib/config/flavors/` (`itu.dart`, `template.dart`) plus `lib/config/{dev,staging,e2e}_config.dart`; each defines the per-flavor base URL, Keycloak client, and locale set.
  - OIDC endpoint parameters
  - Security settings

### UI Data Models
- **Chat**: Message maps with `List<Map<String, dynamic>>`
- **User**: `Map<String, dynamic>` with nested user data
- **Services**: Service category data structures

## 3. State Management

### Riverpod Architecture
The app uses **Riverpod** for state management:

#### Provider Definitions (`/lib/services/auth/auth_providers.dart`)
- **`tokenStorageProvider`** - Token persistence
- **`authLoggerProvider`** - Authentication logging
- **`keycloakServiceProvider`** - Keycloak service
- **`appAuthProvider`** - Authentication app interface
- **`apiServiceProvider`** - HTTP client with auth
- **`authProvider`** - Main authentication state (NotifierProvider)
- **`connectivityCheckerProvider`** - Network state

#### Authentication State Management (`/lib/services/auth/auth_notifier.dart`)
- **`AuthNotifier`** - Main authentication logic
- Key Features:
  - OIDC authorization flow
  - Token refresh with auto-retry
  - Network-aware error handling
  - Session persistence across app restarts
  - Lifecycle-aware token validation

#### State Features
- **Auto-retry**: Network error recovery
- **Token Expiry**: Automatic refresh before expiration
- **Session Persistence**: Secure token storage
- **Lifecycle Integration**: App resume validation

### Connectivity Management
- **`ConnectivityService`** - Network state monitoring
- **Offline Mode**: User-controllable offline state
- **Auto-sync**: Automatic data sync when online

## 4. UI Component Inventory

### Core Navigation
- **`MyApp`** (`/lib/main.dart`) - Root widget with routing
- **`MainScreen`** - Main dashboard layout
- **`NavBarComponent`** - Top navigation with theme toggle
- **`SidebarComponent`** - Left sidebar with services/history tabs
- **`RightSidebarComponent`** - Related documents sidebar

### Authentication Components
- **`OidcLoginScreen`** (`/lib/components/auth/oidc_login_screen.dart`)
  - OIDC login flow with branding
  - Error handling and retry mechanisms
  - Theme-aware UI

### Chat Components
- **`ChatBotComponent`** (`/lib/components/chat/chatbot_component.dart`)
  - Main chat interface
  - Message history display
  - Markdown rendering
  - Feedback collection
  - Session management

- **`ChatResponseFeedbackDialog`** - Feedback submission dialog
- **`ChatFoldersPanel`** - Chat history organization
- **`RightSidebarComponent`** - Related documents display

### Sidebar Components
- **`ServiceTreePanel`** - Service category navigation
- **`ChatFoldersPanel`** - Conversation history
- **`ServiceTreePanel`** - Service selection interface

### User & Settings Components
- **`UserProfileComponent`** - User profile management
- **`SettingsComponent`** - App settings
- **`AboutScreen`** - About/credits screen
- **`ConfirmDialog`** - Confirmation dialogs

### Shared Components
- **`LanguageSelector`** - Multi-language selection
- **`ThemeManager`** - Theme and color management
- **`NavBarComponent`** - Application navigation

### UI Features
- **Responsive Design**: Adapts to different screen sizes
- **Dark/Light Themes**: Theme switching with persistence
- **Internationalization**: 14 languages supported
- **Offline Mode**: UI state reflects connectivity
- **Markdown Support**: Rich text chat messages

## 5. Architecture Patterns

### Design Patterns
- **Proxy Pattern**: API service proxies for business logic
- **Provider Pattern**: Riverpod for state management
- **Observer Pattern**: Theme and i18n change notifications
- **Factory Pattern**: Flavor-specific configuration

### Key Integrations
- **OIDC Authentication**: Keycloak integration with PKCE
- **Secure Storage**: Encrypted token persistence
- **Network Resilience**: Offline mode with auto-sync
- **Multi-language**: Internationalization with 14 languages
- **Cross-platform**: Android/iOS support

### Security Features
- **Secure Token Storage**: Using `flutter_secure_storage`
- **SSL Pinning**: Custom HTTP client for development
- **Authentication Interceptor**: Automatic Bearer token injection
- **PKCE Flow**: Secure OIDC implementation
- **Session Management**: Token refresh and expiration handling

## 6. Technology Stack

| Category | Technology | Version |
|----------|-----------|---------|
| Language | Dart | 3.10.8+ |
| Framework | Flutter | 3.10.8+ |
| State Management | Riverpod | 3.0.0 |
| Secure Storage | flutter_secure_storage | 8.1.0 |
| HTTP Client | http | 1.6.0 |
| Authentication | flutter_appauth | (local fork) |
| Markdown | flutter_markdown | 0.7.7 |
| PDF | pdf, printing | 3.11.1, 5.13.1 |

This architecture demonstrates a well-structured, production-ready Flutter application with robust authentication, state management, and UI components following modern Flutter development patterns.
