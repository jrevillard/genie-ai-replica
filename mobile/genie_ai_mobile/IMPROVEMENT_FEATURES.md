# AgroGenie Bangladesh Mobile Improvements

Reference repository:

```text
https://gitlab.com/fordendk/genie-ai-replica/-/tree/main/mobile/genie_ai_mobile?ref_type=heads
```

This app keeps the original Flutter mobile project structure from the reference repository, but extends it into an AgroGenie Bangladesh agriculture and weather assistant. The main additions are handsfree voice chat, map responses, Bengali/Bangladesh UX updates, weather/potato alert integration, Twilio SMS alert testing, and backend-hosted API support.

## Project Structure

The original mobile structure remains the same:

```text
mobile/genie_ai_mobile/
  android/                  Android app shell, Gradle config, permissions
  assets/                   App config, icons, static assets
  ios/                      iOS app shell
  lib/
    components/             UI screens and widgets
    i18n/                   Locale files and translated strings
    services/               API clients and app services
    src/                    Flutter template/sample app views
    utils/                  Theme and UI helpers
    main.dart               App entry point
  linux/                    Linux desktop shell
  macos/                    macOS desktop shell
  test/                     Flutter tests
  web/                      Web shell
  windows/                  Windows desktop shell
  pubspec.yaml              Flutter dependencies and asset config
```

Added or heavily extended areas:

```text
lib/services/geocoding_service.dart          New map/geocoding helper
lib/services/voice_conversation_service.dart New speech-to-text/TTS helper
lib/services/notification_service.dart       In-app/local notification hooks and Firebase experiment
lib/components/chat/chatbot_component.dart   Map cards, handsfree message path, response cleanup
lib/main.dart                                Handsfree overlay and notification init experiment
assets/config/genie-ai-config.json           AgroGenie Bangladesh branding and quick-help config
components/weather-mcp-service/              Potato EWS + Twilio SMS alert test work
components/gov-chat-backend/                 Notification registration/broadcast endpoint work
```


## User Interaction Wire Diagram

The original repository structure is still present, but the user flow is now broader than a normal text-only chat. A user can type, speak, request maps, ask weather/crop questions, or receive warning messages.

### Main App Flow

```text
User opens AgroGenie Bangladesh
    |
    v
Login / Register
    |
    v
AgroGenie main screen
    |
    +-- Text chat ------------------------------+
    |                                           |
    +-- Handsfree voice mode -------------------+
    |                                           |
    +-- Suggested agriculture/weather prompts --+
                                                |
                                                v
                                      ChatBotComponent
                                                |
             +----------------------------------+----------------------------------+
             |                                  |                                  |
             v                                  v                                  v
      Crop/weather query                  Map request                      General app query
      example: potato risk                example: map of Dhaka            example: profile/help
             |                                  |                                  |
             v                                  v                                  v
      Hosted backend API                  GeocodingService                  Hosted backend API
      /api/queries or                     OpenStreetMap /                   normal authenticated
      weather endpoints                   Nominatim lookup                  app service call
             |                                  |                                  |
             v                                  v                                  v
      Backend RAG/weather                 flutter_map card                  UI response / update
      response                            marker + zoom
             |
             v
      Clean response text
      strips tags like <MEWA>...</MEWA>
             |
             v
      Displayed in chat history
```

### Crop and Weather Information Flow

```text
User asks crop/weather question
    |
    v
Flutter chat message
    |
    v
ApiService -> hosted backend
    |
    v
Backend chat/weather services
    |
    +-- RAG document lookup for agriculture knowledge
    |
    +-- Weather/potato risk endpoint when risk data is needed
    |
    v
Assistant response
    |
    v
Mobile cleanup layer
    removes wrapper tags / markdown noise for display and TTS
    |
    v
Shown in chat
    |
    +-- If handsfree mode is active
        |
        v
        Text-to-speech reads the answer aloud
```

### Map Request Flow

```text
User query
example: "show me the map of Dhaka"
    |
    v
ChatBotComponent detects map intent
    |
    v
Extract place name
    |
    v
GeocodingService
    |
    v
OpenStreetMap / Nominatim
    |
    v
Latitude + longitude
    |
    v
flutter_map widget
    |
    v
Zoomable map card with marker
    |
    v
Saved as part of chat interaction
```

### Handsfree Voice Flow

```text
User taps Handsfree on main page
    |
    v
Handsfree overlay opens
    |
    v
Speech-to-text listens
    |
    v
Recognized speech becomes chat query
    |
    v
Same backend/chat flow as text mode
    |
    v
Assistant response returned
    |
    v
Text-to-speech speaks response
    |
    v
Conversation saved in chat history
    |
    v
Overlay stays open until user presses X/back
```

