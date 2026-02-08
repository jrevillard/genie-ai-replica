# CLAUDE.md — Jetpack Compose (GenieAI)

This file provides guidance to Claude Code when working with this Jetpack Compose Android project.

## Build & Development Commands

```bash
# Debug build
./gradlew assembleDebug

# Install on connected device/emulator
./gradlew installDebug

# Release build
./gradlew assembleRelease

# Run lint/analysis
./gradlew lint

# Run tests
./gradlew test
./gradlew connectedAndroidTest  # Instrumented tests

# Clean
./gradlew clean
```

## Architecture Overview

### Tech Stack
- **Kotlin** + **Jetpack Compose** (Material3 with custom theme)
- **State Management**: ViewModel + StateFlow + `collectAsState()`
- **Navigation**: Compose Navigation (`NavHost`)
- **HTTP**: OkHttp3 + Gson (lightweight, matching Flutter's `http` package)
- **DI**: Manual singletons via `object` declarations (matching Flutter pattern)
- **Security**: `java.security.MessageDigest` for SHA-256
- **Local storage**: SharedPreferences
- **i18n**: Android string resources (`strings.xml` per locale, 11 languages)
- **Min SDK**: 26 (Android 8.0), Target SDK: 35

### State Management
Singleton repositories with `object` keyword. ViewModels expose `StateFlow<UiState>`. Components use `collectAsState()`.

```kotlin
// In ViewModel
private val _uiState = MutableStateFlow(SomeUiState())
val uiState: StateFlow<SomeUiState> = _uiState.asStateFlow()

// In Composable
val uiState by viewModel.uiState.collectAsState()
```

### Project Structure
```
app/src/main/java/com/genieai/mobile/
├── GenieAIApplication.kt          # Application class
├── MainActivity.kt                 # Single activity
├── ui/
│   ├── theme/                     # Design system (Color, Type, Shape, Glass, Theme)
│   ├── navigation/AppNavigation.kt
│   ├── screens/
│   │   ├── auth/                  # Login, Register, Password Reset
│   │   ├── chat/                  # ChatScreen, MessageBubble, ChatInputBar, QuickHelpGrid
│   │   ├── sidebar/               # ChatHistorySheet, ServiceTreeSheet, InfoResourcesSheet
│   │   ├── profile/UserProfileScreen.kt
│   │   ├── settings/              # SettingsScreen, AboutScreen
│   │   └── main/MainScreen.kt    # Responsive layout container
│   └── components/                # ConfirmDialog, LanguageSelector, LoadingIndicator
├── data/
│   ├── model/                     # User, Conversation, Message, Folder, etc.
│   ├── remote/ApiService.kt       # OkHttp singleton
│   └── repository/                # Auth, Chat, ChatHistory, User, ServiceTree repos
├── service/                       # ConfigService, ConnectivityService
├── viewmodel/                     # Auth, Chat, ChatHistory, ServiceTree, Settings, Profile, Theme
└── util/                          # SHA256, FlexibleDateParser
```

### Routing
Compose Navigation with `NavHost`:
- `login` → LoginScreen
- `register` → RegisterScreen
- `registration-success/{email}` → RegistrationSuccessScreen
- `password-reset` → PasswordResetScreen
- `password-reset-confirm` → PasswordResetConfirmScreen
- `main` → MainScreen (chat + toolbar)
- `profile` → UserProfileScreen
- `settings` → SettingsScreen
- `about` → AboutScreen

### Responsive Design
- **Mobile**: TopAppBar with toolbar buttons opening `ModalBottomSheet` panels
- **Wide screens (tablets)**: Can be extended to 3-column layout using `WindowSizeClass`

## Design System — "Frosted Glass"

Android adaptation of SwiftUI's Liquid Glass aesthetic:

- **Brand colors**: `#4682B4` (Primary Blue), `#5F9EA0` (Secondary Teal) — from `genie-ai-config.json`
- **Glass modifiers**: `Modifier.glassCard()`, `Modifier.glassCardElevated()` — translucent surface + subtle border + shadow
- **Chat bubbles**: User = `primaryColor.opacity(0.12f)` border; Bot = glass surface
- **CategoryPalette**: 12 deterministic candy pastel colors for service badges
- **Animations**: Spring-based via `animateFloatAsState(spring())` — toggle in Settings
- **Haptics**: `HapticFeedbackType.LongPress` on interactive elements — toggle in Settings
- **Typography**: `FontFamily.SansSerif` with rounded shapes

## API Integration

Base URL: `https://genie-ai.itu.int/api`

Key endpoints:
- **Auth**: `auth/login` (`encPassword`), `auth/logout`, `auth/me`, `auth/register` (`encPassword`), `auth/password-reset`, `auth/reset-password/confirm` (`newPassword`)
- **Queries**: `POST queries` (submit chat query with `context` object), `POST queries/{queryId}/feedback`
- **Chat History**: `chat/conversations` (CRUD), `chat/conversations/{id}/messages` (uses `sender` not `role`), `chat/folders` (CRUD), `chat/folders/{folderId}/conversations/{conversationId}`
- **Services**: `services/categories`, `services/categories/{id}/services`, `services/search`
- **Users**: `GET/PUT users/{id}` (profile + settings), `PUT users/email`, `POST users/reset-data`, `POST users/delete`, `POST users/deactivate`

**Important API conventions:**
- Password hashing: SHA-256 on client before transmission (field: `encPassword`)
- ArangoDB IDs: backend returns `_key`, `_id` (with collection prefix), `id` — always check `_key` first
- Timestamp fields: conversations/folders use `created`/`updated`, users use `createdAt`/`updatedAt`
- Messages: backend uses `sender` ("user"|"assistant"), app UI uses `role` — map at repository layer
- See `../genie_ai_mobile_product/API.md` for full API specification

## Translations

11 languages via Android string resources:
- English (default), Arabic (RTL), German, Spanish, French
- Indonesian, Portuguese, Russian, Swahili, Thai, Chinese (Simplified)

```kotlin
// In Composable
stringResource(R.string.login_button)
stringResource(R.string.register_verification_sent, email)  // with args
```

## Configuration

Theme and app settings loaded from `res/raw/genie_ai_config.json` at startup via `ConfigService.init()` (called in `GenieAIApplication.onCreate()`). Includes primary/secondary colors, navbar gradients, quick help buttons, welcome message.

### Dynamic i18n Key Resolution

The config file stores **translation keys** (e.g. `quickhelp.justChat`) rather than literal text for quick help button labels, user prompts, and system prompts. `ConfigService.resolveI18nKey()` converts these dotted camelCase keys to Android resource names at runtime:

```
quickhelp.justChat → quickhelp_just_chat → R.string.quickhelp_just_chat
quickhelp.applyForIDUserPrompt → quickhelp_apply_for_id_user_prompt → R.string.quickhelp_apply_for_id_user_prompt
```

When adding new config-driven strings, add the corresponding `<string name="...">` entry to all 11 `strings.xml` files.

## Multi-Platform Development

**PRD Location**: `../genie_ai_mobile_product/PRD.md`

This project is part of a coordinated multi-platform development effort:
- **Flutter** (`../genie_ai_mobile`) — Reference implementation
- **SwiftUI** (`../genie_ai_swiftui/`) — iOS implementation
- **Jetpack Compose** (this repository) — Android implementation

**PRD Comment Format**:
```markdown
### 1.1 Login
<!-- Flutter: lib/components/auth/login_screen.dart -->
<!-- SwiftUI: GenieAI/Views/Auth/LoginView.swift -->
<!-- Compose: app/src/main/java/com/genieai/mobile/ui/screens/auth/LoginScreen.kt -->
```

**When to Update PRD**: When creating, renaming, or deleting components that implement PRD requirements, update the `<!-- Compose: ... -->` comment.

## Key Data Flows

### Service Tree (Knowledge Areas) → Chat Context
1. `ServiceTreeSheet` shows categories with expandable children (services)
2. Services have multi-select with checkmarks — tracked as `List<ServiceSelection>` in `ServiceTreeViewModel`
3. On dismiss/Done: `onSelectionApplied(categoryId, contextLabels)` → `ChatViewModel.setCategory()`
4. `setCategory()` sets `selectedCategoryId`, `selectedCategoryName`, and `contextLabels`
5. Chat query sends `categoryId` at top level AND in `context` object, `contextLabels` as `context.labels`

### Feedback Submission
1. `MessageBubble` shows thumbs up/down → opens `FeedbackDialog`
2. `FeedbackDialog` collects star rating + comment
3. Callback: `onFeedbackSubmit(queryId, rating, comment)` → `ChatViewModel.submitFeedback()`
4. API: `POST queries/{queryId}/feedback` with `{ rating, comment }`

### Language
- Chat queries use `Locale.getDefault().language` — NOT hardcoded "en"
- Service tree loads with locale parameter
- All UI strings via Android string resources (11 languages)

## Critical Notes

1. **API Service is a Kotlin `object`** — true singleton, no DI framework needed
2. **Config loaded from raw resources** — not assets (Android Compose standard); initialized in `GenieAIApplication.onCreate()` so it's ready before any screen composes
3. **Password is SHA-256 hashed** on client before sending to API
4. **SharedPreferences** for remembered credentials and settings
5. **Proguard rules** protect Gson models and OkHttp from obfuscation
6. **Category ID field names vary**: `catKey` → `_key` → `key` → `id` — repositories have fallback chains
7. **Category name field names vary**: `nameEN` → `name` → `label` — repositories have fallback chains
8. **ViewModel scoping**: Each `composable()` in NavHost creates its own ViewModel scope. `AuthViewModel` is re-hydrated in MainScreen via `fetchCurrentUser()` (calls `GET /auth/me`) since the LOGIN backstack entry is destroyed on navigation. The token persists in the `ApiService` singleton.
9. **`GET /auth/me` response** wraps user fields in a `"user"` key (same as login) — parse via `body.getAsJsonObject("user")`
