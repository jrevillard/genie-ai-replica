# GENIE.AI Mobile Application - Product Requirements Document

**Version:** 1.1.0
**Last Updated:** February 8, 2026
**Platforms:** Flutter (reference), SwiftUI, Jetpack Compose

---

## Overview

GENIE.AI is a multilingual, cross-platform intelligent chatbot application for government services and citizen engagement. The application features AI-powered assistance, on-device local RAG (Retrieval-Augmented Generation) for offline capability, comprehensive user profiles, and internationalization support for 11 languages.

---

## 1. Authentication

### 1.1 Login
<!-- Flutter: lib/components/auth/login_screen.dart, lib/services/user_service.dart -->
<!-- SwiftUI: GenieAI/Views/Auth/LoginView.swift, GenieAI/Services/AuthService.swift, GenieAI/Services/UserService.swift -->
<!-- Compose: app/src/main/java/com/genieai/mobile/ui/screens/auth/LoginScreen.kt, app/src/main/java/com/genieai/mobile/viewmodel/AuthViewModel.kt, app/src/main/java/com/genieai/mobile/data/repository/AuthRepository.kt -->

**Requirements:**
- Username/email and password fields with validation
- "Remember me" checkbox to persist username and password locally (not the auth token)
- Password hashing (SHA-256) before transmission
- Loading state during authentication
- Error message display for failed login
- Navigation to registration and password reset
- Dynamic app icon display from configuration
- Language selector component

**API:** `POST /auth/login`

### 1.2 Registration
<!-- Flutter: lib/components/auth/register_screen.dart, lib/services/user_service.dart, lib/services/password_proxy.dart -->
<!-- SwiftUI: GenieAI/Views/Auth/RegisterView.swift, GenieAI/Services/AuthService.swift, GenieAI/Services/UserService.swift, GenieAI/Services/PasswordValidator.swift -->
<!-- Compose: app/src/main/java/com/genieai/mobile/ui/screens/auth/RegisterScreen.kt, app/src/main/java/com/genieai/mobile/viewmodel/AuthViewModel.kt -->

**Requirements:**
- Username, email, password, and confirm password fields
- Real-time username/email availability checking
- Password strength meter with visual indicator
- Password rules: minimum 8 characters, requires 3 of: lowercase, uppercase, digits, special characters
- Terms and conditions checkbox with link to ToS
- Privacy notice display
- Success page navigation on completion
- Language selector component

**API:** `POST /auth/register`

### 1.3 Password Reset - Initiation
<!-- Flutter: lib/components/auth/password_reset_initiate_screen.dart, lib/services/password_proxy.dart -->
<!-- SwiftUI: GenieAI/Views/Auth/PasswordResetView.swift, GenieAI/Services/AuthService.swift -->
<!-- Compose: app/src/main/java/com/genieai/mobile/ui/screens/auth/PasswordResetScreen.kt, app/src/main/java/com/genieai/mobile/viewmodel/AuthViewModel.kt -->

**Requirements:**
- Email input field with validation
- Support for embedded mode (within settings) and standalone mode
- Prefill email when embedded from settings
- Success message with auto-redirect (2 seconds)
- Avoid email enumeration (show success for any email)
- Dynamic branding display

**API:** `POST /auth/reset-password`

### 1.4 Password Reset - Confirmation
<!-- Flutter: lib/components/auth/password_reset_confirm_screen.dart, lib/services/password_proxy.dart -->
<!-- SwiftUI: GenieAI/Views/Auth/PasswordResetConfirmView.swift, GenieAI/Services/AuthService.swift -->
<!-- Compose: app/src/main/java/com/genieai/mobile/ui/screens/auth/PasswordResetConfirmScreen.kt, app/src/main/java/com/genieai/mobile/viewmodel/AuthViewModel.kt -->

**Requirements:**
- Token-based reset (token from URL/deep link)
- New password and confirm password fields
- Password matching validation
- Success screen with redirect to login
- Error handling for invalid/expired tokens

**API:** `POST /auth/reset-password/confirm`

### 1.5 Registration Success
<!-- Flutter: lib/components/auth/registration_success_screen.dart -->
<!-- SwiftUI: GenieAI/Views/Auth/RegistrationSuccessView.swift -->
<!-- Compose: app/src/main/java/com/genieai/mobile/ui/screens/auth/RegistrationSuccessScreen.kt -->

**Requirements:**
- Confirmation message display
- Email verification instructions
- Navigation button to login screen

### 1.6 Logout
<!-- Flutter: lib/components/shared/nav_bar_component.dart, lib/services/user_service.dart -->
<!-- SwiftUI: GenieAI/ContentView.swift, GenieAI/Services/AuthService.swift -->
<!-- Compose: app/src/main/java/com/genieai/mobile/ui/screens/main/MainScreen.kt, app/src/main/java/com/genieai/mobile/viewmodel/AuthViewModel.kt -->

**Requirements:**
- Clear authentication token
- Reset user state
- Navigate to login screen

**API:** `POST /auth/logout`

---

## 2. Chat Functionality

### 2.1 Main Chat Interface
<!-- Flutter: lib/components/chat/chatbot_component.dart, lib/services/chatbot_proxy.dart, lib/services/chat_history_proxy.dart -->
<!-- SwiftUI: GenieAI/Views/Chat/ChatView.swift, GenieAI/Views/Chat/MessageBubble.swift, GenieAI/Views/Chat/ChatInputView.swift, GenieAI/Services/ChatService.swift, GenieAI/Services/ChatHistoryService.swift, GenieAI/Models/Message.swift -->
<!-- Compose: app/src/main/java/com/genieai/mobile/ui/screens/chat/ChatScreen.kt, app/src/main/java/com/genieai/mobile/ui/screens/chat/MessageBubble.kt, app/src/main/java/com/genieai/mobile/ui/screens/chat/ChatInputBar.kt, app/src/main/java/com/genieai/mobile/viewmodel/ChatViewModel.kt, app/src/main/java/com/genieai/mobile/data/repository/ChatRepository.kt -->

**Requirements:**
- Message input field with send button
- Auto-scroll to latest message
- Markdown rendering for AI responses
- Role-based message styling (user vs assistant)
- Loading indicator during response generation
- Welcome message on new conversation (localized)
- Service/category context integration
- Related documents display in responses
- PDF export option for conversation
- Share conversation to WhatsApp (native app with web fallback)
- Message timestamp display