### Potato Warning and SMS Flow

```text
Weather forecast data
    |
    v
short_term_potato_ews.py
    |
    v
Potato risk assessment
    |
    +-- Web/mobile alert data path
    |      |
    |      v
    |      Backend weather endpoint
    |      |
    |      v
    |      App/web popup or risk response
    |
    +-- Optional Twilio SMS path
           |
           v
       notifier.py
           |
           v
       Twilio SMS API
           |
           v
       Warning text sent to configured phone numbers
```

## Feature Summary

### AgroGenie Bangladesh Branding

The app was changed from a generic Genie AI client into an AgroGenie Bangladesh assistant.

Key changes:

- App title changed to `AgroGenie Bangladesh`.
- Welcome text now focuses on agriculture and weather.
- Quick-help actions were trimmed toward agriculture/weather tasks.
- The top bar was adjusted so `AgroGenie Bangladesh` fits on smaller screens.
- The app icon/title area can return users to the main/start screen.

Main files:

```text
assets/config/genie-ai-config.json
lib/components/shared/nav_bar_component.dart
lib/i18n/locales/bn.dart
```

### Hosted Backend API Support

The mobile app now points to the hosted backend by default:

```text
https://164.52.194.143/api
```

It can still be overridden at build time:

```bash
flutter run --dart-define=API_BASE_URL=https://your-host/api
```

Main file:

```text
lib/services/api_service.dart
```

### Login and Registration Hardening

The login/register flow was made more tolerant of backend response differences.

Improvements:

- Handles `accessToken` or `token` response fields.
- Keeps the backend token in `ApiService` for authenticated calls.
- Registration accepts `200` or `201` success responses.
- Avoids crashing when backend error responses are not in the expected JSON shape.
- Mock/fake login was removed from the mobile source.

Main files:

```text
lib/services/user_service.dart
lib/components/auth/login_screen.dart
lib/components/auth/register_screen.dart
```

### Bengali and Bangladesh Localization

Bengali support was strengthened for the Bangladesh deployment.

Improvements:

- Bengali is available as a primary user-facing language.
- Voice locale mapping includes Bengali (`bn_BD`).
- Language picker was changed from a dropdown to a bottom sheet to avoid menu overflow errors.
- Service categories fall back to English when Bengali labels return `null` or blank.

Main files:

```text
lib/services/i18n_service.dart
lib/components/shared/language_selector.dart
lib/services/service_tree_proxy.dart
lib/i18n/locales/bn.dart
```

Note: some non-English locale files still contain older Kenya/government-service strings. These should be cleaned if the final product scope is fully Bangladesh agriculture/weather.

### Handsfree Voice Mode

A handsfree mode was added for voice-only interaction.

What it does:

- Shows a handsfree button on the main/start page only.
- Opens a full-screen handsfree overlay.
- Listens to the user with speech-to-text.
- Sends the recognized query to the chat system.
- Reads the assistant response aloud with TTS.
- Saves the interaction in chat history without forcing the user into the normal text chat window.

Main files:

```text
lib/main.dart
lib/services/voice_conversation_service.dart
lib/components/chat/chatbot_component.dart
android/app/src/main/AndroidManifest.xml
```

Android permission added:

```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" />
```

Important note: Linux desktop does not fully support the same mobile speech/TTS plugins. The feature is intended for Android builds.

### Chat Map Responses

The chat can now respond to map-style prompts.

Example user prompt:

```text
show me the map of Dhaka
```

What happens:

- The app detects the map request.
- The location is geocoded using OpenStreetMap/Nominatim.
- A map card is rendered inside the chat.
- The map is zoomable and includes a marker for the requested place.

Main files:

```text
lib/components/chat/chatbot_component.dart
lib/services/geocoding_service.dart
pubspec.yaml
```

Dependencies added:

```yaml
flutter_map
latlong2
```

### Cleaner Chat Responses

The chat display and voice playback were improved so backend/LLM wrapper tags do not leak into the user experience.

Examples cleaned:

```text
<MEWA>...</MEWA>
markdown code blocks
HTML-like tags
link/markdown formatting for TTS
```

Main files:

```text
lib/components/chat/chatbot_component.dart
lib/services/voice_conversation_service.dart
```

### Service Tree and Sidebar Resilience

The app became more tolerant of inconsistent backend category/service data.

Improvements:

- Handles service tree items that are strings or maps.
- Replaces blank or `null` localized labels with fallback labels.
- Reduces `Unknown Category` and visible `null` rows after language changes.
- Preserves sidebar/chat history flow while improving data handling.

Main files:

