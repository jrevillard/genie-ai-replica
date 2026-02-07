# GENIE.AI Mobile Application

> A Flutter-based mobile application providing an intelligent chatbot interface powered by the GENIE RAG Framework API.

**Author:** ITU (International Telecommunication Union)
**Framework:** Flutter (Dart)
**Target Platforms:** Android, iOS, Web, Windows, macOS, Linux
**Version:** 1.0.0+1
**License:** See project license file

---

## 📢 Note to Developers

**This is a reference implementation/sample application** demonstrating how to build and extend mobile applications that integrate with the GENIE.AI RAG Framework.

### What This App Demonstrates

This mobile app serves as a complete, production-ready example showcasing:

- **Framework Integration** - How to connect a Flutter app to the GENIE.AI RAG backend API
- **Authentication Flow** - Complete user authentication (login, registration, password reset)
- **Chat Interface** - Conversational AI chatbot with markdown rendering and document references
- **Service Discovery** - Hierarchical service tree navigation and category filtering
- **Multi-Language Support** - Internationalization (i18n) architecture for 11 languages
- **Responsive Design** - Adaptive layouts for mobile, tablet, and desktop
- **Offline Capabilities** - Online/offline detection with sync preparation
- **Theme System** - Configuration-driven theming with dark/light mode
- **PDF Export** - Generating and sharing chat conversations as PDF documents
- **File Handling** - Image uploads, document management, and file picker integration

### Extending This App

Developers can use this codebase as a foundation to:

1. **Rebrand & Customize** - Modify colors, logos, and styling via [assets/config/genie-ai-config.json](assets/config/genie-ai-config.json)
2. **Add New Features** - Extend the service layer with new API endpoints in [lib/services/](lib/services/)
3. **Build Custom UI** - Use the component structure in [lib/components/](lib/components/) as patterns for your own screens
4. **Integrate Additional APIs** - Follow the proxy pattern in services for new backend integrations
5. **Adapt for Different Use Cases** - Replace government services content with any knowledge base domain

### Architecture Highlights

- **Clean Separation** - UI components, services, and utilities are organized for maintainability
- **Configuration-Driven** - Theme, Quick Help buttons, and app settings are JSON-configurable
- **Scalable Structure** - Easy to add new languages, services, and features
- **Platform-Agnostic** - Core business logic works across Android, iOS, Web, and desktop

