import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart'; // Needed for rootBundle
import 'package:flutter_localizations/flutter_localizations.dart'; // REQUIRED FOR I18N

// ===========================================================================
// SERVICE & UTILS IMPORTS
// ===========================================================================
import 'package:genie_ai_mobile/utils/theme_manager.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart'; // IMPORTED I18N SERVICE

// ===========================================================================
// AUTHENTICATION SCREEN IMPORTS
// ===========================================================================
import 'package:genie_ai_mobile/components/auth/login_screen.dart';
import 'package:genie_ai_mobile/components/auth/register_screen.dart';
import 'package:genie_ai_mobile/components/auth/registration_success_screen.dart';
import 'package:genie_ai_mobile/components/auth/password_reset_initiate_screen.dart';
import 'package:genie_ai_mobile/components/auth/password_reset_confirm_screen.dart';
import 'package:genie_ai_mobile/components/user/user_profile_component.dart';

// ===========================================================================
// COMPONENT IMPORTS
// ===========================================================================
import 'package:genie_ai_mobile/components/shared/nav_bar_component.dart';
import 'package:genie_ai_mobile/components/sidebar/sidebar_component.dart';
import 'package:genie_ai_mobile/components/chat/chatbot_component.dart';
// FIX: Corrected import path from 'chat' to 'sidebar'
import 'package:genie_ai_mobile/components/chat/right_sidebar_component.dart';
import 'package:genie_ai_mobile/components/settings/about_screen.dart';

// --- CONDITIONAL IMPORT FOR RIGHT SIDEBAR ---
// This handles the Web vs Mobile stubbing for File Utils indirectly referenced
// inside RightSidebarComponent.
// Note: Direct imports are usually handled inside the component files themselves,
// but we keep structure clean here.

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
  // Ensure binding is initialized for rootBundle access
  WidgetsFlutterBinding.ensureInitialized();

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
  // User session state
  Map<String, dynamic>? _user;
  bool _isConfigLoaded = false;

  @override
  void initState() {
    super.initState();
    _loadAppConfiguration();
  }

  /// Loads the theme configuration from assets and initializes ThemeManager
  Future<void> _loadAppConfiguration() async {
    try {
      debugPrint("[MAIN] Loading configuration...");
      final String configString =
          await rootBundle.loadString('assets/config/genie-ai-config.json');
      final Map<String, dynamic> config = json.decode(configString);

      // Initialize ThemeManager with the loaded config
      ThemeManager().setConfiguration(config);

      debugPrint("[MAIN] Configuration loaded successfully.");
    } catch (e) {
      debugPrint("[MAIN] Error loading configuration: $e");
      // Proceed with defaults if config fails
    } finally {
      if (mounted) {
        setState(() {
          _isConfigLoaded = true;
        });
      }
    }
  }

  void _toggleTheme() {
    // Delegate strictly to ThemeManager
    ThemeManager().toggleTheme();
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
    // Listen to ThemeManager AND I18nService for global changes
    return AnimatedBuilder(
      animation: Listenable.merge([ThemeManager(), I18nService()]),
      builder: (context, child) {
        // DEBUG: Confirm rebuild on language change
        debugPrint(
            "[MAIN] AnimatedBuilder rebuilding. Locale: ${I18nService().currentLocale.languageCode}");

        return MaterialApp(
          title: 'Genie AI',
          debugShowCheckedModeBanner: false,

          // I18n Configuration
          locale: I18nService().currentLocale,
          supportedLocales:
              I18nService().supportedLanguages.keys.map((code) => Locale(code)),

          // ADDED: Standard Flutter Localizations Delegates
          localizationsDelegates: const [
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],

          // Theme Configuration using dynamic properties from ThemeManager
          theme: ThemeManager().lightTheme,
          darkTheme: ThemeManager().darkTheme,
          themeMode: ThemeManager().themeMode,

          // Global Builder to handle Loading State without breaking Routes
          builder: (context, child) {
            if (!_isConfigLoaded) {
              return Scaffold(
                backgroundColor: ThemeManager().getColors()['background'],
                body: Center(
                  child: CircularProgressIndicator(
                    color: ThemeManager().getColors()['primary'],
                  ),
                ),
              );
            }
            return child!;
          },

          // Root Routing Logic
          home: _user == null
              ? LoginScreen(onLoginSuccess: _handleLogin)
              : MainScreen(
                  user: _user!,
                  isDarkMode: ThemeManager().isDarkMode,
                  toggleTheme: _toggleTheme,
                  onLogout: _handleLogout,
                ),

          // Defined Routes for Navigation
          routes: {
            '/login': (context) => LoginScreen(onLoginSuccess: _handleLogin),
            '/register': (context) => const RegisterScreen(),
            '/registration-success': (context) =>
                const RegistrationSuccessScreen(),
            '/password-reset': (context) => const PasswordResetInitiateScreen(),
            // Safety check: ensure _user is not null if accessed, though typically guarded by app logic
            '/profile': (context) => UserProfileScreen(user: _user ?? {}),
            '/about': (context) => const AboutScreen(),
            '/password-reset-confirm': (context) {
              final settings = ModalRoute.of(context)?.settings;
              final String? token = settings?.arguments as String?;
              if (token == null) {
                return const Scaffold(
                  body: Center(
                    child: Text("Invalid or missing reset token"),
                  ),
                );
              }
              return PasswordResetConfirmScreen(token: token);
            },
          },
        );
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
  // GlobalKey for programmatic control of ChatBotComponent
  final GlobalKey<ChatBotComponentState> _chatBotKey =
      GlobalKey<ChatBotComponentState>();

  // Current related documents from ChatBot
  List<dynamic> _currentRelatedDocuments = [];

  void _updateRelatedDocuments(List<dynamic> docs) {
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
    debugPrint("[MAIN] Conversation Selected: $conversationId");

    // Programmatically load conversation in the ChatBot
    _chatBotKey.currentState?.loadConversation(conversationId);
  }

  @override
  Widget build(BuildContext context) {
    // Responsive breakpoints
    final double screenWidth = MediaQuery.of(context).size.width;
    final bool isWideScreen = screenWidth > 1200;

    // Extract access token from user object (from login response)
    final String? accessToken =
        widget.user['accessToken'] ?? widget.user['token'];

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
              accessToken: accessToken,
            ),

      // Scrim and edge drag apply to both drawer and endDrawer
      drawerScrimColor: Colors.black54,
      drawerEdgeDragWidth: 40,

      body: Row(
        children: [
          // Persistent Left Sidebar on wide screens only
          if (isWideScreen)
            SizedBox(
              width:
                  420, // UPDATED: Increased width to 420 to fit translated tabs
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
              width: 420, // UPDATED: Kept consistent with Left Sidebar
              child: RightSidebarComponent(
                relatedDocuments: _currentRelatedDocuments,
                accessToken: accessToken,
              ),
            ),
        ],
      ),
    );
  }
}
