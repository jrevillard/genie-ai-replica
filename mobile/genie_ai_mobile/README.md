# **GENIE.AI Mobile Application**

Author: David Forden (ITU)  
Framework: Flutter (Dart)  
Target Platforms: Android, iOS, Web

## **1\. Overview**

The GENIE.AI mobile application serves as the mobile interface for the ITU GENIE platform. It utilizes a Flutter frontend to communicate with the GENIE RAG Framework API.

This document outlines the setup, development, building, and deployment processes, with specific attention to resolving common Windows-based build errors.

## ---

**2\. Prerequisites & Environment Setup**

Before starting, ensure you have the following installed:

* **Flutter SDK:** (Version 3.5.x or higher)  
* **VS Code:** With the *Flutter* and *Dart* extensions installed.  
* **Android Studio:** Required only for the Android SDK and Command Line Tools.  
* **Java JDK:** Version 11 or 17 (Compatible with Gradle).  
* **Git:** For version control.

### **Critical VS Code Settings**

To minimize file locking issues on Windows, disable "Hot Exit" or aggressive file watching if builds fail frequently.

## ---

**3\. Configuration**

### **3.1. Pubspec.yaml**

Ensure all assets are explicitly registered. Note the specific inclusion of the i18n folder.

YAML

flutter:  
  assets:  
    \- assets/config/  
    \- assets/config/quickhelp/  
    \- assets/i18n/en.json  \# Crucial for mobile builds  
    \- assets/images/

### **3.2. Android Manifest (android/app/src/main/AndroidManifest.xml)**

For Release builds to function correctly, the following permissions **must** be present.

XML

\<manifest ...\>  
    \<uses-permission android:name\="android.permission.INTERNET" /\>

    \<application  
        ...  
        android:usesCleartextTraffic\="true"\>  
        ...  
    \</application\>  
\</manifest\>

### **3.3. Asset Handling (Web vs. Mobile)**

Due to how Flutter packages assets, Web and Mobile require different pathing strategies. Use the kIsWeb check in your code (e.g., chatbot\_component.dart):

Dart

import 'package:flutter/foundation.dart';

// ...  
final String assetPath \= kIsWeb ? 'i18n/en.json' : 'assets/i18n/en.json';  
final String jsonString \= await rootBundle.loadString(assetPath);

## ---

**4\. Development Workflow**

### **Running on Web**

The Web build is the fastest way to test UI logic, though it handles CORS and Assets differently than mobile.

Bash

flutter run \-d chrome

### **Running on Android (Debug)**

Connect your Android device via USB and enable **USB Debugging**.

Bash

flutter run

*Note: In Debug mode, Flutter automatically adds Internet permissions. Do not assume it works in Release mode just because it works here.*

## ---

**5\. Building for Android (Release)**

### **⚠️ The Windows "File Lock" Issue**

On Windows, the Gradle Daemon, VS Code, and OneDrive often fight over file locks, causing OS Error 32 during builds.

**The Fix:**

1. **Disable Gradle Daemon:** Ensure android/gradle.properties contains org.gradle.daemon=false.  
2. **Use the "Nuke" Script:** We utilize a PowerShell script to kill zombie processes, clean the build, and compile in one step.

### **Step-by-Step Build Instructions**

1. **Close VS Code.** (Crucial to release file handles).  
2. **Open PowerShell** (External Terminal).  
3. **Navigate** to the project directory:  
   PowerShell  
   cd C:\\Dev\\genie\_ai\_mobile

4. **Run the Build Script:**  
   PowerShell  
   .\\build-release.ps1

**Content of build-release.ps1:**

PowerShell

Write-Host "--- KILLING ZOMBIE PROCESSES \---" \-ForegroundColor Red  
taskkill /F /IM java.exe 2\>$null  
taskkill /F /IM dart.exe 2\>$null  
taskkill /F /IM flutter.bat 2\>$null

Write-Host "--- CLEANING PROJECT \---" \-ForegroundColor Yellow  
flutter clean