```text
lib/services/service_tree_proxy.dart
lib/components/sidebar/service_tree_panel.dart
lib/components/sidebar/sidebar_component.dart
lib/components/sidebar/chat_folders_panel.dart
```

### Weather and Potato Alert Integration

The mobile app is part of a larger weather/potato early warning flow.

Current practical alert flow:

```text
short_term_potato_ews.py
  -> computes potato risk
  -> web app/mobile backend can display the alert
  -> optional Twilio SMS test sends the same warning text
```

Twilio SMS testing was added on the weather service side so a potato warning can be sent to phone numbers without needing Firebase push to be fully operational.

Main files outside the mobile folder:

```text
components/weather-mcp-service/scripts/test_potato_ews.py
components/weather-mcp-service/notifier.py
components/weather-mcp-service/requirements.txt
```

Example Twilio test:

```bash
cd /home/adas/Documents/mewa_v2/components/weather-mcp-service
export TWILIO_ACCOUNT_SID=ACxxxxxxxx
export TWILIO_AUTH_TOKEN=xxxxxxxx
export TWILIO_PHONE_FROM=+1234567890
python3 scripts/test_potato_ews.py --scenario heat --district Dhaka --send-sms --sms-to +8801XXXXXXXXX
```

### Notification Status Sanity Check

Firebase was explored and partially scaffolded, but it should not be described as the completed production notification path yet.

What exists now:

- Firebase config files and Gradle plugin were added.
- `firebase_core`, `firebase_messaging`, and `flutter_local_notifications` are present in the Flutter app.
- `NotificationService` has foreground/local notification hooks and a method to get an FCM token.
- A backend `/api/notifications/register` and `/api/notifications/broadcast` direction was started.
- `firebase-admin` was installed in `components/gov-chat-backend` and sending logic was drafted.

What is actually reliable right now:

- Web/app alert display through the existing backend/weather flow.
- Twilio SMS warning tests from the potato EWS script.
- Local/in-app notification plumbing in Flutter.

What still needs final verification before calling Firebase complete:

- Successful Android release build after resolving the current `file_picker` API regression.
- Physical Android install.
- Login registers the FCM token in `notificationDeviceTokens`.
- Backend Firebase Admin credentials are set on the server.
- `/api/notifications/broadcast` successfully sends to the device.

So the README should treat Firebase as **scaffolding/in progress**, while Twilio SMS is the practical alert route currently added for warning delivery.

## Android and Build Updates

Improvements added:

- NDK updated to `28.2.13676358`.
- Android microphone permission added.
- Cleartext traffic enabled for development/backend testing.
- Core library desugaring added for newer notification dependencies.
- Google services Gradle plugin added during Firebase setup exploration.

Main files:

```text
android/app/build.gradle
android/settings.gradle
android/app/src/main/AndroidManifest.xml
android/app/google-services.json
```

Current known build note:

- A recent `flutter build apk --release` failed because `user_profile_component.dart` still had old `file_picker` v12-incompatible calls:

```dart
FilePicker.platform
_filePicker.pickFiles(...)
```

Required fix:

```dart
FilePicker.pickFiles(...)
```

## How to Start

### 1. Open the App

Start the Flutter app on Android or Linux for development:

```bash
cd /home/adas/Documents/mewa_v2/mobile/genie_ai_mobile
flutter run
```

For web on Linux with Microsoft Edge:

```bash
export CHROME_EXECUTABLE=/usr/bin/microsoft-edge
flutter run -d chrome
```

### 2. Sign Up

From the login screen:

1. Tap **Register** or **Create account**.
2. Enter username, email, and password.
3. Submit the form.
4. Return to login after successful registration.

### 3. Log In

Use the username/password created during sign-up, or the backend-provided test/admin account if available.

After login, the app opens the AgroGenie Bangladesh main screen.

### 4. Try the Main Features

Example prompts to showcase the new capabilities:

```text
show me the map of Dhaka
```

```text
Show me the map of Sylhet
```

```text
What is the weather risk for potato farmers in Dhaka?
```

```text
Give me crop advice for potato farming in Bangladesh today.
```

```text
বাংলায় আজকের আবহাওয়া ও কৃষি পরামর্শ দিন
```

```text
What should farmers do during heavy rainfall in Bangladesh?
```

```text
Tell me about potato late blight risk.
```

### 5. Try Handsfree Mode

On the main/start page:

1. Tap **Handsfree**.
2. Speak a question.
3. Wait for the assistant to answer aloud.
4. Close with the X button when finished.

Try saying:

```text
What should potato farmers do today?
```

or in Bengali:

```text
আজ আলু চাষিদের কী করা উচিত?
```

Device note: Bengali speech recognition depends on Android/Google Speech Services language support installed on the phone.

