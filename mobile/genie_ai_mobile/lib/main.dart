import 'dart:io';

import 'package:flutter/material.dart';

// ===========================================================================
// SERVICE & UTILS IMPORTS
// ===========================================================================
import 'package:genie_ai_mobile/utils/theme_manager.dart';

// ===========================================================================
// AUTHENTICATION SCREEN IMPORTS
// ===========================================================================
import 'package:genie_ai_mobile/components/auth/login_screen.dart';
import 'package:genie_ai_mobile/components/auth/register_screen.dart';
import 'package:genie_ai_mobile/components/auth/registration_success_screen.dart';
import 'package:genie_ai_mobile/components/auth/password_reset_initiate_screen.dart';
import 'package:genie_ai_mobile/components/auth/password_reset_confirm_screen.dart';

// ===========================================================================
// COMPONENT IMPORTS
// ===========================================================================
import 'package:genie_ai_mobile/components/shared/nav_bar_component.dart';
import 'package:genie_ai_mobile/components/sidebar/sidebar_component.dart';
import 'package:genie_ai_mobile/components/chat/chatbot_component.dart';
import 'package:genie_ai_mobile/components/chat/right_sidebar_component.dart';

/// SSL Override for local development
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
  HttpOverrides.global = MyHttpOverrides();

  runApp(
    ListenableBuilder(
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
  bool _isAuthenticated = false;
  Map<String, dynamic>? _currentUser;

  void _handleLoginSuccess(Map<String, dynamic> user) {
    debugPrint(
        "[AUTH] User logged in successfully. Updating application state...");
    setState(() {
      _isAuthenticated = true;
      _currentUser = user;
    });
  }

  void _handleLogout() {
    debugPrint("[AUTH] User logged out. Clearing local session data...");
    setState(() {
      _isAuthenticated = false;
      _currentUser = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final themeManager = ThemeManager();

    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Genie AI',
      themeMode: themeManager.themeMode,
      theme: ThemeData(
        brightness: Brightness.light,
        primaryColor: const Color(0xFF4A90E2),
        scaffoldBackgroundColor: const Color(0xFFF5F7FA),
        appBarTheme: const AppBarTheme(
          backgroundColor: Color(0xFF4E97D1),
          elevation: 4,
        ),
      ),
      darkTheme: ThemeData(
        brightness: Brightness.dark,
        primaryColor: const Color(0xFF1E3A58),
        scaffoldBackgroundColor: const Color(0xFF1E1E1E),
        appBarTheme: const AppBarTheme(
          backgroundColor: Color(0xFF2C5F8A),
          elevation: 4,
        ),
      ),
      home: _isAuthenticated
          ? AuthenticatedShell(user: _currentUser!, onLogout: _handleLogout)
          : LoginScreen(onLoginSuccess: _handleLoginSuccess),
      routes: {
        '/login': (context) => LoginScreen(onLoginSuccess: _handleLoginSuccess),
        '/register': (context) => const RegisterScreen(),
        '/registration-success': (context) => const RegistrationSuccessScreen(),
        '/forgot-password': (context) => const PasswordResetInitiateScreen(),
        '/reset-password': (context) {
          final args = ModalRoute.of(context)!.settings.arguments
              as Map<String, dynamic>?;
          return PasswordResetConfirmScreen(token: args?['token'] ?? '');
        },
      },
    );
  }
}

// ===========================================================================
// AUTHENTICATED SHELL - Full Layout with Sidebars + ChatBot
// ===========================================================================
class AuthenticatedShell extends StatefulWidget {
  final Map<String, dynamic> user;
  final VoidCallback onLogout;

  const AuthenticatedShell({
    super.key,
    required this.user,
    required this.onLogout,
  });

  @override
  State<AuthenticatedShell> createState() => _AuthenticatedShellState();
}

class _AuthenticatedShellState extends State<AuthenticatedShell> {
  List<dynamic> _currentRelatedDocuments = [];

  void _updateRelatedDocuments(List<dynamic> docs) {
    setState(() {
      _currentRelatedDocuments = docs;
    });
  }

  void _refreshSidebar() {
    debugPrint("[MAIN] Sidebar refresh requested");
  }

  @override
  Widget build(BuildContext context) {
    final bool isWideScreen = MediaQuery.of(context).size.width > 1200;

    return Scaffold(
      appBar: PreferredSize(
        preferredSize: const Size.fromHeight(60),
        child: NavBarComponent(user: widget.user, onLogout: widget.onLogout),
      ),
      drawer: isWideScreen ? null : SidebarComponent(user: widget.user),
      body: Row(
        children: [
          // Left Sidebar — visible on wide screens, drawer on mobile
          if (isWideScreen)
            SizedBox(
              width: 300,
              child: SidebarComponent(user: widget.user),
            ),

          // Center: ChatBot — passes required userId and callbacks
          Expanded(
            child: ChatBotComponent(
              userId: widget.user['id'] ?? widget.user['_id'],
              onRefreshSidebar: _refreshSidebar,
              onRelatedDocumentsUpdate: _updateRelatedDocuments,
            ),
          ),

          // Right Sidebar — now receives live related documents
          SizedBox(
            width: 360,
            child: RightSidebarComponent(
              relatedDocuments: _currentRelatedDocuments,
            ),
          ),
        ],
      ),
    );
  }
}
