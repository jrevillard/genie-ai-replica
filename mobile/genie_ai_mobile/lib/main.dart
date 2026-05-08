import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart'; // For kIsWeb check
import 'package:flutter/material.dart';
import 'package:flutter/services.dart'; // Needed for rootBundle
import 'package:flutter_localizations/flutter_localizations.dart'; // REQUIRED FOR I18N

// ===========================================================================
// SERVICE & UTILS IMPORTS
// ===========================================================================
import 'package:genie_ai_mobile/utils/theme_manager.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
import 'package:genie_ai_mobile/services/connectivity_service.dart'; // ADDED
import 'package:genie_ai_mobile/services/fallback_localizations.dart';

// ===========================================================================
// AUTHENTICATION SCREEN IMPORTS
// ===========================================================================
import 'package:genie_ai_mobile/components/auth/oidc_login_screen.dart';
import 'package:genie_ai_mobile/services/genie_ai_config.dart';
import 'package:genie_ai_mobile/components/user/user_profile_component.dart';
import 'package:genie_ai_mobile/services/auth/auth_providers.dart';
import 'package:genie_ai_mobile/services/auth/auth_state.dart';
import 'package:app_links/app_links.dart';
import 'package:url_launcher/url_launcher.dart';

// ===========================================================================
// COMPONENT IMPORTS
// ===========================================================================
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:genie_ai_mobile/components/shared/nav_bar_component.dart';
import 'package:genie_ai_mobile/components/sidebar/sidebar_component.dart';
import 'package:genie_ai_mobile/components/chat/chatbot_component.dart';
import 'package:genie_ai_mobile/components/chat/right_sidebar_component.dart';
import 'package:genie_ai_mobile/components/settings/about_screen.dart';

/// DEBUG ONLY: Bypasses TLS validation for local development with self-signed
/// certificates. Tree-shaken in release builds — unused when kDebugMode is false.
class _DebugHttpOverrides extends HttpOverrides {
  @override
  HttpClient createHttpClient(SecurityContext? context) {
    return super.createHttpClient(context)
      ..badCertificateCallback =
          (X509Certificate cert, String host, int port) => true;
  }
}

void main() async {
  // Ensure binding is initialized for rootBundle access
  WidgetsFlutterBinding.ensureInitialized();

  // DEBUG ONLY: Bypass TLS for local dev with self-signed certificates.
  // kDebugMode is a compile-time constant — this entire block is
  // tree-shaken from release builds.
  if (kDebugMode && !kIsWeb) {
    HttpOverrides.global = _DebugHttpOverrides();
  }

  // Initialize Connectivity (Online/Offline)
  await ConnectivityService().init();

  runApp(
    const ProviderScope(
      child: MyApp(),
    ),
  );
}

class MyApp extends ConsumerStatefulWidget {
  const MyApp({super.key});

  @override
  ConsumerState<MyApp> createState() => _MyAppState();
}

class _MyAppState extends ConsumerState<MyApp> {
  bool _isConfigLoaded = false;
  late final AppLinks _appLinks;
  StreamSubscription<Uri>? _appLinkSubscription;

  @override
  void initState() {
    super.initState();
    _appLinks = AppLinks();

    // Handle cold-start links (app launched from terminated state via universal link)
    _appLinks.getInitialLink().then((Uri? link) {
      if (link != null) {
        _handleIncomingLink(link);
      }
    });

    // Handle warm-start links (app already running in background)
    _appLinkSubscription = _appLinks.uriLinkStream.listen(
      _handleIncomingLink,
      onError: (Object error) {
        debugPrint('[APPLINKS] Stream error: $error');
      },
    );

    _loadAppConfiguration();
  }