### 6. Try Potato Warning SMS

From the weather service folder:

```bash
cd /home/adas/Documents/mewa_v2/components/weather-mcp-service
export TWILIO_ACCOUNT_SID=ACxxxxxxxx
export TWILIO_AUTH_TOKEN=xxxxxxxx
export TWILIO_PHONE_FROM=+1234567890
python3 scripts/test_potato_ews.py --scenario heat --district Dhaka --send-sms --sms-to +8801XXXXXXXXX
```

Scenarios:

```bash
python3 scripts/test_potato_ews.py --scenario heat --send-sms --sms-to +8801XXXXXXXXX
python3 scripts/test_potato_ews.py --scenario rain --send-sms --sms-to +8801XXXXXXXXX
python3 scripts/test_potato_ews.py --scenario combined --send-sms --sms-to +8801XXXXXXXXX
```

## Commands Run During Recent Work

These are the key commands run while comparing, documenting, and setting up notification-related work.

### Reference Comparison

```bash
git clone --filter=blob:none https://gitlab.com/fordendk/genie-ai-replica.git /tmp/genie-ai-reference
cd /tmp/genie-ai-reference
git checkout 1dd478044a9a2ef4b622360922be0d310298bf71
```

```bash
git diff --no-index --stat /tmp/genie-ai-reference/mobile/genie_ai_mobile /home/adas/Documents/mewa_v2/mobile/genie_ai_mobile
git diff --no-index --name-status /tmp/genie-ai-reference/mobile/genie_ai_mobile /home/adas/Documents/mewa_v2/mobile/genie_ai_mobile
```

### Flutter/Firebase Exploration

```bash
dart pub global activate flutterfire_cli
export PATH="$PATH:$HOME/.pub-cache/bin"
flutterfire configure
```

Firebase CLI was initially unavailable with:

```text
firebase: command not found
```

Suggested install command:

```bash
npm install -g firebase-tools
```

### Android/Firebase Gradle Setup

```bash
flutter build apk --release
```

Related edits were made in:

```text
android/settings.gradle
android/app/build.gradle
android/app/google-services.json
```

### Backend Firebase Admin Exploration

```bash
cd /home/adas/Documents/mewa_v2/components/gov-chat-backend
npm install firebase-admin --save
node --check services/notification-service.js
node --check routes/notification-routes.js
node -e "const pkg=require('./package.json'); console.log(pkg.dependencies['firebase-admin'])"
```

`npm install firebase-admin --save` completed, but npm reported existing dependency vulnerabilities. No broad `npm audit fix` was run because it can introduce breaking changes.

### Flutter Formatting and Build Check

```bash
cd /home/adas/Documents/mewa_v2/mobile/genie_ai_mobile
dart format lib/main.dart lib/services/notification_service.dart
flutter build apk --release
```

The last build failed on the unrelated `file_picker` API mismatch described above.

## Changes Made During Recent Notification Work

### `lib/main.dart`

Added:

- Firebase initialization with `DefaultFirebaseOptions.currentPlatform`.
- Top-level background message handler:

```dart
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async { ... }
```

- Registration of background FCM handler:

```dart
FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
```

- Token registration call after login:

```dart
NotificationService.registerDeviceForUser(user)
```

### `lib/services/notification_service.dart`

Added:

- `registerDeviceForUser(...)`.
- FCM token retrieval with `getDeviceToken()`.
- POST to backend:

```text
/api/notifications/register
```

- Default notification preferences:

```json
{
  "districts": ["Dhaka"],
  "crops": ["potato"],
  "alertTypes": ["weather_warning", "potato_ews"]
}
```

### `components/gov-chat-backend/services/notification-service.js`

Added/drafted:

- `firebase-admin` import.
- Firebase Admin SDK initialization using application default credentials or `FIREBASE_SERVICE_ACCOUNT_JSON`.
- `sendEachForMulticast(...)` path for FCM sends.
- Legacy `FCM_SERVER_KEY` fallback retained.

### `components/gov-chat-backend/package.json`

Added:

```json
"firebase-admin": "^13.9.0"
```

## Remaining Work

Before demo/release:

1. Fix `file_picker` v12 usage in `user_profile_component.dart`.
2. Re-run:

```bash
flutter build apk --release
```

3. Decide whether Firebase push is truly needed for the demo. If not, keep Twilio SMS as the warning delivery path.
4. If Firebase is needed, set backend credentials:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/opt/genie/firebase-service-account.json
```

5. Test on a physical Android device.
6. Confirm token registration in ArangoDB collection:

```text
notificationDeviceTokens
```

7. Test a warning flow:

```text
potato EWS -> notifier -> backend/web popup and/or Twilio SMS
```
