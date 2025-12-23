import 'package:flutter/material.dart';
import 'package:genie_ai_mobile/components/auth/login_screen.dart';
import 'package:genie_ai_mobile/components/auth/register_screen.dart';
import 'package:genie_ai_mobile/components/auth/registration_success_screen.dart';
import 'package:genie_ai_mobile/components/auth/password_reset_initiate_screen.dart';
import 'package:genie_ai_mobile/components/auth/password_reset_confirm_screen.dart';
import 'package:genie_ai_mobile/components/shared/nav_bar_component.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';

void main() {
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
  bool _isAuthenticated = false; // Mirrors App.vue authentication state
  Map<String, dynamic>? _currentUser;

  void _handleLoginSuccess(Map<String, dynamic> user) {
    setState(() {
      _isAuthenticated = true;
      _currentUser = user; // Corresponds to handleLoginSuccess in App.vue
    });
  }

  void _handleLogout() {
    setState(() {
      _isAuthenticated = false;
      _currentUser = null; // Corresponds to handleLogout in App.vue
    });
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'GENIE.AI',
      debugShowCheckedModeBanner: false,
      themeMode: ThemeManager().themeMode, // Controlled by ThemeManager.js conversion
      theme: ThemeData(
        brightness: Brightness.light,
        primaryColor: const Color(0xFF4A90E2),
        scaffoldBackgroundColor: const Color(0xFFF5F7FA),
      ),
      darkTheme: ThemeData(
        brightness: Brightness.dark,
        primaryColor: const Color(0xFF1E3A58),
      ),
      // Base logic: If not authenticated, show login. If authenticated, show main shell
      home: _isAuthenticated 
          ? AuthenticatedShell(user: _currentUser!, onLogout: _handleLogout)
          : LoginScreen(onLoginSuccess: _handleLoginSuccess),
      
      // Full Route Table mirroring your Vue 3 router
      routes: {
        '/login': (context) => LoginScreen(onLoginSuccess: _handleLoginSuccess),
        '/register': (context) => const RegisterScreen(),
        '/registration-success': (context) => const RegistrationSuccessScreen(),
        '/forgot-password': (context) => const PasswordResetInitiateScreen(),
        // Reset password requires a token, typically handled via arguments or deep link
        '/reset-password': (context) {
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

  const AuthenticatedShell({super.key, required this.user, required this.onLogout});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: PreferredSize(
        preferredSize: const Size.fromHeight(60),
        child: NavBarComponent(user: user, onLogout: onLogout), // Integrated NavBar
      ),
      // Sidebar and Chatbot components will be plugged in here next
      drawer: const Drawer(child: Center(child: Text("SideBar Component Placeholder"))),
      body: const Center(child: Text("Chatbot View Component Placeholder")),
    );
  }
}