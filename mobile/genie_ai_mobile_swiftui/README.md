# GenieAI SwiftUI

SwiftUI implementation of the GenieAI mobile application, mirroring the Flutter app architecture.

## Requirements

- iOS 17.0+
- Xcode 15.0+
- Swift 5.9+

## Project Structure

```
GenieAI/
├── GenieAIApp.swift              # App entry point
├── ContentView.swift             # Main navigation container
│
├── Models/                       # Data models
│   ├── User.swift
│   ├── Message.swift
│   ├── Conversation.swift
│   ├── Folder.swift
│   ├── ServiceCategory.swift
│   └── QuickHelpButton.swift
│
├── Services/                     # API and business logic
│   ├── APIService.swift          # Base HTTP client
│   ├── AuthService.swift         # Authentication
│   ├── UserService.swift         # User management
│   ├── ChatService.swift         # Chat operations
│   ├── ChatHistoryService.swift  # Conversations/folders
│   ├── ServiceTreeService.swift  # Service categories
│   ├── ConnectivityService.swift # Network monitoring
│   ├── I18nService.swift         # Internationalization
│   ├── ThemeManager.swift        # Theme configuration
│   └── ConfigService.swift       # App configuration
│
├── Views/
│   ├── Auth/                     # Authentication views
│   │   ├── LoginView.swift
│   │   ├── RegisterView.swift
│   │   ├── PasswordResetView.swift
│   │   ├── PasswordResetConfirmView.swift
│   │   └── RegistrationSuccessView.swift
│   │
│   ├── Chat/                     # Chat interface
│   │   ├── ChatView.swift
│   │   ├── MessageBubble.swift
│   │   ├── ChatInputView.swift
│   │   ├── QuickHelpGrid.swift
│   │   └── FeedbackSheet.swift
│   │
│   ├── Sidebar/                  # Sidebar components
│   │   ├── LeftSidebarView.swift
│   │   ├── ServiceTreeView.swift
│   │   ├── ChatHistoryView.swift
│   │   └── RightSidebarView.swift
│   │
│   ├── Profile/
│   │   └── UserProfileView.swift
│   │
│   ├── Settings/
│   │   ├── SettingsView.swift
│   │   └── AboutView.swift
│   │
│   └── Shared/                   # Reusable components
│       ├── NavBarView.swift
│       ├── LanguageSelector.swift
│       ├── LoadingView.swift
│       └── ConfirmDialog.swift
│
├── Localization/                 # Translation dictionaries
│   ├── en.swift
│   ├── ar.swift (Arabic)
│   ├── de.swift (German)
│   ├── es.swift (Spanish)
│   ├── fr.swift (French)
│   ├── id.swift (Indonesian)
│   ├── pt.swift (Portuguese)
│   ├── ru.swift (Russian)
│   ├── sw.swift (Swahili)
│   ├── th.swift (Thai)
│   └── zh.swift (Chinese)
│
├── Extensions/
│   ├── Color+Hex.swift           # Hex color initialization
│   ├── String+SHA256.swift       # Password hashing
│   └── View+Conditional.swift    # Conditional modifiers
│
└── Resources/
    ├── Assets.xcassets/
    └── genie-ai-config.json
```

## Architecture

### State Management (iOS 17+)

- Uses `@Observable` macro for all service classes (replaces ObservableObject)
- `@State` for view-owned observable instances
- `@Environment` for app-wide services (Theme, I18n, Auth)
- Properties are automatically observed without `@Published`

### Services

| Service | Description |
|---------|-------------|
| `APIService` | Actor-based HTTP client with async/await |
| `AuthService` | Login, registration, token management |
| `ChatService` | Query submission and feedback |
| `ChatHistoryService` | Conversations and folders |
| `ServiceTreeService` | Service categories |
| `ConnectivityService` | Network monitoring with NWPathMonitor |
| `I18nService` | Internationalization with dictionary-based translations |
| `ThemeManager` | Theme switching and color management |
| `ConfigService` | App configuration from JSON |

### Navigation

- `NavigationStack` with `NavigationPath` for programmatic navigation
- Sheet presentations for modals
- Responsive layout with `GeometryReader` for width-based sidebars

### Persistence

- Keychain for tokens (Security framework)
- UserDefaults for preferences
- `@AppStorage` for SwiftUI bindings

## Building

1. Open `GenieAI.xcodeproj` in Xcode 15+
2. Select your target device or simulator
3. Build and run (⌘R)

## API Configuration

The app connects to `https://genie-ai.itu.int/api` by default. To change this, modify the `baseURL` in `APIService.swift`.

## Theme Configuration

Theme colors are loaded from `genie-ai-config.json` at startup:

```json
{
  "theme": {
    "primaryColor": "#4682B4",
    "secondaryColor": "#5F9EA0",
    "backgroundColor": "#D3E0EA",
    "textColor": "#1C2526",
    "navbar": {
      "gradientStart": "#4682B4",
      "gradientEnd": "#5F9EA0",
      "textColor": "#F0F8FF"
    }
  }
}
```

## Translations

The app supports 11 languages via dictionary-based translations. To add a new translation:

1. Create a new `xx.swift` file in `Localization/`
2. Add the locale struct following the pattern of `en.swift`
3. Register the locale in `I18nService.getTranslations(for:)`
4. Add the language to `supportedLanguages` in `I18nService`

## Multi-Platform Development

This project is part of a coordinated multi-platform development effort:
- **Flutter** (reference implementation)
- **SwiftUI** (this repository)
- **Jetpack Compose** (Android)

The component architecture mirrors the Flutter implementation to ensure consistency across platforms.