  Future<void> _handleIncomingLink(Uri uri) async {
    // DEBUG ONLY: E2E test-auth deep link — inject tokens directly into storage.
    // kDebugMode is a compile-time constant — this block is tree-shaken in release.
    // Path: genie-e2e-test://test-auth?access_token=...&id_token=...&refresh_token=...&expires_at=...
    // Uses a dedicated scheme to avoid conflict with flutter_appauth's
    // RedirectUriReceiverActivity which owns the appAuthRedirectScheme.
    //
    // NOTE: This bypasses AuthNotifier's normal state transition logic
    // (authorize → token exchange → authenticated). It sets the state
    // directly because invalidate() re-runs build() and crashes on late
    // final fields. This is acceptable for E2E because the test-only
    // deep link scheme cannot be triggered in production.
    if (kDebugMode && uri.host == 'test-auth') {
      final tokenStorage = ref.read(tokenStorageProvider);
      final accessToken = uri.queryParameters['access_token'];
      final idToken = uri.queryParameters['id_token'];
      final refreshToken = uri.queryParameters['refresh_token'];
      final expiresAt = uri.queryParameters['expires_at'];
      if (accessToken != null && idToken != null && refreshToken != null) {
        final expiration = expiresAt != null
            ? DateTime.tryParse(expiresAt) ?? DateTime.now().add(const Duration(seconds: 300))
            : DateTime.now().add(const Duration(seconds: 300));
        await tokenStorage.saveTokens(
          accessToken: accessToken,
          idToken: idToken,
          refreshToken: refreshToken,
          accessTokenExpiration: expiration,
        );
        // Set authenticated state directly — avoid invalidate() which
        // re-runs build() and crashes on late final fields.
        ref.read(authProvider.notifier).state = const AuthState.authenticated();
        debugPrint('[TEST-AUTH] Tokens injected via deep link, expiration: $expiration');
      } else {
        debugPrint('[TEST-AUTH] Missing token parameters in deep link');
      }
      return;
    }

    // OIDC callbacks use custom scheme (e.g., com.itu.genieai://callback)
    // These are handled internally by flutter_appauth — do NOT process them here
    if (uri.scheme != 'https') return;

    // Non-OIDC HTTPS links (email verification, etc.) → open in system browser
    try {
      final launched = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (launched) {
        debugPrint('[APPLINKS] Launched system browser for: $uri');
      } else {
        debugPrint('[APPLINKS] Failed to launch browser for: $uri (no browser app available)');
      }
    } catch (e) {
      debugPrint('[APPLINKS] Error launching browser: $e');
    }
  }

  @override
  void dispose() {
    _appLinkSubscription?.cancel();
    super.dispose();
  }