Use this app as a starting point for your own GENIE.AI-powered mobile solution!

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [Development](#development)
- [Building for Release](#building-for-release)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)

---

## Overview

GENIE.AI Mobile is a multi-platform chatbot application that serves as the mobile interface for the ITU GENIE platform. It provides users with an AI-powered conversational interface capable of:

- Answering government and public service questions
- Providing document references and sources
- Supporting multiple languages and regions
- Operating in offline mode with sync capabilities
- Managing user profiles and authentication

The app follows a clean architecture with separated concerns for UI components, services, and utilities.

---

## Features

### Core Functionality
- **AI Chatbot Interface** - Conversational AI powered by RAG (Retrieval-Augmented Generation)
- **Multi-Language Support** - 11 languages: English, German, Arabic, Spanish, French, Indonesian, Portuguese, Russian, Swahili, Thai, Chinese
- **Authentication System** - Login, registration, password reset with email verification
- **Service Categories** - Browse and filter government services by category
- **Chat History** - Persistent conversation history with search capabilities
- **Document Management** - View, download, and share related documents
- **PDF Export** - Generate and export chat conversations as PDFs
- **User Profiles** - Profile management with avatar upload from gallery/camera

### User Experience
- **Dark/Light Theme** - Automatic theme switching with user preference
- **Responsive Design** - Adaptive layouts for mobile, tablet, and desktop
- **Offline Support** - Online/offline detection with visual indicators
- **Quick Help Buttons** - Pre-configured prompts for common tasks
- **Service Tree Navigation** - Hierarchical browsing of government services
- **Binder Tabs** - Collapsible sidebars for chat history and documents

### Technical Features
- **SSL Certificate Handling** - Development-friendly certificate override
- **Connectivity Monitoring** - Real-time network status tracking
- **Configuration-Driven UI** - JSON-based theming and feature toggles
- **Material Design 3** - Modern, accessible UI components

---

## Tech Stack

### Core Framework
| Technology | Version | Description |
|------------|---------|-------------|
| **Flutter** | 3.10.8+ | UI framework for multi-platform development |
| **Dart** | 3.10.8+ | Programming language |
| **Java** | 17 | Required for Android builds (Gradle 8.5+) |
| **Kotlin** | Latest | Android native development |
| **Gradle** | 8.5+ | Android build system |

### Android Platform
- **compileSdk**: 36
- **targetSdk**: 36
- **minSdk**: 21 (Android 5.0 Lollipop)
- **NDK**: 27.0.12077973

### Dependencies

#### Networking & Data
| Package | Version | Purpose |
|---------|---------|---------|
| `http` | ^1.6.0 | HTTP client for API calls |
| `crypto` | ^3.0.3 | Cryptographic hashing |
| `shared_preferences` | ^2.2.2 | Local key-value storage |
| `connectivity_plus` | ^7.0.0 | Network connectivity detection |

#### UI Components
| Package | Version | Purpose |
|---------|---------|---------|
| `flutter_markdown` | ^0.7.7 | Markdown rendering for chat messages |
| `cached_network_image` | ^3.3.1 | Cached image loading |
| `flutter_svg` | ^2.1.0 | SVG image support |
| `url_launcher` | ^6.3.1 | Open URLs in browser/apps |

#### File Handling
| Package | Version | Purpose |
|---------|---------|---------|
| `pdf` | ^3.11.1 | PDF generation |
| `printing` | ^5.13.1 | PDF printing/sharing |
| `path_provider` | ^2.1.4 | File system paths |
| `file_picker` | ^10.3.10 | Document file selection |
| `image_picker` | ^1.1.2 | Image selection from gallery/camera |

#### Utilities
| Package | Version | Purpose |
|---------|---------|---------|
| `country_picker` | ^2.0.26 | Country selection dropdown |
| `package_info_plus` | ^9.0.0 | App version/build info |
| `flutter_launcher_icons` | ^0.14.4 | Generate app icons |

---

## Project Structure

```
lib/
├── main.dart                          # App entry point
├── i18n/                              # Internationalization
│   └── locales/                       # Language files (en, ar, de, es, fr, id, pt, ru, sw, th, zh)
├── components/                        # UI Components
│   ├── auth/                          # Authentication screens
│   │   ├── login_screen.dart
│   │   ├── register_screen.dart
│   │   ├── password_reset_initiate_screen.dart
│   │   ├── password_reset_confirm_screen.dart
│   │   └── registration_success_screen.dart
│   ├── chat/                          # Chat functionality
│   │   ├── chatbot_component.dart     # Main chat interface
│   │   ├── right_sidebar_component.dart
│   │   ├── chat_response_feedback_dialog.dart
│   │   └── web_file_utils.dart        # Web-specific file utilities
│   ├── sidebar/                       # Navigation sidebars
│   │   ├── sidebar_component.dart
│   │   ├── service_tree_panel.dart
│   │   └── chat_folders_panel.dart
│   ├── settings/                      # Settings screens
│   │   └── about_screen.dart
│   ├── user/                          # User profile
│   │   └── user_profile_component.dart
│   └── shared/                        # Shared UI elements
│       ├── nav_bar_component.dart
│       ├── language_selector.dart
│       └── confirm_dialog.dart
├── services/                          # Business logic & API
│   ├── api_service.dart               # Base API client
│   ├── auth_proxy.dart                # Authentication API
│   ├── chatbot_proxy.dart             # Chatbot API
│   ├── chat_history_proxy.dart        # Conversation management
│   ├── user_proxy.dart                # User management
│   ├── user_profile_proxy.dart        # Profile management
│   ├── service_tree_proxy.dart        # Service categories
│   ├── document_file_proxy.dart       # Document access
│   ├── file_proxy.dart                # File uploads
│   ├── admin_dashboard_proxy.dart     # Admin features
│   ├── analytics_proxy.dart           # Analytics
│   ├── label_proxy.dart               # Label management
│   ├── weather_proxy.dart             # Weather data
│   ├── password_proxy.dart            # Password reset
│   ├── notification_service.dart      # Push notifications
│   ├── connectivity_service.dart      # Network monitoring
│   ├── user_service.dart              # User state management
│   ├── i18n_service.dart              # Translation service
│   └── genie_ai_config.dart           # Configuration loader
├── utils/                             # Utilities
│   ├── theme_manager.dart             # Theme management
│   ├── dialog_theme_utils.dart        # Dialog theming
│   └── chart_theme_utils.dart         # Chart theming
└── src/                               # Generated & framework files
    ├── app.dart
    ├── localization/
    ├── sample_feature/
    └── settings/

assets/                                 # Static assets
├── config/
│   ├── genie-ai-config.json          # App configuration
│   └── quickhelp/                    # Quick help icons
├── images/                           # Images and icons
├── icons/                            # Additional icons
├── fonts/                            # Custom fonts (Roboto)
└── FAQ.md                            # FAQ content
```

---

## Prerequisites

### Required Software

| Software | Minimum Version | Notes |
|----------|-----------------|-------|
| **Flutter SDK** | 3.10.8+ | Download from [flutter.dev](https://flutter.dev) |
| **Dart SDK** | 3.10.8+ | Included with Flutter |
| **Git** | Latest | For version control |
| **VS Code** | Latest | Recommended IDE with Flutter/Dart extensions |
| **Android Studio** | Latest | Required for Android SDK & Emulator |
| **Java JDK** | 17 | Required for Android builds (Gradle 8.5+) |

### Optional Software
- **Xcode** (macOS only) - Required for iOS builds
- **Chrome/Edge** - For web development testing

### IDE Setup (VS Code)

Install these extensions:
- Flutter
- Dart
- Flutter Widget Snippets

**Recommended VS Code Settings** (to minimize file locking on Windows):

```json
{
  "files.watcherExclude": {
    "**/.git/objects/**": true,
    "**/.git/subtree-cache/**": true,
    "**/build/**": true,
    "**/.dart_tool/**": true
  },
  "files.hotExit": "off"
}
```

---

## Getting Started

### 1. Clone the Repository

```bash
git clone <repository-url>
cd genie_ai_mobile
```

### 2. Install Dependencies

```bash
flutter pub get
```

### 3. Verify Flutter Setup

```bash
flutter doctor
```

Fix any issues reported before proceeding.

### 4. Configure the App

Edit [assets/config/genie-ai-config.json](assets/config/genie-ai-config.json) to customize:
- API endpoints
- Theme colors
- Quick help buttons
- Bot name and welcome message

### 5. Run the App

```bash
# Web (fastest for UI testing)
flutter run -d chrome

# Android (requires device or emulator)
flutter run

# Specific device
flutter devices
flutter run -d <device-id>
```

---

## Configuration

### App Configuration (genie-ai-config.json)

The app uses a JSON configuration file for customization:

```json
{
  "app": {
    "title": "Genie AI",
    "icon": {
      "type": "file",
      "value": "/config/genie-ai-icon-light.svg"
    }
  },
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
  },
  "features": {
    "chat": {
      "welcomeMessage": "Welcome to Genie AI",
      "botName": "Genie AI",
      "quickHelp": { ... }
    }
  }
}
```

### Assets (pubspec.yaml)

All assets must be declared in [pubspec.yaml](pubspec.yaml):

```yaml
flutter:
  assets:
    - assets/images/
    - assets/images/genie-ai-icon-light.svg
    - assets/config/
    - assets/config/genie-ai-config.json
    - assets/config/quickhelp/
    - assets/FAQ.md
    - assets/icons/
  fonts:
    - family: Roboto
      fonts:
        - asset: assets/fonts/Roboto-Regular.ttf
```

### Android Manifest

For release builds, ensure these permissions are present in [android/app/src/main/AndroidManifest.xml](android/app/src/main/AndroidManifest.xml):

```xml
<manifest ...>
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

    <application
        ...
        android:usesCleartextTraffic="true">
        ...
    </application>
</manifest>
```

### Environment-Specific Configuration

The app handles different environments:

**Web vs Mobile Asset Paths:**
```dart
import 'package:flutter/foundation.dart';

final String assetPath = kIsWeb
    ? 'i18n/en.json'
    : 'assets/i18n/en.json';
```

**SSL Override (Development Only):**
The app includes `MyHttpOverrides` in [main.dart](lib/main.dart:36-44) to bypass SSL certificate issues in development. This should be disabled for production.

---

## Development

### Running on Different Platforms

#### Web Development (Fastest Iteration)
```bash
flutter run -d chrome
```
- Note: CORS and asset handling differ from mobile
- Use for UI/UX testing only

#### Android Debug
```bash
# Enable USB debugging on device
flutter run
```
- Internet permissions automatically added
- Not representative of release behavior

#### iOS Debug (macOS only)
```bash
flutter run -d iphone
```

### Hot Reload

While the app is running:
- Press `r` to hot reload
- Press `R` to hot restart
- Press `q` to quit

### Code Generation

When using `package_info_plus` or other code-generation packages:

```bash
# Generate code after updating dependencies
flutter pub run build_runner build
```

### Adding New Languages

1. Create a new locale file in [lib/i18n/locales/](lib/i18n/locales/)
2. Add the language to [I18nService](lib/services/i18n_service.dart)
3. Update the `supportedLocales` in [main.dart](lib/main.dart:130-131)

---

## Building for Release

### Android Release Build

#### The Windows "File Lock" Issue

On Windows, file locking by Gradle, VS Code, or OneDrive can cause `OS Error 32` during builds.

**Solutions:**
1. Close VS Code before building
2. Move project out of OneDrive/Dropbox folders
3. Use the provided PowerShell build script

#### Automated Build Script

Use [build-release.ps1](build-release.ps1):

```powershell
# Close VS Code first, then run:
.\build-release.ps1
```

The script:
1. Kills zombie Java/Dart processes
2. Cleans the project (`flutter clean`)
3. Builds the release APK with `--no-tree-shake-icons`

#### Manual Build Steps

```bash
# 1. Clean the project
flutter clean

# 2. Build APK (for direct installation)
flutter build apk --no-tree-shake-icons

# 3. Build App Bundle (for Play Store)
flutter build appbundle --no-tree-shake-icons
```

**Output locations:**
- APK: `build/app/outputs/flutter-apk/app-release.apk`
- AAB: `build/app/outputs/bundle/release/app-release.aab`

#### Installing on Device

```bash
# Install the built APK
flutter install
# or
adb install build/app/outputs/flutter-apk/app-release.apk
```

### iOS Release Build

**Requirement:** macOS is strictly required for iOS builds.

#### Option A: Cloud Build (Recommended for Windows Users)

1. Push code to a Git repository (GitHub, GitLab, Bitbucket)
2. Connect to a CI/CD service:
   - **Codemagic** (Recommended)
   - **Bitrise**
   - **GitHub Actions**
3. Configure the iOS workflow
4. Download the `.ipa` file

#### Option B: Local Build (Mac Only)

```bash
# 1. Build the iOS app
flutter build ios --no-tree-shake-icons

# 2. Open in Xcode
open ios/Runner.xcworkspace

# 3. In Xcode:
#    - Select your team
#    - Update signing certificates
#    - Archive the app
#    - Distribute to App Store Connect
```

---

## Deployment

### Google Play Store (Android)

#### 1. App Signing

Generate a keystore:

```bash
keytool -genkey -v -keystore upload-keystore.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias upload
```

Create [android/key.properties](android/key.properties):
```properties
storePassword=<your-password>
keyPassword=<your-key-password>
keyAlias=upload
storeFile=<path-to-upload-keystore.jks>
```

Update [android/app/build.gradle](android/app/build.gradle) to reference the keystore.

#### 2. Build App Bundle

```bash
flutter build appbundle --no-tree-shake-icons
```

#### 3. Upload to Play Console

1. Go to [Google Play Console](https://play.google.com/console)
2. Create a new app or select existing
3. Navigate to **Release > Production** (or Internal Testing)
4. Upload `build/app/outputs/bundle/release/app-release.aab`
5. Complete the store listing and privacy policy
6. Submit for review

### Apple App Store (iOS)

#### 1. Apple Developer Account

Requires Apple Developer Program membership ($99/year).

#### 2. App Registration

1. Go to [App Store Connect](https://appstoreconnect.apple.com)
2. Create a new app
3. Fill in app information and bundle identifier

#### 3. Build & Archive

On macOS with Xcode:
```bash
# Build using Flutter
flutter build ios --no-tree-shake-icons

# Open in Xcode
open ios/Runner.xcworkspace

# In Xcode:
# Product > Archive
# Distribute App > App Store Connect
```

Or use the **Transporter** app to upload your `.ipa` file.

#### 4. TestFlight

Before public release:
1. Add internal and external testers in TestFlight
2. Distribute beta builds for testing
3. Collect feedback and fix issues

#### 5. App Store Submission

1. Create a new version in App Store Connect
2. Upload the build
3. Complete the app review information
4. Submit for review (typically 1-3 days)

---

## Troubleshooting

### OS Error 32: Process cannot access the file

**Cause:** File locking by Java, Dart, VS Code, or OneDrive on Windows.

**Solutions:**
- Close VS Code completely before building
- Run build from external PowerShell terminal
- Move project out of cloud-sync folders (OneDrive, Dropbox)
- Use the [build-release.ps1](build-release.ps1) script

### Failed host lookup (errno = 7)

**Context:** App works in debug, fails in release.

**Cause:** Missing `INTERNET` permission in release manifest.

**Solution:** Add to [AndroidManifest.xml](android/app/src/main/AndroidManifest.xml):
```xml
<uses-permission android:name="android.permission.INTERNET" />
```

### HandshakeException: Certificate_verify_failed

**Context:** App cannot connect to API, but browser works.

**Causes:**
1. Using IP address instead of domain name (SSL cert mismatch)
2. Server missing intermediate certificates

**Solutions:**
1. Always use full domain name in [api_service.dart](lib/services/api_service.dart)
2. Ensure Nginx/Apache serves full certificate chain
3. Development: `MyHttpOverrides` in [main.dart](lib/main.dart) bypasses this

### Cleartext HTTP traffic not permitted

**Cause:** Android blocks non-HTTPS traffic by default.

**Solution:** Use HTTPS. If HTTP is required for testing, add to [AndroidManifest.xml](android/app/src/main/AndroidManifest.xml):
```xml
<application android:usesCleartextTraffic="true">
```

### Asset Not Found (Web vs Mobile)

**Cause:** Different path conventions for web vs mobile.

**Solution:** Use conditional loading:
```dart
final String assetPath = kIsWeb
    ? 'i18n/en.json'
    : 'assets/i18n/en.json';
```

### Target aot_android_asset_bundle failed: IconData

**Cause:** Tree shaking removes unused icons but fails on dynamic icon maps.

**Solution:** Add `--no-tree-shake-icons` flag to build commands:
```bash
flutter build apk --no-tree-shake-icons
flutter build appbundle --no-tree-shake-icons
```

### Gradle Daemon Issues

**Symptoms:** Build hangs, zombie Java processes.

**Solution:** Add to [android/gradle.properties](android/gradle.properties):
```properties
org.gradle.daemon=false
org.gradle.jvmargs=-Xmx2048M
```

### Connectivity Service Not Working

**Cause:** `ConnectivityService` not initialized.

**Solution:** Ensure initialization in [main.dart](lib/main.dart:56):
```dart
await ConnectivityService().init();
```

### Theme Not Loading

**Cause:** Config file not loaded before app starts.

**Solution:** The app shows loading spinner until config is loaded. Check [main.dart:80-101](lib/main.dart:80-101) for initialization logic.

---

## Additional Resources

### Documentation
- [Flutter Documentation](https://docs.flutter.dev/)
- [Dart Language Guide](https://dart.dev/guides)
- [Material Design 3](https://m3.material.io/)

### Packages
- [pub.dev](https://pub.dev/) - Flutter package repository

### Tools
- [Flutter Inspector](https://docs.flutter.dev/tools/devtools/inspector)
- [Dart DevTools](https://dart.dev/tools/dart-devtools)

---

## Contributing

When contributing to this project:

1. Follow the existing code structure and naming conventions
2. Add comments for complex logic
3. Update this README for new features
4. Test on multiple platforms when possible
5. Ensure all assets are declared in `pubspec.yaml`

---

## License

[Insert license information here]

---

## Support

For issues, questions, or contributions:
- Create an issue in the Git repository
- Contact: [Insert contact information]

---

**Last Updated:** 2025-02-07
**Flutter Version:** 3.10.8+
**Dart Version:** 3.10.8+
