import 'dart:io';
import 'package:flutter/material.dart';

// Service & Utils Imports
import 'package:genie_ai_mobile/utils/theme_manager.dart';

// Auth Screen Imports
import 'package:genie_ai_mobile/components/auth/login_screen.dart';
import 'package:genie_ai_mobile/components/auth/register_screen.dart';
import 'package:genie_ai_mobile/components/auth/registration_success_screen.dart';
import 'package:genie_ai_mobile/components/auth/password_reset_initiate_screen.dart';
import 'package:genie_ai_mobile/components/auth/password_reset_confirm_screen.dart';

// Component Imports
import 'package:genie_ai_mobile/components/shared/nav_bar_component.dart';

/// SSL Override to bypass certificate issues for local Nginx development
class MyHttpOverrides extends HttpOverrides {
  @override
  HttpClient createHttpClient(SecurityContext? context) {
    return super.createHttpClient(context)
      ..badCertificateCallback = (X509Certificate cert, String host, int port) => true;
  }
}

void main() {
  // Apply SSL overrides before the app starts
  HttpOverrides.global = MyHttpOverrides();
  
  runApp(
    ListenableBuilder(
      listenable: ThemeManager(), // Listens for theme changes
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
  bool _isAuthenticated = false; // Mirrors Vue App.vue state
  Map<String, dynamic>? _currentUser;

  /// Logic for successful login from LoginScreen
  void _handleLoginSuccess(Map<String, dynamic> user) {
    setState(() {
      _isAuthenticated = true;
      _currentUser = user;
    });
  }

  /// Global logout handler
  void _handleLogout() {
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
      
      // FIXED: Uses the ThemeMode enum provided by your ThemeManager
      themeMode: themeManager.themeMode, 
      
      theme: ThemeData(
        brightness: Brightness.light,
        primaryColor: const Color(0xFF4A90E2),
        scaffoldBackgroundColor: const Color(0xFFF5F7FA),
        appBarTheme: const AppBarTheme(backgroundColor: Color(0xFF4E97D1)),
      ),
      
      darkTheme: ThemeData(
        brightness: Brightness.dark,
        primaryColor: const Color(0xFF1E3A58),
        scaffoldBackgroundColor: const Color(0xFF1E1E1E),
      ),

      // Landing logic: If auth is missing, show Login. Otherwise, show Shell
      home: _isAuthenticated 
          ? AuthenticatedShell(user: _currentUser!, onLogout: _handleLogout)
          : LoginScreen(onLoginSuccess: _handleLoginSuccess),
      
      // Complete Route Table mirroring your Vue 3 navigation
      routes: {
        '/login': (context) => LoginScreen(onLoginSuccess: _handleLoginSuccess),
        '/register': (context) => const RegisterScreen(),
        '/registration-success': (context) => const RegistrationSuccessScreen(),
        '/forgot-password': (context) => const PasswordResetInitiateScreen(),
        '/reset-password': (context) {
          // Extracts token from route arguments for the password confirmation screen
          final args = ModalRoute.of(context)!.settings.arguments as Map<String, dynamic>?;
          return PasswordResetConfirmScreen(token: args?['token'] ?? '');
        },
      },
      
    );
  }
}

/// The Main Layout Shell for authenticated users
class AuthenticatedShell extends StatelessWidget {
  final Map<String, dynamic> user;
  final VoidCallback onLogout;

  const AuthenticatedShell({
    super.key, 
    required this.user, 
    required this.onLogout
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: PreferredSize(
        preferredSize: const Size.fromHeight(60),
        child: NavBarComponent(
          user: user, 
          onLogout: onLogout
        ), // Integrated NavBar with status and admin roles
      ),
      // The Sidebar and Chatbot components will be plugged in here next
      drawer: const Drawer(
        child: Center(child: Text("SideBar Component Placeholder")),
      ),
      body: const Center(
        child: Text("Chatbot View Component Placeholder"),
      ),
    );
  }
}