  /// Loads the theme configuration from assets and initializes ThemeManager
  Future<void> _loadAppConfiguration() async {
    try {
      debugPrint("[MAIN] Loading configuration...");
      final String configString = await rootBundle.loadString(
        'assets/config/genie-ai-config.json',
      );
      final Map<String, dynamic> config = json.decode(configString);

      // Initialize ThemeManager with the loaded config
      ThemeManager().setConfiguration(config);

      // Load GenieAiConfig for branding (iconPath, title) used by OidcLoginScreen
      await GenieAiConfig.load();

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
    ThemeManager().toggleTheme();
  }

  void _onLogout() {
    ref.read(authProvider.notifier).logout();
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authProvider);

    return AnimatedBuilder(
      animation: Listenable.merge([ThemeManager(), I18nService()]),
      builder: (context, child) {
        return MaterialApp(
          title: 'Genie AI',
          debugShowCheckedModeBanner: false,
          locale: I18nService().currentLocale,
          supportedLocales: I18nService().supportedLanguages.keys.map(
            (code) => Locale(code),
          ),
          localizationsDelegates: const [
            FallbackMaterialLocalizationsDelegate(),
            FallbackWidgetsLocalizationsDelegate(),
            GlobalCupertinoLocalizations.delegate,
          ],
          theme: ThemeManager().lightTheme,
          darkTheme: ThemeManager().darkTheme,
          themeMode: ThemeManager().themeMode,
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
          home: authState.status == AuthStatus.authenticated
              ? MainScreen(
                  // TODO(Epic 2): accessToken is empty until AuthInterceptor
                  // provides real tokens to downstream components.
                  user: {
                    'id': authState.userId ?? '',
                    'accessToken': '',
                  },
                  isDarkMode: ThemeManager().isDarkMode,
                  toggleTheme: _toggleTheme,
                  onLogout: _onLogout,
                  httpClient: ref.read(apiServiceProvider).httpClient,
                  streamBaseUrl: ref.read(apiServiceProvider).baseUrl,
                )
              : const OidcLoginScreen(),
          routes: {
            '/login': (context) => const OidcLoginScreen(),
            '/profile': (context) => UserProfileScreen(
              user: {'id': authState.userId ?? ''},
            ),
            '/about': (context) => const AboutScreen(),
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
  final http.Client? httpClient;
  final String? streamBaseUrl;

  const MainScreen({
    super.key,
    required this.user,
    required this.isDarkMode,
    required this.toggleTheme,
    required this.onLogout,
    this.httpClient,
    this.streamBaseUrl,
  });

  @override
  State<MainScreen> createState() => _MainScreenState();
}

class _MainScreenState extends State<MainScreen> with WidgetsBindingObserver {
  final GlobalKey<ChatBotComponentState> _chatBotKey =
      GlobalKey<ChatBotComponentState>();

  List<dynamic> _currentRelatedDocuments = [];

  // Connectivity state
  StreamSubscription<bool>? _connectivitySubscription;
  bool _isOnline = true;

  @override
  void initState() {
    super.initState();
    // 1. Observe lifecycle for App Resume -> Recheck Connectivity
    WidgetsBinding.instance.addObserver(this);

    // 2. Initialize current state
    _isOnline = ConnectivityService().isOnline;

    // 3. Listen to Connectivity Stream for Sync Trigger
    _connectivitySubscription = ConnectivityService().isOnlineStream.listen((
      isOnline,
    ) {
      if (mounted) {
        setState(() {
          _isOnline = isOnline;
        });

        if (isOnline) {
          debugPrint(
            "[MAIN] App is Online. Placeholder for future Sync Trigger.",
          );
          // TODO: TRIGGER SYNC SERVICE HERE WHEN IMPLEMENTED
          // e.g. SyncService().syncPendingData();
        }
      }
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _connectivitySubscription?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      debugPrint("[MAIN] App resumed. Rechecking connectivity...");
      ConnectivityService().recheckConnectivity();
    }
  }

  void _updateRelatedDocuments(List<dynamic> docs) {
    setState(() {
      _currentRelatedDocuments = docs;
    });
  }

  void _refreshSidebar() {
    debugPrint("[MAIN] Sidebar refresh requested");
  }

  void _onServiceSelected(Map<String, dynamic> service) {
    final String name = service['name'] ?? 'Unknown Service';
    final String id = service['category_id'] ?? service['id'] ?? '';
    debugPrint("[MAIN] Service Selected: $name (ID: $id)");
    _chatBotKey.currentState?.setCategoryContext(id, name);
  }

  void _onConversationSelected(String conversationId) {
    debugPrint("[MAIN] Conversation Selected: $conversationId");
    _chatBotKey.currentState?.loadConversation(conversationId);
  }

  @override
  Widget build(BuildContext context) {
    final double screenWidth = MediaQuery.of(context).size.width;
    final bool isWideScreen = screenWidth > 1200;
    final String? accessToken =
        widget.user['accessToken'] ?? widget.user['token'];

    // Theme color logic for Binder Tabs
    // Dark Mode -> Green (Primary), Light Mode -> Grey
    final Color binderColor = widget.isDarkMode
        ? ThemeManager().getColors()['primary']
        : Colors.grey;

    return Scaffold(
      // Drawer is handled via Scaffold callbacks but triggered by BinderTabs
      // DISABLE DRAWER WHEN OFFLINE: Setting to null prevents opening via gesture
      drawer: (isWideScreen || !_isOnline)
          ? null
          : SidebarComponent(
              user: widget.user,
              onServiceSelected: _onServiceSelected,
              onConversationSelected: _onConversationSelected,
            ),
      endDrawer: isWideScreen
          ? null
          : RightSidebarComponent(
              relatedDocuments: _currentRelatedDocuments,
              accessToken: accessToken,
            ),
      drawerScrimColor: Colors.black54,
      drawerEdgeDragWidth: 40,

      body: SafeArea(
        child: Stack(
          children: [
            // 1. MAIN LAYOUT (Navbar + Content)
            Column(
              children: [
                NavBarComponent(
                  user: widget.user,
                  onLogout: widget.onLogout,
                  showRightDrawerButton: !isWideScreen,
                ),
                Expanded(
                  child: Row(
                    children: [
                      // Persistent Left Sidebar
                      if (isWideScreen)
                        // DISABLE LEFT SIDEBAR WHEN OFFLINE
                        IgnorePointer(
                          ignoring: !_isOnline,
                          child: Opacity(
                            opacity: _isOnline ? 1.0 : 0.5,
                            child: SizedBox(
                              width: 420,
                              child: SidebarComponent(
                                user: widget.user,
                                onServiceSelected: _onServiceSelected,
                                onConversationSelected: _onConversationSelected,
                              ),
                            ),
                          ),
                        ),

                      // Center Chat Area
                      Expanded(
                        // DISABLE CHATBOT WHEN OFFLINE
                        child: IgnorePointer(
                          ignoring: !_isOnline,
                          child: Opacity(
                            opacity: _isOnline ? 1.0 : 0.5,
                            child: KeyedSubtree(
                              key: const Key('main_chat_bot'),
                              child: ChatBotComponent(
                                key: _chatBotKey,
                                userId: widget.user['id'] ?? widget.user['_id'],
                                onRefreshSidebar: _refreshSidebar,
                                onRelatedDocumentsUpdate: _updateRelatedDocuments,
                                httpClient: widget.httpClient,
                                streamBaseUrl: widget.streamBaseUrl,
                              ),
                            ),
                          ),
                        ),
                      ),

                      // Persistent Right Sidebar
                      if (isWideScreen)
                        SizedBox(
                          width: 420,
                          child: RightSidebarComponent(
                            relatedDocuments: _currentRelatedDocuments,
                            accessToken: accessToken,
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ),

            // 2. BINDER TABS (Overlay)
            // Left Tab
            if (!isWideScreen)
              Positioned(
                left: 0,
                top: 0, // Adjacent to Navbar
                child: _BinderTab(
                  isLeft: true,
                  // VISUAL DISABLE: Grey out when offline
                  color: _isOnline ? binderColor : Colors.grey,
                  // FUNCTIONAL DISABLE: No-op if offline
                  onTap: _isOnline
                      ? () => Scaffold.of(context).openDrawer()
                      : () {
                          debugPrint("Drawer disabled (Offline)");
                        },
                ),
              ),

            // Right Tab
            if (!isWideScreen)
              Positioned(
                right: 0,
                top: 0, // Adjacent to Navbar
                child: _BinderTab(
                  isLeft: false,
                  color: binderColor,
                  onTap: () => Scaffold.of(context).openEndDrawer(),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

// -----------------------------------------------------------------------------
// PRIVATE COMPONENT: BINDER TAB VISUAL
// -----------------------------------------------------------------------------
class _BinderTab extends StatelessWidget {
  final bool isLeft;
  final Color color;
  final VoidCallback onTap;

  const _BinderTab({
    required this.isLeft,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 10, // Slim Width
        height: 60, // Height matching Navbar approx
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.45), // Transparent
          borderRadius: BorderRadius.horizontal(
            right: isLeft ? const Radius.circular(10) : Radius.zero,
            left: !isLeft ? const Radius.circular(10) : Radius.zero,
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black12,
              blurRadius: 4,
              offset: isLeft ? const Offset(2, 0) : const Offset(-2, 0),
            ),
          ],
        ),
        child: Center(
          child: Icon(
            isLeft ? Icons.chevron_right : Icons.chevron_left,
            color: Colors.white.withValues(alpha: 0.8),
            size: 12,
          ),
        ),
      ),
    );
  }
}