**API:** `POST /queries`

### 2.2 Chat History
<!-- Flutter: lib/components/sidebar/chat_folders_panel.dart, lib/services/chat_history_proxy.dart -->
<!-- SwiftUI: GenieAI/Views/Sidebar/ChatHistoryView.swift, GenieAI/Services/ChatHistoryService.swift -->
<!-- Compose: app/src/main/java/com/genieai/mobile/ui/screens/sidebar/ChatHistorySheet.kt, app/src/main/java/com/genieai/mobile/viewmodel/ChatHistoryViewModel.kt, app/src/main/java/com/genieai/mobile/data/repository/ChatHistoryRepository.kt -->

**Requirements:**
- List of past conversations with titles
- Search with debouncing (300ms)
- Folder organization (create, rename, delete folders)
- Move conversations between folders
- Delete conversations
- Sort by date (descending)
- Load conversation on selection
- Create new chat button
- Empty state handling
- **Sub-tabs:** All Chats | Folders | Starred | Archived
  - "All Chats": all non-archived conversations (including those in folders)
  - "Folders": folder list with create button, expandable to show contained conversations
  - "Starred": conversations where isStarred=true
  - "Archived": conversations where isArchived=true
- **Conversation context menu actions:**
  - Rename conversation
  - Move to folder
  - Star / unstar
  - Archive / unarchive
  - Delete (with confirmation)

**APIs:**
- `GET /chat/conversations`
- `POST /chat/conversations`
- `PUT /chat/conversations/:id`
- `DELETE /chat/conversations/:id`
- `GET /chat/folders`
- `POST /chat/folders`
- `PUT /chat/folders/:id`
- `DELETE /chat/folders/:id`

### 2.3 Response Feedback
<!-- Flutter: lib/components/chat/chat_response_feedback_dialog.dart, lib/services/chatbot_proxy.dart -->
<!-- SwiftUI: GenieAI/Views/Chat/FeedbackSheet.swift, GenieAI/Services/ChatService.swift -->
<!-- Compose: app/src/main/java/com/genieai/mobile/ui/screens/chat/FeedbackDialog.kt, app/src/main/java/com/genieai/mobile/viewmodel/ChatViewModel.kt -->

**Requirements:**
- Star rating (1-5 stars)
- Thumbs up/down buttons
- Auto-set rating based on thumb selection (up=5, down=1)
- Free-text feedback field
- Skin tone selector (5 tones for emoji feedback)
- Submit and cancel buttons

**API:** `POST /queries/:queryId/feedback`

### 2.4 Quick Help Buttons
<!-- Flutter: lib/components/chat/chatbot_component.dart, assets/config/genie-ai-config.json -->
<!-- SwiftUI: GenieAI/Views/Chat/QuickHelpGrid.swift, GenieAI/Models/QuickHelpButton.swift, GenieAI/Resources/genie-ai-config.json -->
<!-- Compose: app/src/main/java/com/genieai/mobile/ui/screens/chat/QuickHelpGrid.kt, app/src/main/java/com/genieai/mobile/data/model/QuickHelpButton.kt, app/src/main/res/raw/genie_ai_config.json -->

**Requirements:**
- Grid layout (configurable columns, default 2)
- SVG icon with configurable color
- Gradient background with dark mode override
- Two-prompt mechanism: visible text shown to user, hidden prompt sent to backend
- Configurable buttons via JSON:
  - Just Chat (general conversation)
  - Identity/Civil Registration
  - Taxes/Revenue
  - Business/Trade
  - Healthcare/Social Services
  - Education/Learning
  - Transportation/Mobility
  - Housing/Urban
  - Employment/Labor

### 2.5 PDF Export
<!-- Flutter: lib/components/chat/chatbot_component.dart (uses pdf, printing packages) -->
<!-- SwiftUI: GenieAI/Views/Chat/ChatView.swift, GenieAI/Views/Chat/ChatInputView.swift -->
<!-- Compose: (not yet implemented) -->

**Requirements:**
- Export entire conversation to PDF
- Custom filename input dialog
- Print preview support
- Platform-appropriate file saving

---

## 3. Sidebars

### 3.1 Left Sidebar - Services & History
<!-- Flutter: lib/components/sidebar/sidebar_component.dart, lib/components/sidebar/service_tree_panel.dart, lib/components/sidebar/chat_folders_panel.dart -->
<!-- SwiftUI: GenieAI/Views/Sidebar/LeftSidebarView.swift, GenieAI/Views/Sidebar/ServiceTreeView.swift, GenieAI/Views/Sidebar/ChatHistoryView.swift, GenieAI/Services/ServiceTreeService.swift -->
<!-- Compose: app/src/main/java/com/genieai/mobile/ui/screens/sidebar/ServiceTreeSheet.kt, app/src/main/java/com/genieai/mobile/ui/screens/sidebar/ChatHistorySheet.kt, app/src/main/java/com/genieai/mobile/viewmodel/ServiceTreeViewModel.kt, app/src/main/java/com/genieai/mobile/viewmodel/ChatHistoryViewModel.kt, app/src/main/java/com/genieai/mobile/data/repository/ServiceTreeRepository.kt -->

**Requirements:**
- Tab navigation: Services | History
- **Services Tab (Knowledge Areas):**
  - No sub-tabs — flat expandable category tree with search
  - Hierarchical category/service tree (categories expand to show child services)
  - Multi-select services for chat context: ordered selection list with toggle on/off; emits comma-separated service names as `contextLabels` and primary `categoryId` from first selection
  - Selection visualization: selected services show primary-color background, white text, and checkmark icon
  - Sidebar drawer (mobile) must NOT auto-close on service selection — stays open to allow multi-select; only closes on conversation selection or explicit dismiss
  - Chat context bar updates reactively as services are toggled without resetting the conversation
  - Clearing all selections resets the chat category context
  - Search with debouncing (300ms), client-side filtering with auto-expand on match
  - Locale-aware service names (reload categories on language change)
  - API response field flexibility: handle `_id`/`id`/`key` for identifiers and `label`/`name` for display names
  - Children may be objects (with id/name) or plain strings
  - Loading state: spinner while fetching
  - Error state: error message with retry button
  - Empty state: "No knowledge areas available" (distinct from chat history empty state)