Write-Host "--- BUILDING RELEASE APK \---" \-ForegroundColor Green  
\# \--no-tree-shake-icons prevents errors with dynamic icon rendering  
flutter build apk \-\-no-tree-shake-icons

Write-Host "--- DONE \---" \-ForegroundColor Cyan

### **installing on Device**

After a successful build, the APK is located at:  
build/app/outputs/flutter-apk/app-release.apk  
To install:

Bash

flutter install

## ---

**6\. Building for iOS**

**Requirement:** macOS is strictly required. You cannot build iOS apps on Windows.

### **Option A: Cloud Build (Recommended for Windows Users)**

1. Push code to a private Git repository.  
2. Connect repository to a CI/CD service like **Codemagic**.  
3. Configure Codemagic to build ios workflow.  
4. Download the .ipa file.

### **Option B: Local Build (Mac Hardware)**

1. Transfer project to a Mac.  
2. Run flutter build ios \--no-tree-shake-icons.  
3. Open ios/Runner.xcworkspace in Xcode to archive and sign.

## ---

**7\. Troubleshooting & "War Stories"**

This section documents specific errors encountered during development and their solutions.

### **7.1. OS Error 32: The process cannot access the file**

* **Cause:** Windows file locking by Java, Dart, VS Code, or OneDrive.  
* **Solution:** Close VS Code. Run the build-release.ps1 script from an external terminal. If persistent, move project folder out of C:\\Users\\ to C:\\Dev\\.

### **7.2. Failed host lookup (errno \= 7\)**

* **Context:** App works in Debug, fails in Release.  
* **Cause:** Missing Internet permission in Release manifest.  
* **Solution:** Add \<uses-permission android:name="android.permission.INTERNET" /\> to AndroidManifest.xml.

### **7.3. HandshakeException: Certificate\_verify\_failed**

* **Context:** App cannot connect to API, but Chrome browser on phone works.  
* **Cause:**  
  1. Using an IP address (164.x.x.x) instead of the domain (genie-ai.itu.int) which mismatches the SSL cert.  
  2. Server missing Intermediate Certificates chain.  
* **Solution:** Always use the full Domain Name in api\_service.dart. Ensure Nginx serves the fullchain certificate.

### **7.4. Cleartext HTTP traffic not permitted**

* **Cause:** Android blocks HTTP (non-HTTPS) traffic by default.  
* **Solution:** Use HTTPS. If HTTP is required for testing, add android:usesCleartextTraffic="true" to the \<application\> tag in Manifest.

### **7.5. Asset Not Found (Web vs Mobile)**

* **Cause:** Web uses relative paths from root, Android uses assets/ folder structure.  
* **Solution:** Use kIsWeb conditional logic in Dart to switch path strings dynamically.

### **7.6. Target aot\_android\_asset\_bundle failed: IconData**

* **Cause:** Tree shaking tries to remove unused icons but fails on dynamic icon maps.  
* **Solution:** Add flag \--no-tree-shake-icons to the build command.

## ---

**8\. Deployment to App Stores**

### **8.1. Google Play Store (Android)**

1. **Signing:**  
   * Create a keystore: keytool \-genkey \-v \-keystore upload-keystore.jks ...  
   * Create android/key.properties referencing the keystore.  
   * Update android/app/build.gradle to use the keystore configuration.  
2. Build App Bundle:  
   Instead of APK, build an AAB for the store:  
   Bash  
   flutter build appbundle \--no-tree-shake-icons

3. **Upload:**  
   * Go to **Google Play Console**.  
   * Create a release track (Production or Internal Testing).  
   * Upload the .aab file.

### **8.2. Apple App Store (iOS)**

1. **Apple Developer Account:** Requires $99/year membership.  
2. **Signing:**  
   * Create an App ID in Apple Developer Portal.  
   * Create a Distribution Certificate and Provisioning Profile.  
3. **Build & Archive:**  
   * (On Mac/Codemagic) Build the .ipa.  
   * Use **Transporter** (Mac app) or Xcode to upload the build to **App Store Connect**.  
4. **TestFlight:**  
   * Before public release, add users to TestFlight in App Store Connect to let them test the app.