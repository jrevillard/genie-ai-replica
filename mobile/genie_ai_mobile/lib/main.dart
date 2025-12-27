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

/// SSL Override for local development to bypass self-signed certificate issues
class MyHttpOverrides extends HttpOverrides {
  @override
  HttpClient createHttpClient(SecurityContext? context) {
    return super.createHttpClient(context)
      ..badCertificateCallback =
          (X509Certificate cert, String host, int port) => true;
  }
}

void main() {
  // Apply the HTTP overrides for development environment
  HttpOverrides.global = MyHttpOverrides();
  runApp(const MyApp());
}

class MyApp extends StatefulWidget {
  const MyApp({super.key});

  @override
  State<MyApp> createState() => _MyAppState();
}

class _MyAppState extends State<MyApp> {
  // Theme state management
  bool _isDarkMode = false;

  // User session state
  Map<String, dynamic>? _user;

  void _toggleTheme() {
    setState(() {
      _isDarkMode = !_isDarkMode;
    });
    // Ensure the singleton is updated if used elsewhere
    ThemeManager().setTheme(_isDarkMode ? 'dark' : 'light');
  }

  void _handleLogin(Map<String, dynamic> user) {
    debugPrint("User logged in: ${user['email'] ?? 'unknown'}");
    setState(() {
      _user = user;
    });
  }

  void _handleLogout() {
    debugPrint("User logged out");
    setState(() {
      _user = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Genie AI',
      debugShowCheckedModeBanner: false,

      // Theme Configuration using the static methods from ThemeManager
      theme: ThemeManager.getLightTheme(),
      darkTheme: ThemeManager.getDarkTheme(),
      themeMode: _isDarkMode ? ThemeMode.dark : ThemeMode.light,

      // Root Routing Logic
      home: _user == null
          ? LoginScreen(onLoginSuccess: _handleLogin)
          : MainScreen(
              user: _user!,
              isDarkMode: _isDarkMode,
              toggleTheme: _toggleTheme,
              onLogout: _handleLogout,
            ),

      // Defined Routes for Navigation
      routes: {
        '/login': (context) => LoginScreen(onLoginSuccess: _handleLogin),
        '/register': (context) => const RegisterScreen(),
        '/registration-success': (context) => const RegistrationSuccessScreen(),
        '/forgot-password': (context) => const PasswordResetInitiateScreen(),

        // FIXED: Extract 'token' from arguments and pass to constructor
        '/reset-password': (context) {
          final args = ModalRoute.of(context)?.settings.arguments;
          final token = args is String ? args : '';
          return PasswordResetConfirmScreen(token: token);
        },
      },
    );
  }
}

class MainScreen extends StatefulWidget {
  final Map<String, dynamic> user;
  final bool isDarkMode;
  final VoidCallback toggleTheme;
  final VoidCallback onLogout;

  const MainScreen({
    super.key,
    required this.user,
    required this.isDarkMode,
    required this.toggleTheme,
    required this.onLogout,
  });

  @override
  State<MainScreen> createState() => _MainScreenState();
}

class _MainScreenState extends State<MainScreen> {
  // GlobalKey to access public methods of ChatBotComponent
  final GlobalKey<ChatBotComponentState> _chatBotKey =
      GlobalKey<ChatBotComponentState>();

  // State for Right Sidebar content
  List<dynamic> _currentRelatedDocuments = [];

  void _updateRelatedDocuments(List<dynamic> docs) {
    // Only update if there are changes to avoid unnecessary rebuilds
    setState(() {
      _currentRelatedDocuments = docs;
    });
  }

  void _refreshSidebar() {
    debugPrint("[MAIN] Sidebar refresh requested");
    // This can be expanded to refresh folders if needed via another GlobalKey
  }

  // ===========================================================================
  // EVENT HANDLERS: Sidebar -> ChatBot Communication
  // ===========================================================================

  /// Called when a service is selected in the ServiceTreePanel (Sidebar)
  void _onServiceSelected(Map<String, dynamic> service) {
    final String name = service['name'] ?? 'Unknown Service';
    // Use category_id if available (for API context), otherwise fallback to id
    final String id = service['category_id'] ?? service['id'] ?? '';

    debugPrint("[MAIN] Service Selected: $name (ID: $id)");

    // Programmatically set context in the ChatBot
    _chatBotKey.currentState?.setCategoryContext(id, name);
  }

  /// Called when a conversation is selected in ChatFoldersPanel (Sidebar)
  void _onConversationSelected(String conversationId) {
    debugPrint("[MAIN] Conversation Selected: $conversationId)");

    // Programmatically load conversation in the ChatBot
    _chatBotKey.currentState?.loadConversation(conversationId);
  }

  @override
  Widget build(BuildContext context) {
    // Responsive breakpoints
    final double screenWidth = MediaQuery.of(context).size.width;
    final bool isWideScreen = screenWidth > 1200;

    return Scaffold(
      appBar: PreferredSize(
        preferredSize: const Size.fromHeight(60),
        child: NavBarComponent(
          user: widget.user,
          onLogout: widget.onLogout,
          showRightDrawerButton: !isWideScreen, // Show only on mobile/tablet
        ),
      ),

      // Left sidebar as drawer on narrow screens
      drawer: isWideScreen
          ? null
          : SidebarComponent(
              user: widget.user,
              onServiceSelected: _onServiceSelected,
              onConversationSelected: _onConversationSelected,
            ),

      // Right sidebar as endDrawer on narrow screens
      endDrawer: isWideScreen
          ? null
          : RightSidebarComponent(
              relatedDocuments: _currentRelatedDocuments,
            ),

      // Scrim and edge drag apply to both drawer and endDrawer
      drawerScrimColor: Colors.black54,
      drawerEdgeDragWidth: 40,

      body: Row(
        children: [
          // Persistent Left Sidebar on wide screens only
          if (isWideScreen)
            SizedBox(
              width: 360,
              child: SidebarComponent(
                user: widget.user,
                onServiceSelected: _onServiceSelected,
                onConversationSelected: _onConversationSelected,
              ),
            ),

          // Center Chat Area – always visible
          Expanded(
            child: ChatBotComponent(
              key: _chatBotKey,
              userId: widget.user['id'] ?? widget.user['_id'],
              onRefreshSidebar: _refreshSidebar,
              onRelatedDocumentsUpdate: _updateRelatedDocuments,
            ),
          ),

          // Persistent Right Sidebar on wide screens only
          if (isWideScreen)
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