- **History Tab:**
  - Sub-tabs: All Chats | Folders | Starred | Archived
  - Sub-tab styling: horizontal scroll, icon + text, underline indicator (3px primary color) on active tab
  - "All Chats": all non-archived conversations sorted by date desc
  - "Folders": folder list with create button, expandable to show contained conversations
  - "Starred": conversations where isStarred=true
  - "Archived": conversations where isArchived=true
  - Conversation context menu: Rename, Move to Folder, Star/Unstar, Archive/Unarchive, Delete
  - (Same requirements as 2.2 Chat History)

**API:** `GET /services/categories`

### 3.2 Right Sidebar - Documents & FAQ
<!-- Flutter: lib/components/chat/right_sidebar_component.dart -->
<!-- SwiftUI: GenieAI/Views/Sidebar/RightSidebarView.swift -->
<!-- Compose: app/src/main/java/com/genieai/mobile/ui/screens/sidebar/InfoResourcesSheet.kt -->

**Requirements:**
- **Related Documents Section:**
  - List of documents related to current query
  - Document title and confidence score
  - Click to view/download (authenticated)
- **FAQ Section:**
  - Load FAQ from bundled Markdown file
  - **Source of truth:** The Flutter app's `assets/FAQ.md` is the single source of truth for FAQ content across all platforms. Other platforms (SwiftUI, Jetpack Compose) must copy their FAQ from the Flutter asset when updating.
  - Translate to current language via API
  - Accordion-style expandable items
  - Re-translate on language change

**API:** `POST /translate/markdown`

---

## 4. User Profile
<!-- Flutter: lib/components/user/user_profile_component.dart, lib/services/user_profile_proxy.dart -->
<!-- SwiftUI: GenieAI/Views/Profile/UserProfileView.swift, GenieAI/Models/User.swift, GenieAI/Services/UserService.swift (all 12 tabs: Personal, Civil Registration, Address, Identity/Travel, Health/Medical, Employment, Education, Financial/Tax, Social Security, Criminal/Legal, Transportation, Civic Participation) -->
<!-- Compose: app/src/main/java/com/genieai/mobile/ui/screens/profile/UserProfileScreen.kt, app/src/main/java/com/genieai/mobile/viewmodel/UserProfileViewModel.kt, app/src/main/java/com/genieai/mobile/data/repository/UserRepository.kt, app/src/main/java/com/genieai/mobile/data/model/User.kt -->

**Requirements:**
- Privacy info text with privacy policy link displayed above tabs
- Multi-tab interface with the following sections:

### 4.1 Personal Information
- Display name, date of birth, gender, marital status
- Date of birth: date picker (no future dates allowed)
- Nationality: searchable country picker with flags
- Blood type selection
- Avatar: preset icon selection or custom upload
- Initials color customization

### 4.2 Civil Registration
- Citizenship, national ID number
- Birth certificate upload
- Marriage certificate (if applicable)

### 4.3 Address/Residency
- Current address fields
- Country picker
- Address verification status

### 4.4 Identity/Travel
- Passport information
- Visa status
- Travel document uploads

### 4.5 Health/Medical
- Emergency contacts
- Medical conditions list
- Current medications
- Insurance information

### 4.6 Employment
- Current employer
- Job title
- Employment type
- Work authorization status

### 4.7 Education
- Schools attended
- Degrees/certifications
- Languages spoken

### 4.8 Financial/Tax
- Tax ID number
- Bank account (masked display)
- Income level range

### 4.9 Social Services
- Social security numbers
- Benefits enrollment status

### 4.10 Criminal/Legal
- Legal history status
- Court records (if applicable)

### 4.11 Transportation
- Driver's license information
- Vehicle registration

### 4.12 Civic Participation
- Voter registration status
- Community involvement

**File Upload Sections:** Each section supports document uploads via multipart form

**Gender Options:** Male, Female, Other, Prefer not to say
**Marital Status Options:** Single, Married, Divorced, Widowed, Separated, Domestic Partnership
**Blood Types:** A+, A-, B+, B-, AB+, AB-, O+, O-

**APIs:**
- `GET /users/:userId`
- `PUT /users/:userId` (with multipart support)

---

## 5. Settings
<!-- Flutter: lib/components/settings/settings_component.dart, lib/services/user_service.dart, lib/services/password_proxy.dart, lib/services/connectivity_service.dart -->
<!-- SwiftUI: GenieAI/Views/Settings/SettingsView.swift, GenieAI/Services/UserService.swift, GenieAI/Services/AuthService.swift, GenieAI/Services/ThemeManager.swift, GenieAI/Services/ConnectivityService.swift, GenieAI/Services/PasswordValidator.swift -->
<!-- Compose: app/src/main/java/com/genieai/mobile/ui/screens/settings/SettingsScreen.kt, app/src/main/java/com/genieai/mobile/viewmodel/SettingsViewModel.kt, app/src/main/java/com/genieai/mobile/viewmodel/ThemeViewModel.kt, app/src/main/java/com/genieai/mobile/service/ConnectivityService.kt -->

### 5.1 Theme Settings
- Theme mode: Light, Dark, System
- Font size scaling slider
- Real-time preview

### 5.2 Language Settings
- Language selector dropdown
- 11 supported languages (see Section 8)
- Real-time UI language switch

**Platform-specific:** SwiftUI uses the iOS per-app language setting (Settings > Apps > GenieAI > Language) instead of an in-app picker. The Settings screen and Login/Register screens show a button that opens the app's iOS Settings page.

### 5.3 Notification Settings
- Email updates toggle
- Sound notifications toggle
- Notification frequency selector

### 5.4 Account Management
- Display: username, email, account type, creation date
- Edit email (requires password confirmation)
- Change password (embedded reset screen)

### 5.5 Data Management
- Reset all user data (with confirmation)
- Delete account (requires password + reason)

### 5.6 Offline Mode Toggle
- Manual offline mode switch
- Visual indicator of current status

**APIs:**
- `PUT /users/:userId`
- `PUT /users/email`
- `POST /auth/change-password`
- `POST /users/reset-data`
- `POST /users/delete`

---

## 6. About Screen
<!-- Flutter: lib/components/settings/about_screen.dart -->
<!-- SwiftUI: GenieAI/Views/Settings/AboutView.swift -->
<!-- Compose: app/src/main/java/com/genieai/mobile/ui/screens/settings/AboutScreen.kt -->

