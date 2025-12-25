import 'dart:io';
import 'package:flutter/material.dart';

// ===========================================================================
// SERVICE & UTILS IMPORTS
// ===========================================================================
import 'package:genie_ai_mobile/utils/theme_manager.dart';

// ===========================================================================
// AUTHENTICATION SCREEN IMPORTS - Mirrored from Vue 3 Router logic
// ===========================================================================
import 'package:genie_ai_mobile/components/auth/login_screen.dart';
import 'package:genie_ai_mobile/components/auth/register_screen.dart';
import 'package:genie_ai_mobile/components/auth/registration_success_screen.dart';
import 'package:genie_ai_mobile/components/auth/password_reset_initiate_screen.dart';
import 'package:genie_ai_mobile/components/auth/password_reset_confirm_screen.dart';

// ===========================================================================
// COMPONENT IMPORTS - Integrated Sidebar and Navigation
// ===========================================================================
import 'package:genie_ai_mobile/components/shared/nav_bar_component.dart';
import 'package:genie_ai_mobile/components/sidebar/sidebar_component.dart';

/// SSL Override to bypass certificate issues for local Nginx development
/// This ensures local API testing on web/android works without certificate errors.
class MyHttpOverrides extends HttpOverrides {
  @override
  HttpClient createHttpClient(SecurityContext? context) {
    return super.createHttpClient(context)
      ..badCertificateCallback =
          (X509Certificate cert, String host, int port) => true;
  }
}

// ===========================================================================
// MAIN ENTRY POINT
// ===========================================================================
void main() {
  // Apply SSL overrides before the app starts to allow insecure local connections
  HttpOverrides.global = MyHttpOverrides();

  runApp(
    ListenableBuilder(
      // The app rebuilds automatically when ThemeManager() notifies listeners
      listenable: ThemeManager(),
      builder: (context, child) => const GenieAIApp(),
    ),
  );
}

class GenieAIApp extends StatefulWidget {
  const GenieAIApp({super.key});

  @override
  State<GenieAIApp> createState() => _GenieAIAppState();
}

class _GenieAIAppState extends State<GenieAIApp> {
  // ===========================================================================
  // GLOBAL APP STATE - Mirrored exactly from Vue App.vue data()
  // ===========================================================================
  bool _isAuthenticated = false;
  Map<String, dynamic>? _currentUser;

  /// Triggered after successful Login API call
  void _handleLoginSuccess(Map<String, dynamic> user) {
    debugPrint(
        "[AUTH] User logged in successfully. Updating application state...");
    setState(() {
      _isAuthenticated = true;
      _currentUser = user;
    });
  }

  /// Global logout handler: clears session and returns to login screen
  void _handleLogout() {
    debugPrint("[AUTH] User logged out. Clearing local session data...");
    setState(() {
      _isAuthenticated = false;
      _currentUser = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    // Access the singleton instance to ensure 'themeMode' getter is recognized
    final themeManager = ThemeManager();

    return MaterialApp(
      title: 'GENIE.AI',
      debugShowCheckedModeBanner: false,

      // FIXED: Uses the ThemeMode enum provided by your ThemeManager for system/light/dark sync
      themeMode: themeManager.themeMode,

      // Light Theme Definition
      theme: ThemeData(
        brightness: Brightness.light,
        primaryColor: const Color(0xFF4A90E2),
        scaffoldBackgroundColor: const Color(0xFFF5F7FA),
        appBarTheme: const AppBarTheme(
          backgroundColor: Color(0xFF4E97D1),
          elevation: 4,
        ),
      ),

      // Dark Theme Definition
      darkTheme: ThemeData(
        brightness: Brightness.dark,
        primaryColor: const Color(0xFF1E3A58),
        scaffoldBackgroundColor: const Color(0xFF1E1E1E),
        appBarTheme: const AppBarTheme(
          backgroundColor: Color(0xFF2C5F8A),
          elevation: 4,
        ),
      ),

      // LANDING LOGIC: Checks authentication state to determine view
      home: _isAuthenticated
          ? AuthenticatedShell(user: _currentUser!, onLogout: _handleLogout)
          : LoginScreen(onLoginSuccess: _handleLoginSuccess),

      // COMPLETE ROUTE TABLE: Replicating Vue 3 Router configuration
      routes: {
        '/login': (context) => LoginScreen(onLoginSuccess: _handleLoginSuccess),
        '/register': (context) => const RegisterScreen(),
        '/registration-success': (context) => const RegistrationSuccessScreen(),
        '/forgot-password': (context) => const PasswordResetInitiateScreen(),
        '/reset-password': (context) {
          // Extracts token from route arguments for the password confirmation screen
          final args = ModalRoute.of(context)!.settings.arguments
              as Map<String, dynamic>?;
          return PasswordResetConfirmScreen(token: args?['token'] ?? '');
        },
      },
    );
  }
}

// ===========================================================================
// AUTHENTICATED SHELL - Main Application Layout with Navigation
// ===========================================================================
class AuthenticatedShell extends StatelessWidget {
  final Map<String, dynamic> user;
  final VoidCallback onLogout;

  const AuthenticatedShell(
      {super.key, required this.user, required this.onLogout});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      // INTEGRATED NAVBAR: Handles status, profile, and settings triggers
      appBar: PreferredSize(
        preferredSize: const Size.fromHeight(60),
        child: NavBarComponent(user: user, onLogout: onLogout),
      ),

      // INTEGRATED SIDEBAR: Replicated full government services and history logic
      // Passing the user object to ensure chat history is filtered by userId correctly.
      drawer: SidebarComponent(user: user),

      // MAIN CONTENT AREA
      body: const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.chat_outlined, size: 48, color: Colors.grey),
            SizedBox(height: 16),
            Text(
              "Chatbot View Component Placeholder",
              style: TextStyle(
                  color: Colors.grey,
                  fontSize: 16,
                  fontWeight: FontWeight.w500),
            ),
            SizedBox(height: 8),
            Text(
              "Integrated with Government Service Tree Selection",
              style: TextStyle(color: Colors.grey, fontSize: 12),
            ),
          ],
        ),
      ),
    );
  }
}
