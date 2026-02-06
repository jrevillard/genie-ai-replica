# GENIE.AI Mobile Application - Product Requirements Document

**Version:** 1.0.0
**Last Updated:** February 5, 2026
**Platforms:** Flutter (reference), SwiftUI, Jetpack Compose

---

## Overview

GENIE.AI is a multilingual, cross-platform intelligent chatbot application for government services and citizen engagement. The application features AI-powered assistance, offline capability, comprehensive user profiles, and internationalization support for 11 languages.

---

## 1. Authentication

### 1.1 Login
<!-- Flutter: lib/components/auth/login_screen.dart, lib/services/user_service.dart -->
<!-- SwiftUI: GenieAI/Views/Auth/LoginView.swift, GenieAI/Services/AuthService.swift, GenieAI/Services/UserService.swift -->

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

**Requirements:**
- Confirmation message display
- Email verification instructions
- Navigation button to login screen

### 1.6 Logout
<!-- Flutter: lib/components/shared/nav_bar_component.dart, lib/services/user_service.dart -->
<!-- SwiftUI: GenieAI/Views/Shared/NavBarView.swift, GenieAI/Services/AuthService.swift -->

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

**Requirements:**
- **Related Documents Section:**
  - List of documents related to current query
  - Document title and confidence score
  - Click to view/download (authenticated)
- **FAQ Section:**
  - Load FAQ from bundled Markdown file
  - Translate to current language via API
  - Accordion-style expandable items
  - Re-translate on language change

**API:** `POST /translate/markdown`

---

## 4. User Profile
<!-- Flutter: lib/components/user/user_profile_component.dart, lib/services/user_profile_proxy.dart -->
<!-- SwiftUI: GenieAI/Views/Profile/UserProfileView.swift, GenieAI/Models/User.swift, GenieAI/Services/UserService.swift (all 12 tabs: Personal, Civil Registration, Address, Identity/Travel, Health/Medical, Employment, Education, Financial/Tax, Social Security, Criminal/Legal, Transportation, Civic Participation) -->

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

### 5.1 Theme Settings
- Theme mode: Light, Dark, System
- Font size scaling slider
- Real-time preview

### 5.2 Language Settings
- Language selector dropdown
- 11 supported languages (see Section 8)
- Real-time UI language switch

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

**Requirements:**
- App name and version display
- Build number
- Developer/organization information
- Links to privacy policy and terms of service

---

## 7. Offline Mode
<!-- Flutter: lib/services/connectivity_service.dart -->
<!-- SwiftUI: GenieAI/Services/ConnectivityService.swift -->

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

---

## 8. Internationalization
<!-- Flutter: lib/services/i18n_service.dart, lib/i18n/locales/*.dart -->
<!-- SwiftUI: GenieAI/Services/I18nService.swift, GenieAI/Localization/*.swift -->

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
- Global translation function: `tr('section.key')`
- Argument substitution: `tr('key', args: {'name': 'John'})`
- Nested key structure
- Real-time language switching
- RTL layout support for Arabic
- Locale persistence

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
<!-- SwiftUI: GenieAI/Views/Shared/NavBarView.swift -->

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
<!-- SwiftUI: GenieAI/ContentView.swift (drawer-based on mobile) -->

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
<!-- SwiftUI: GenieAI/Views/Shared/LanguageSelector.swift -->

- Dropdown with flag icons
- Language name display
- Real-time language change

### 10.2 Confirm Dialog
<!-- Flutter: lib/components/shared/confirm_dialog.dart -->
<!-- SwiftUI: GenieAI/Views/Shared/ConfirmDialog.swift -->

- Reusable confirmation modal
- Custom title and message
- Confirm/Cancel actions
- Theme-aware styling

---

## 11. Configuration
<!-- Flutter: lib/services/genie_ai_config.dart, assets/config/genie-ai-config.json -->
<!-- SwiftUI: GenieAI/Services/ConfigService.swift, GenieAI/Resources/genie-ai-config.json -->

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
<!-- SwiftUI: GenieAI/Services/ThemeManager.swift -->

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

## 13. API Service Architecture
<!-- Flutter: lib/services/api_service.dart, lib/services/*_proxy.dart -->
<!-- SwiftUI: GenieAI/Services/APIService.swift, GenieAI/Services/*Service.swift -->

**Base Service:**
- HTTP client wrapper
- Bearer token management
- Request/response logging
- Error handling

**Proxy Services:**
- `chatbot_proxy.dart` - Query submission, feedback
- `chat_history_proxy.dart` - Conversations, folders
- `user_service.dart` - Authentication, account
- `user_profile_proxy.dart` - Profile CRUD
- `password_proxy.dart` - Password operations
- `service_tree_proxy.dart` - Service categories
- `document_file_proxy.dart` - File management

---

## 14. Security Requirements

- SHA-256 password hashing client-side
- Bearer token authentication
- Token cleared on logout
- HTTPS required for production
- No credential storage without user consent ("Remember me")

---

## Cross-Platform Implementation Notes

### Architecture Parity
All platforms should maintain similar:
- Component/screen structure
- Service layer organization
- State management patterns (adapted to platform idioms)
- API integration

### Platform-Specific Adaptations
- **SwiftUI (iOS 17+):** Use @Observable macro for services, @Environment for injection; NavigationStack for routing
- **Jetpack Compose:** Use ViewModel + StateFlow for services; NavHost for routing
- **Flutter:** Use ChangeNotifier + StatefulWidget; Navigator with named routes

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
lib/i18n/locales/          GenieAI/Localization/             res/values/
assets/config/             GenieAI/Resources/                assets/
```