**Requirements:**
- App name and version display
- Build number
- Developer/organization information
- Links to privacy policy and terms of service

---

## 7. Offline Mode
<!-- Flutter: lib/services/connectivity_service.dart -->
<!-- SwiftUI: GenieAI/Services/ConnectivityService.swift, GenieAI/Services/LocalRAGBridge.swift, GenieAI/ContentView.swift, GenieAI/Views/Sidebar/LeftSidebarView.swift, GenieAI/Views/Settings/SettingsView.swift, GenieAI/Views/Chat/ChatView.swift, GenieAI/Services/ChatService.swift -->
<!-- Compose: app/src/main/java/com/genieai/mobile/service/ConnectivityService.kt, app/src/main/java/com/genieai/mobile/data/repository/ConnectivityRepository.kt -->

**Requirements:**
- Real-time connectivity monitoring
- 5-second polling fallback
- DNS lookup verification when hardware reports offline
- User manual override toggle
- Final state: hardware online AND NOT user override

**UI Behavior When Offline:**
- Left sidebar: disabled (greyed out)
- Chat input: disabled (greyed out)
- Right sidebar: unavailable
- Binder tabs: visual disabled state
- Snackbar notification on mode change

**Offline Chat via Local RAG (SwiftUI):**
- Chat input stays **enabled** when offline — queries are routed to the on-device LocalRAG pipeline (see Section 15)
- Knowledge Areas stay **enabled** when offline — indexed documents provide context for local RAG queries
- Chat History button/tab is **disabled** when offline (requires API)
- Profile menu item is **disabled** when offline (requires API)
- Toolbar connectivity toggle (wifi/wifi.slash icon) allows manual mode switching
- Toast notification appears on mode change with auto-dismiss
- Settings save shows "saved locally" feedback when offline
- Offline responses are visually identical to online responses (same message bubble style, markdown rendering)
- If the local model is not loaded or generation fails, a localized error message is shown: "Offline mode: unable to generate a response. Please check that the local model is loaded."

**Offline Query Routing Logic:**
1. User sends a message
2. `ConnectivityService.isOnline` is checked
3. **Online**: query is sent to the backend API via `ChatService.submitQuery()` (unchanged)
4. **Offline**: query is sent to `ChatService.submitOfflineQuery()` → `LocalRAGBridge.submitQuery()` → on-device RAG pipeline
5. The response is mapped to the same `QueryResponse` model used by the online path, ensuring seamless UI handling

---

