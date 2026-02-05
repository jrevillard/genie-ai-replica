# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
# Run on web (fastest for UI development)
flutter run -d chrome

# Run on Android device (USB debugging enabled)
flutter run

# Code analysis
flutter analyze

# Format code
flutter format lib/

# Run tests
flutter test
flutter test test/unit_test.dart  # Single test file

# Release builds (ALWAYS use --no-tree-shake-icons)
flutter build apk --no-tree-shake-icons
flutter build appbundle --no-tree-shake-icons  # For Play Store
flutter build ios --no-tree-shake-icons        # macOS only
```

**Windows builds**: Close VS Code first, then use `.\build-release.ps1` from external terminal to avoid file lock issues.

## Architecture Overview

### State Management
Singleton services with ChangeNotifier pattern (no external state management library):
- **ThemeManager** - Theme switching, loads config from `assets/config/genie-ai-config.json`
- **I18nService** - 11 languages, nested key translations via global `tr()` function
- **ConnectivityService** - Network monitoring with 5-second polling
- **ApiService** - HTTP client with Bearer token management

Services are accessed via factory constructors. Components listen to state changes via AnimatedBuilder.

### Project Structure
```
lib/
├── main.dart              # Entry point
├── components/            # UI components by feature
│   ├── auth/              # Login, register, password reset
│   ├── chat/              # Chat interface
│   ├── sidebar/           # Left/right sidebar panels
│   ├── settings/          # Settings screens
│   ├── user/              # User profile
│   └── shared/            # Reusable components
├── services/              # Business logic & API
│   ├── api_service.dart   # Base HTTP client
│   ├── *_proxy.dart       # API endpoint proxies
│   └── ...
├── utils/                 # Theme utilities
└── i18n/locales/          # Translation files
```

### Routing
Named routes via MaterialApp: `/login`, `/register`, `/registration-success`, `/password-reset`, `/password-reset-confirm`, `/profile`, `/about`

### Responsive Design
- Wide screens (>1200px): 3-column layout (Sidebar | Chat | RightPanel)
- Narrow screens: Drawers + Binder Tabs (10px edge tabs)

## Critical Build Notes

1. **Always use `--no-tree-shake-icons`** - Dynamic icon maps cause build failures without this flag
2. **Asset paths differ between web and mobile** - Use `kIsWeb` check:
   ```dart
   final path = kIsWeb ? 'i18n/en.json' : 'assets/i18n/en.json';
   ```
3. **SSL certificates** - Use domain names, not IP addresses, to match certificate
4. **HTTP traffic** - HTTPS required for production; `android:usesCleartextTraffic="true"` only for debug

## Translations

```dart
import 'package:genie_ai_mobile/services/i18n_service.dart';

// Use global helper
String text = tr('chatbot.welcomeMessage');
String text = tr('key', args: {'name': 'John'});
```

## Configuration

Theme and app settings loaded from `assets/config/genie-ai-config.json` at startup. Includes primary/secondary colors, navbar gradients, app title and icon.

## Multi-Platform Development

**PRD Location**: `../genie_ai_mobile_product/PRD.md`

This project is part of a coordinated multi-platform development effort. The same app is being developed for:
- **Flutter** (this repository)
- **SwiftUI**
- **Jetpack Compose**

**Development Approach**:
- The Flutter implementation serves as the reference for converting to SwiftUI and Jetpack Compose
- Component architecture must be as similar as possible across all platforms
- Platform-specific best practices for architecture and UX should still be followed
- The PRD contains comments tracking which components implement each requirement to coordinate parallel development

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
1. Creating a new component that implements a PRD requirement → Add the file path to the Flutter comment
2. Renaming a component file → Update the path in the Flutter comment
3. Deleting a component → Remove the path from the Flutter comment
4. Refactoring components (splitting/merging) → Update all affected paths

**PRD Update Process**:
1. Identify which PRD section(s) the component implements
2. Read the current PRD to find the section
3. Update the `<!-- Flutter: ... -->` comment with the correct file path(s)
4. Ensure multiple files are comma-separated within the comment
