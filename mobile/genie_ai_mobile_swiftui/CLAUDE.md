# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
# Open project in Xcode
open GenieAI.xcodeproj

# Build from command line
xcodebuild -project GenieAI.xcodeproj -scheme GenieAI -destination 'platform=iOS Simulator,name=iPhone 15' build

# Run tests
xcodebuild test -project GenieAI.xcodeproj -scheme GenieAI -destination 'platform=iOS Simulator,name=iPhone 15'

# Clean build folder
xcodebuild clean -project GenieAI.xcodeproj -scheme GenieAI
```

## Architecture Overview

### State Management (iOS 17+)
Uses `@Observable` macro for all service classes (replaces ObservableObject):
- **ThemeManager** - Theme switching, loads config from `genie-ai-config.json`
- **AppLocaleService** - Runtime language switching, locale/bundle management (String Catalogs via `Localizable.xcstrings`)
- **ConnectivityService** - Network monitoring with NWPathMonitor
- **AuthService** - Authentication with Keychain token storage
- **APIService** - Actor-based HTTP client with async/await

Services are injected via `@Environment`. Properties are automatically observed without `@Published`.

### Project Structure
```
GenieAI/
├── GenieAIApp.swift           # App entry point
├── ContentView.swift          # Main navigation container
├── Models/                    # Data models (Codable)
│   ├── User.swift
│   ├── Message.swift
│   ├── Conversation.swift
│   ├── Folder.swift
│   ├── ServiceCategory.swift
│   └── QuickHelpButton.swift
├── Services/                  # Business logic & API
│   ├── APIService.swift       # Base HTTP client (Actor)
│   ├── AuthService.swift      # Authentication
│   ├── ChatService.swift      # Chat queries
│   ├── ChatHistoryService.swift
│   └── ...
├── Views/
│   ├── Auth/                  # Login, register, password reset
│   ├── Chat/                  # Chat interface
│   ├── Sidebar/               # Left/right sidebar panels
│   ├── Profile/               # User profile
│   ├── Settings/              # Settings screens
│   └── Shared/                # Reusable components
├── Localizable.xcstrings      # String Catalog (11 languages)
├── Extensions/                # Swift extensions
└── Resources/
    ├── Assets.xcassets/
    └── genie-ai-config.json
```

### Navigation
- `NavigationStack` with `NavigationPath` for programmatic navigation
- Sheet presentations for modals
- Responsive layout using `GeometryReader` for width-based sidebars

### Responsive Design
- Wide screens (≥1200px): 3-column layout (Sidebar | Chat | RightPanel)
- Narrow screens: Drawer-based sidebars with overlay

## Critical Build Notes

1. **iOS 17.0 minimum** - Required for `@Observable` macro
2. **Keychain for tokens** - Uses Security framework for secure storage
3. **CryptoKit for hashing** - SHA256 password hashing via `String.sha256` extension
4. **API endpoint** - Configured in `APIService.swift` (`genie-ai.itu.int`)

## Translations

Uses Apple String Catalogs (`Localizable.xcstrings`) with 11 languages.

```swift
// In SwiftUI views — auto-localized via .environment(\.locale, appLocale.locale)
Text("Welcome! How can I assist you today?")
Button("Save") { ... }

// In non-view code — use String(localized:)
let text = String(localized: "No preview available")

// With arguments — use string interpolation
Text(String(localized: "A verification email has been sent to \(email)"))

// Dynamic keys (QuickHelpButton) — use NSLocalizedString + localizedBundle
NSLocalizedString(key, bundle: AppLocaleService.shared.localizedBundle, comment: "")
```

## Configuration

Theme and app settings loaded from `Resources/genie-ai-config.json` at startup via `ConfigService`. Includes primary/secondary colors, navbar gradients, app title.

## Multi-Platform Development

**PRD Location**: `../genie_ai_mobile_product/PRD.md`

This project is part of a coordinated multi-platform development effort. The same app is being developed for:
- **Flutter** (reference implementation at `../genie_ai_mobile`)
- **SwiftUI** (this repository)
- **Jetpack Compose** (planned)

**Development Approach**:
- The Flutter implementation serves as the reference for SwiftUI and Jetpack Compose
- Component architecture must be as similar as possible across all platforms
- Platform-specific best practices for architecture and UX should still be followed
- The PRD contains comments tracking which components implement each requirement

**PRD Maintenance Requirements**:
- The PRD must exist at the specified path: `../genie_ai_mobile_product/PRD.md`
- Requirements in the PRD must include HTML comments indicating which components implement them (for cross-platform traceability)
- **IMPORTANT: When creating, renaming, or deleting components/files that implement PRD requirements, you MUST update the corresponding comment in the PRD**

**PRD Comment Format**:
```markdown
### 1.1 Login
<!-- Flutter: lib/components/auth/login_screen.dart, lib/services/user_service.dart -->
<!-- SwiftUI: GenieAI/Views/Auth/LoginView.swift, GenieAI/Services/AuthService.swift -->
```

**When to Update PRD**:
1. Creating a new component that implements a PRD requirement → Add the file path to the SwiftUI comment
2. Renaming a component file → Update the path in the SwiftUI comment
3. Deleting a component → Remove the path from the SwiftUI comment
4. Refactoring components (splitting/merging) → Update all affected paths

**PRD Update Process**:
1. Identify which PRD section(s) the component implements
2. Read the current PRD to find the section
3. Update the `<!-- SwiftUI: ... -->` comment with the correct file path(s)
4. Ensure multiple files are comma-separated within the comment

## SwiftUI-Specific Patterns

### Environment Injection
```swift
// In App
ContentView()
    .environment(themeManager)
    .environment(appLocale)
    .environment(authService)
    .environment(\.locale, appLocale.locale)

// In Views
@Environment(ThemeManager.self) private var theme
@Environment(AppLocaleService.self) private var appLocale  // only where needed
```

### Service Initialization
```swift
// Observable services with @Observable macro
@Observable
class MyService {
    private(set) var data: [Item] = []
    private(set) var isLoading = false

    func load() async throws {
        isLoading = true
        defer { isLoading = false }
        // ...
    }
}
```

### Async API Calls
```swift
// Actor-based APIService
let data = try await APIService.shared.get("endpoint")
let decoded = try JSONDecoder().decode(Response.self, from: data)
```