## 8. Internationalization
<!-- Flutter: lib/services/i18n_service.dart, lib/i18n/locales/*.dart -->
<!-- SwiftUI: GenieAI/Services/AppLocaleService.swift, GenieAI/Localizable.xcstrings -->
<!-- Compose: app/src/main/res/values/strings.xml, app/src/main/res/values-ar/strings.xml, app/src/main/res/values-de/strings.xml, app/src/main/res/values-es/strings.xml, app/src/main/res/values-fr/strings.xml, app/src/main/res/values-in/strings.xml, app/src/main/res/values-sw/strings.xml, app/src/main/res/values-pt/strings.xml, app/src/main/res/values-zh-rCN/strings.xml, app/src/main/res/values-ru/strings.xml, app/src/main/res/values-th/strings.xml -->

**Supported Languages (11):**
1. English (en) - Default
2. Arabic (ar) - RTL support
3. German (de)
4. Spanish (es)
5. French (fr)
6. Indonesian (id)
7. Kiswahili (sw)
8. Portuguese (pt)
9. Chinese (zh)
10. Russian (ru)
11. Thai (th)

**Requirements:**
- Platform-native localization (Flutter: `tr('section.key')`, SwiftUI: String Catalogs with `Localizable.xcstrings`)
- Argument substitution (Flutter: `tr('key', args: {'name': 'John'})`, SwiftUI: `String(localized:)` with interpolation)
- Real-time language switching
- RTL layout support for Arabic
- Locale persistence

**Platform-specific language UX:**
- **Flutter**: In-app language selector dropdown with real-time switching
- **SwiftUI**: Uses iOS per-app language setting (Settings > Apps > GenieAI > Language); in-app UI provides a button that opens the system settings page

**Cross-Platform Localization Consistency:**

All platforms must have identical localized strings for every supported language. When a string is added, modified, or removed on one platform, the same change must be applied to all other platforms.

- The set of localized strings and their translations must be identical across Flutter, SwiftUI, and Jetpack Compose
- Translation keys, where used, must also be identical across platforms (e.g. Flutter and SwiftUI both use `chatbot.saveChat` for the same string)
- Some localization frameworks (e.g. SwiftUI String Catalogs, Android string resources) do not use dot-notation keys; in those cases the translated string values themselves must still match
- The Flutter implementation is the reference: new strings should be added to Flutter first, then propagated to all other platforms
- Each language file must contain the complete set of strings — no platform may have a partial translation

---

## 9. Navigation & Layout

### 9.1 Navigation Bar
<!-- Flutter: lib/components/shared/nav_bar_component.dart -->
<!-- SwiftUI: GenieAI/ContentView.swift (native NavigationStack + .toolbar) -->
<!-- Compose: app/src/main/java/com/genieai/mobile/ui/screens/main/MainScreen.kt -->

**Requirements:**
- App logo/icon (configurable)
- App title
- Connectivity indicator (wifi/offline icons)
- User profile dropdown
- Settings access
- Logout button
- Theme toggle
- Offline mode toggle

### 9.2 Responsive Layout
<!-- Flutter: lib/main.dart -->
<!-- SwiftUI: GenieAI/ContentView.swift -->
<!-- Compose: app/src/main/java/com/genieai/mobile/ui/screens/main/MainScreen.kt -->

**Breakpoint:** 1200px

**Desktop (>1200px):**
```
┌─────────────────────────────────────────┐
│              Navigation Bar              │
├──────────┬───────────────┬──────────────┤
│  Left    │     Chat      │    Right     │
│ Sidebar  │   Interface   │   Sidebar    │
│ (420px)  │   (flexible)  │   (420px)    │
└──────────┴───────────────┴──────────────┘
```

**Mobile (<1200px):**
```
┌─────────────────────┐
│   Navigation Bar    │
├─────────────────────┤
│                     │
│   Chat Interface    │  ← Binder tabs on edges
│                     │
└─────────────────────┘
  Drawers accessible via binder tabs
```

### 9.3 Binder Tabs
<!-- Flutter: lib/main.dart -->
<!-- SwiftUI: GenieAI/ContentView.swift (replaced with sheet-based navigation on mobile) -->
<!-- Compose: app/src/main/java/com/genieai/mobile/ui/screens/main/MainScreen.kt (replaced with ModalBottomSheet-based navigation on mobile) -->

**Requirements:**
- 10px wide vertical tabs on screen edges
- Chevron icons indicating drawer direction
- Tap to open corresponding drawer
- Color: primary in dark mode, grey in light mode

### 9.4 Named Routes
- `/login` - Login screen
- `/register` - Registration
- `/registration-success` - Registration confirmation
- `/password-reset` - Password reset initiation
- `/password-reset-confirm` - Password reset confirmation
- `/profile` - User profile
- `/about` - About screen

---

## 10. Shared Components

### 10.1 Language Selector
<!-- Flutter: lib/components/shared/language_selector.dart -->
<!-- SwiftUI: (uses iOS per-app language setting; button in GenieAI/Views/Auth/LoginView.swift LanguageSelectorCompact, GenieAI/Views/Settings/SettingsView.swift) -->
<!-- Compose: app/src/main/java/com/genieai/mobile/ui/components/LanguageSelector.kt -->

- Dropdown with flag icons
- Language name display
- Real-time language change
- **SwiftUI**: Opens iOS Settings instead of in-app picker

### 10.2 Confirm Dialog
<!-- Flutter: lib/components/shared/confirm_dialog.dart -->
<!-- SwiftUI: GenieAI/Views/Shared/ConfirmDialog.swift -->
<!-- Compose: app/src/main/java/com/genieai/mobile/ui/components/ConfirmDialog.kt -->

- Reusable confirmation modal
- Custom title and message
- Confirm/Cancel actions
- Theme-aware styling

---

## 11. Configuration
<!-- Flutter: lib/services/genie_ai_config.dart, assets/config/genie-ai-config.json -->
<!-- SwiftUI: GenieAI/Services/ConfigService.swift, GenieAI/Resources/genie-ai-config.json -->
<!-- Compose: app/src/main/java/com/genieai/mobile/service/ConfigService.kt, app/src/main/res/raw/genie_ai_config.json -->

**Configuration File Structure:**
```json
{
  "app": {
    "title": "GENIE.AI",
    "icon": { "type": "file", "value": "path.svg" }
  },
  "theme": {
    "primaryColor": "#4E97D1",
    "secondaryColor": "#26A69A",
    "backgroundColor": "#F5F7FA",
    "textColor": "#333333",
    "navbar": {
      "gradientStart": "...",
      "gradientEnd": "...",
      "textColor": "..."
    }
  },
  "quickHelp": {
    "layout": { "columns": 2, ... },
    "buttons": [ ... ]
  }
}
```

---

## 12. Theme System
<!-- Flutter: lib/utils/theme_manager.dart -->
<!-- SwiftUI: GenieAI/Services/ThemeManager.swift, GenieAI/Extensions/View+GlassStyle.swift -->
<!-- Compose: app/src/main/java/com/genieai/mobile/ui/theme/Theme.kt, app/src/main/java/com/genieai/mobile/ui/theme/Color.kt, app/src/main/java/com/genieai/mobile/ui/theme/Type.kt, app/src/main/java/com/genieai/mobile/ui/theme/Shape.kt, app/src/main/java/com/genieai/mobile/ui/theme/GlassModifiers.kt, app/src/main/java/com/genieai/mobile/ui/theme/CategoryPalette.kt -->

**Requirements:**
- Light and dark theme support
- System theme detection
- Configuration-driven colors
- Font size scaling (global factor)
- Navbar gradient support
- Real-time theme switching

**Default Colors:**
- Primary: #4E97D1
- Secondary: #5F9EA0
- Background (light): #F5F7FA
- Text (light): #333333

---

## 12.1 Platform-Specific Design

**SwiftUI (iOS):** Uses an iOS-native "Liquid Glass" design with `.material` backgrounds, depth via layered glass + border + shadow, spring animations, and haptic feedback. Design tokens (spacing, radii, shadows, animations) are centralized in `ThemeManager`. User preferences for animations and haptics are toggleable in Settings.

**Flutter:** Uses Material Design components and styling.

**Jetpack Compose (Android):** Uses an Android-adapted "Frosted Glass" design with translucent surface composables, depth via glass card + border + shadow modifiers, spring animations, and haptic feedback. Design tokens (spacing, radii, shadows, animations, brand colors) are centralized in the theme package (`ui/theme/`). User preferences for animations and haptics are toggleable in Settings.

**Shared across platforms:**
- Brand colors (from `genie-ai-config.json`): primaryColor, secondaryColor, navbar gradient
- Feature parity: all screens and functionality must match
- Component architecture: similar structure across platforms

**Platform-specific (may differ):**
- Visual language (materials vs Material Design)
- Interaction patterns (haptics, spring animations)
- Component styling (glass cards vs Material cards)

**Interaction defaults (all platforms):**
- Every list row, selectable item, or interactive card must be tappable across its entire width/height — not just the text or icon. Ensure the full bounds are hit-testable.
- Minimum tap target size: 44pt (iOS) / 48dp (Android) in the smallest dimension per platform HIG.
- Interactive rows in lists should have generous vertical padding (at least 14pt / 14dp) for comfortable tapping.
- Every interactive element must provide immediate visual and/or haptic feedback on tap.

**Delight & engagement principles (all platforms):**
- **Category color coding**: Every knowledge area category, conversation, and folder should display a distinct color on its icon badge. Use a shared palette of 12 bright candy pastels (aqua, mint, peach, lavender, periwinkle, sunshine, pink, wisteria, lime, apricot, tangerine, seafoam). Avoid earthy or brownish tones — keep colors light and cheerful. Colors are deterministic — the same name always maps to the same color across sessions. This breaks visual monotony, aids scanning, and makes the app feel alive.
- **Animated state transitions**: When interactive elements toggle between states (selected/deselected, expanded/collapsed, starred/unstarred), the transition should be animated — never an abrupt swap. Use platform-native symbol animation APIs (SF Symbol effects on iOS, animated vector drawables on Android).
- **Selection feedback**: Every selection action should be accompanied by both visual animation and haptic/tactile feedback. Users should *feel* the toggle.
- **Warm, friendly tone**: Empty states, loading states, and onboarding copy should feel encouraging and human, not sterile or corporate. Example: "No starred chats yet" not "No results found."
- **Iconography consistency**: Use one icon set per platform (SF Symbols on iOS, Material Symbols on Android). Prefer clean, geometric, consistent stroke weight across all icons. Use outline variants for inactive states and filled variants for active/selected states. Always pair icons with text labels.
- **Semantic icon colors**: Use contextually appropriate colors for icons (e.g., amber/yellow for lightbulbs, green for success, red for errors) rather than coloring all icons with the brand primary. This adds visual variety and reduces color monotony.
- **No gradient fills on chat bubbles**: User message bubbles should use a subtle tinted surface (e.g., frosted glass with a light primary color overlay) rather than a solid or gradient color fill. Gradient chat bubbles look dated. The tinted approach is modern, lighter, and cohesive with glass/material design systems.
- **Rounded typography**: Prefer rounded font families (SF Pro Rounded on iOS, Google Sans Rounded or equivalent on Android) for a warm, approachable feel. Applied at the app root level.
- **Elderly-friendly sizing**: Quick help tiles, action buttons, and primary interactive elements should be generously sized — minimum 52pt/52dp height, 14pt+ text, 20pt+ icons. The app serves a healthcare-focused population that includes elderly users.

---

## 13. API Service Architecture
<!-- Flutter: lib/services/api_service.dart, lib/services/*_proxy.dart -->
<!-- SwiftUI: GenieAI/Services/APIService.swift, GenieAI/Services/*Service.swift -->
<!-- Compose: app/src/main/java/com/genieai/mobile/data/remote/ApiService.kt, app/src/main/java/com/genieai/mobile/data/repository/AuthRepository.kt, app/src/main/java/com/genieai/mobile/data/repository/ChatRepository.kt, app/src/main/java/com/genieai/mobile/data/repository/ChatHistoryRepository.kt, app/src/main/java/com/genieai/mobile/data/repository/UserRepository.kt, app/src/main/java/com/genieai/mobile/data/repository/ServiceTreeRepository.kt -->

> **Full API Specification:** See [API.md](./API.md) for all endpoint details, request/response formats, and cross-platform implementation notes extracted from the backend source code.

**Base Service:**
- HTTP client wrapper
- Bearer token management
- Request/response logging (see also [Section 15.8: LLM Communication Logging](#158-llm-communication-logging))
- Error handling

**Proxy Services:**
- `chatbot_proxy.dart` - Query submission, feedback
- `chat_history_proxy.dart` - Conversations, folders
- `user_service.dart` - Authentication, account
- `user_profile_proxy.dart` - Profile CRUD
- `password_proxy.dart` - Password operations
- `service_tree_proxy.dart` - Service categories
- `document_file_proxy.dart` - File management

**Offline Query Path (SwiftUI):**
- When offline, `ChatService.submitOfflineQuery()` delegates to `LocalRAGBridge` instead of the HTTP API
- The response is mapped to the same `QueryResponse` model via JSON roundtrip, so the chat UI requires no special offline handling
- See Section 15 for full LocalRAG architecture

---

## 14. Security Requirements

- SHA-256 password hashing client-side
- Bearer token authentication
- Token cleared on logout
- HTTPS required for production
- No credential storage without user consent ("Remember me")

**Local RAG Security:**
- All on-device processing stays on-device — no data is transmitted when offline
- Indexed documents and embeddings are stored in application memory only (not persisted to disk by default)
- LLM model files (.gguf) should be stored in the app's sandboxed documents directory
- The local model never has access to authentication tokens or credentials
- Apple FoundationModels provider uses Apple's on-device models with built-in safety guardrails

---

## 15. Local RAG & On-Device AI
<!-- SwiftUI: local_rag_swift/ (Swift Package), GenieAI/Services/LocalRAGBridge.swift, GenieAI/Services/RemoteFilesService.swift, GenieAI/Services/OfflineLibraryService.swift, GenieAI/Services/LocalRAGIndexer.swift, GenieAI/Views/OfflineLibrary/OfflineLibraryView.swift -->

The application supports on-device AI-powered chat when offline via a local Retrieval-Augmented Generation (RAG) pipeline. This is implemented as a standalone Swift Package (`LocalRAG`) that is integrated into the SwiftUI app.

### 15.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    LocalRAGService                       │
│                   (Main Facade Actor)                    │
├─────────────┬─────────────────────┬─────────────────────┤
│  Document   │    Vector Store     │    LLM Provider     │
│  Indexer    │  (Cosine Similarity)│   (Swappable)       │
├─────────────┼─────────────────────┼─────────────────────┤
│  Text       │    Embedding        │  ┌───────────────┐  │
│  Chunker    │    Service          │  │ llama.cpp      │  │
│             │   (NLEmbedding)     │  │ (Gemma, etc.)  │  │
│  Context    │                     │  ├───────────────┤  │
│  Formatter  │                     │  │ Foundation-    │  │
│             │                     │  │ Models (iOS26) │  │
│             │                     │  └───────────────┘  │
└─────────────┴─────────────────────┴─────────────────────┘
```

### 15.2 LLM Provider Abstraction

The package uses a protocol-based provider pattern allowing swappable LLM backends:

**LLMProviderType enum:**
- `.llamaCpp(modelPath: String)` — Gemma, Llama, Mistral, or any GGUF-format model via llama.cpp C API
- `.foundationModels` — Apple's on-device models (iOS 26+ / macOS 26+ only, via FoundationModels framework)

**Provider Selection Logic:**
1. If `LLMProviderType.foundationModels` is configured AND `#available(iOS 26, *)` → use `FoundationModelsProvider`
2. If `.foundationModels` is configured but iOS < 26 → fall back to a no-op provider (graceful degradation)
3. If `.llamaCpp(modelPath:)` is configured → use `LlamaCppProvider` with the specified GGUF model file

**llama.cpp Provider Details:**
- Uses `StanfordBDHG/llama.cpp` v0.3.3 precompiled XCFramework (avoids unsafeFlags issue in upstream ggml-org repo)
- Metal GPU acceleration (99 layers offloaded)
- Context window: 4096 tokens, batch size: 512
- Sampling: configurable temperature, top-k, top-p
- Chat template: Gemma-style (`<start_of_turn>user`, `<start_of_turn>model`)
- Requires C++ interop (`SWIFT_OBJC_INTEROP_MODE = objcxx`) on both the package AND the consuming app target

### 15.3 RAG Pipeline

**Indexing Flow (Document → Searchable Chunks):**
1. `RAGDocument` (id, title, content, metadata) is submitted
2. `TextChunker` splits content at sentence boundaries (default: 500 chars, 50 char overlap) using `NLTokenizer`
3. `EmbeddingService` generates 512-dimensional vectors for each chunk via `NLEmbedding.sentenceEmbedding`
4. `VectorStore` stores chunks with their embeddings in memory

**Query Flow (Question → Answer):**
1. User query is embedded using the same `EmbeddingService`
2. `VectorStore` performs cosine similarity search (configurable top-K and threshold)
3. Optional label filtering narrows results to selected knowledge area categories
4. `ContextFormatter` assembles retrieved chunks into a numbered context block
5. Context is injected into a system prompt template (with `{context}` placeholder)
6. `LLMProvider.generate()` produces the response
7. Response is wrapped in `RAGResponse` with source attributions and confidence score

**Configuration (`RAGConfiguration`):**
| Parameter | Default | Description |
|-----------|---------|-------------|
| `topK` | 5 | Number of chunks to retrieve |
| `chunkSize` | 500 | Target chunk size in characters |
| `chunkOverlap` | 50 | Overlap between adjacent chunks |
| `similarityThreshold` | 0.3 | Minimum cosine similarity to include |
| `maxGenerationTokens` | 512 | Maximum tokens for LLM response |
| `temperature` | 0.7 | Sampling temperature |
| `embeddingLanguage` | `.english` | Language for NLEmbedding model |

### 15.4 App Integration (SwiftUI)

**LocalRAGBridge** (`@Observable` class) bridges the `LocalRAG` package to the app:
- Injected via `.environment(localRAGBridge)` from `GenieAIApp`
- Initialized on app launch via `.task { await localRAGBridge.initialize() }`
- Maps `RAGResponse` → `QueryResponse` via JSON roundtrip (preserves Decodable-only init on QueryResponse)
- Exposes: `isReady`, `isLoading`, `error` for UI state binding

**Offline Query Flow in ChatView:**
```
sendQuery() → connectivity.isOnline?
  ├── YES → chatService.submitQuery() → API
  └── NO  → chatService.submitOfflineQuery() → LocalRAGBridge → LocalRAGService
```

### 15.5 Model Management

**Requirements:**
- LLM model files (.gguf) must be placed in the app's documents directory or bundle
- Model loading is async and should happen on app launch (not blocking UI)
- Model should be unloaded on memory pressure or app backgrounding (future)
- The app must gracefully handle missing model files with a user-friendly error

**Supported Model Formats:**
- GGUF (llama.cpp): Gemma 2B, Llama 3.2, Mistral 7B, Phi-3, etc.
- Apple FoundationModels: No user-managed model files (system-provided)

### 15.6 Embedding Service

- Uses Apple's `NLEmbedding.sentenceEmbedding(for:)` from the NaturalLanguage framework
- 512-dimensional vectors, built-in to iOS (no external dependencies)
- Language-configurable via `RAGConfiguration.embeddingLanguage`
- Thread-safe via actor isolation

### 15.7 Future Enhancements

- **Persistent vector store**: Persist indexed documents to disk for faster cold starts
- **Streaming generation**: Token-by-token streaming for real-time response display
- **Model download manager**: In-app model downloading with progress UI
- **Conversation history caching**: Cache recent conversations locally for offline browsing
- **Cross-platform LocalRAG**: Kotlin Multiplatform or Android-native equivalent for Jetpack Compose
- **Hybrid mode**: Use local RAG for immediate response while fetching richer API response in background

### 15.8 LLM Communication Logging
<!-- SwiftUI: GenieAI/Services/ChatService.swift, GenieAI/Services/LocalRAGBridge.swift -->
<!-- LocalRAG: Sources/LocalRAG/LocalRAGService.swift, Sources/LocalRAG/Providers/LlamaCppProvider.swift, Sources/LocalRAG/Providers/FoundationModelsProvider.swift, Sources/LocalRAG/Embedding/EmbeddingService.swift, Sources/LocalRAG/VectorStore/VectorStore.swift, Sources/LocalRAG/Pipeline/DocumentIndexer.swift -->

All LLM communication paths (remote API and local RAG) must emit structured, leveled logs for debugging, performance monitoring, and production diagnostics.

**Cross-Platform Logging APIs:**

| Platform | API | Subsystem/Tag |
|----------|-----|---------------|
| SwiftUI (iOS) | `os.Logger` | `com.genieai` |
| Jetpack Compose (Android) | `android.util.Log` | `GenieAI` |
| Flutter | `dart:developer` `log()` | `GenieAI` |

**Log Levels:**

| Level | Usage | Example |
|-------|-------|---------|
| Debug | Full prompt text, embedding vectors, detailed search params | Resolved system prompt, per-chunk scores |
| Info | Request/response summaries, timing, counts | "Remote response: confidence=0.85, sources=3, duration=1200ms" |
| Error | Failures, fallbacks, unavailable services | "Model load failed", "Embedding unavailable" |

**Remote LLM Logging Fields:**
- Request: session ID (private/redacted), message count, category ID, context labels, language
- Response: response ID (private/redacted), confidence score, source count, content length, round-trip duration (ms)
- Error: failure description, duration at time of failure

**Local LLM Logging Fields:**
- Model lifecycle: provider type, load/unload events, load duration
- Pipeline stages: per-stage timing (embed, vector search, generation), chunk counts, similarity scores
- Generation: prompt token count, generated token count, generation config (maxTokens, temperature, topK, topP), duration
- Embedding: language, dimension, nil-vector warnings
- Vector store: store size, search parameters, result counts

**Privacy Requirements:**
- Session IDs and response IDs must be marked as private/redacted in logs (e.g., `privacy: .private` on iOS)
- User message content must NOT appear at `.info` level — only at `.debug` (which is not persisted by default)
- Model file paths must be marked as private/redacted

**Performance Requirements:**
- Logging must not add measurable overhead to LLM operations
- Use platform-native structured logging (not `print()` / `println()` / `debugPrint()`)
- Timing must use monotonic clocks (`ContinuousClock` on iOS, `System.nanoTime()` on Android, `Stopwatch` in Dart)

---

## Cross-Platform Implementation Notes

### Architecture Parity
All platforms should maintain similar:
- Component/screen structure
- Service layer organization
- State management patterns (adapted to platform idioms)
- API integration

### Platform-Specific Adaptations
- **SwiftUI (iOS 17+):** Use @Observable macro for services, @Environment for injection; NavigationStack for routing; LocalRAG Swift Package for on-device AI
- **Jetpack Compose:** Use ViewModel + StateFlow for services; NavHost for routing; on-device AI via llama.android or MediaPipe (planned)
- **Flutter:** Use ChangeNotifier + StatefulWidget; Navigator with named routes; on-device AI not yet implemented

### Data Model JSON Decoding
The backend API (ArangoDB) returns varying field names. All platforms must handle flexible decoding:
- **ID fields:** `_id`, `_key`, or `id` — prefer `_key` for folders/users, `_id` for conversations (strip collection prefix like `conversations/`, `folders/`)
- **Display name fields:** `label` or `name` for service categories/items
- **Children:** Service category children may be full objects or plain strings
- **Boolean defaults:** `isStarred`, `isArchived`, `isDefault` may be absent — default to `false`
- **Date fields:** API uses `created`/`updated` (NOT `createdAt`/`updatedAt`). May be absent or `null` — default to current date. Date formats vary: ISO 8601 with fractional seconds (`2026-02-05T23:07:00.123Z`), without fractional seconds (`2026-02-05T23:07:00Z`), or Unix timestamps. All platforms must handle all three formats.
- **Optional fields:** Many fields present in the model may not be returned by the API (e.g., `userId`, `sessionId` absent from conversation list responses; `userId` absent from folder responses). All non-essential fields must be decoded as optional with sensible defaults.
- **Folder API fields:** `name`, `description`, `isArchived`, `color`, `icon`, `parentFolderId`, `order`, `conversationCount`, `childFolderCount`, `userRole`, `lastAccessedAt` — no `userId` in response
- **Conversation list API fields:** `title`, `lastMessage`, `messageCount`, `isStarred`, `isArchived`, `category`, `tags`, `userRole`, `lastViewedAt`, `lastMessagePreview` — no `userId`, `sessionId`, `messages`, or `folderId` in list response
- **Message API fields:** API returns `sender` (not `role`) with values `"user"`/`"assistant"`. Clients must normalize `sender` → `role`. Message IDs use `_id`/`_key`/`id` like other models. Timestamp field uses same flexible date format.
- **Flexible date decoder:** All services decoding JSON with Date fields must use a flexible date strategy (not strict `.iso8601`). This applies to all services: auth, user, chat history, chat queries.

<!-- SwiftUI: GenieAI/Models/User.swift, GenieAI/Models/Conversation.swift, GenieAI/Models/Folder.swift, GenieAI/Models/Message.swift, GenieAI/Models/ServiceCategory.swift, GenieAI/Extensions/JSONDecoder+FlexibleDate.swift -->
<!-- Compose: app/src/main/java/com/genieai/mobile/data/model/User.kt, app/src/main/java/com/genieai/mobile/data/model/Conversation.kt, app/src/main/java/com/genieai/mobile/data/model/Folder.kt, app/src/main/java/com/genieai/mobile/data/model/Message.kt, app/src/main/java/com/genieai/mobile/data/model/ServiceCategory.kt, app/src/main/java/com/genieai/mobile/util/FlexibleDateParser.kt -->

### File Structure Mapping
```
Flutter                    SwiftUI                           Jetpack Compose
───────                    ───────                           ───────────────
lib/components/auth/       GenieAI/Views/Auth/               ui/screens/auth/
lib/components/chat/       GenieAI/Views/Chat/               ui/screens/chat/
lib/components/sidebar/    GenieAI/Views/Sidebar/            ui/screens/sidebar/
lib/components/settings/   GenieAI/Views/Settings/           ui/screens/settings/
lib/components/user/       GenieAI/Views/Profile/            ui/screens/user/
lib/components/shared/     GenieAI/Views/Shared/             ui/components/
lib/services/              GenieAI/Services/                 data/repository/
lib/utils/                 GenieAI/Extensions/               util/
lib/i18n/locales/          GenieAI/Localizable.xcstrings     res/values/
assets/config/             GenieAI/Resources/                assets/
(n/a)                      local_rag_swift/                   (planned)
```

### LocalRAG Package Structure (SwiftUI only)
```
local_rag_swift/
├── Package.swift
├── Sources/LocalRAG/
│   ├── LocalRAGService.swift              # Main facade (actor)
│   ├── LocalRAGError.swift                # Error types
│   ├── Configuration/
│   │   ├── RAGConfiguration.swift         # Pipeline parameters
│   │   └── LLMProviderType.swift          # Provider selection enum
│   ├── Models/
│   │   ├── RAGDocument.swift              # Input document
│   │   ├── RAGResponse.swift              # Output response
│   │   ├── RAGSource.swift                # Source attribution
│   │   └── RAGQuery.swift                 # Query input
│   ├── Protocols/
│   │   └── LLMProvider.swift              # LLM provider protocol
│   ├── Providers/
│   │   ├── LlamaCppProvider.swift         # llama.cpp C API (actor)
│   │   └── FoundationModelsProvider.swift # Apple on-device (iOS 26+)
│   ├── Embedding/
│   │   └── EmbeddingService.swift         # NLEmbedding wrapper (actor)
│   ├── VectorStore/
│   │   ├── VectorStore.swift              # Cosine similarity search (actor)
│   │   └── DocumentChunk.swift            # Chunk with embedding
│   └── Pipeline/
│       ├── DocumentIndexer.swift          # Chunk → embed → store (actor)
│       ├── TextChunker.swift              # Sentence-boundary chunking
│       └── ContextFormatter.swift         # Format chunks for LLM prompt
└── Tests/LocalRAGTests/
    ├── TextChunkerTests.swift
    ├── VectorStoreTests.swift
    └── EmbeddingServiceTests.swift
```
