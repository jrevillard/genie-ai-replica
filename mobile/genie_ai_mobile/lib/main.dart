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
import 'package:genie_ai_mobile/services/notification_service.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
import 'package:genie_ai_mobile/services/connectivity_service.dart'; // ADDED
import 'package:genie_ai_mobile/services/fallback_localizations.dart';
import 'package:genie_ai_mobile/services/voice_conversation_service.dart';

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
import 'package:genie_ai_mobile/components/chat/right_sidebar_component.dart';
import 'package:genie_ai_mobile/components/settings/about_screen.dart';

/// SSL Override for local development to bypass self-signed certificate issues
class MyHttpOverrides extends HttpOverrides {
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

  // Initialize Firebase & Notifications
  try {
    if (!kIsWeb) {
      await Firebase.initializeApp();
      await NotificationService.init();
    }
  } catch (e) {
    debugPrint("[MAIN] Firebase/Notification init failed: $e");
  }

  // Apply the HTTP overrides for development environment
  if (!kIsWeb) {
    HttpOverrides.global = MyHttpOverrides();
  }

  // Initialize Connectivity (Online/Offline)
  await ConnectivityService().init();

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
      final String configString = await rootBundle.loadString(
        'assets/config/genie-ai-config.json',
      );
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
          home: _user == null
              ? LoginScreen(onLoginSuccess: _handleLogin)
              : MainScreen(
                  user: _user!,
                  isDarkMode: ThemeManager().isDarkMode,
                  toggleTheme: _toggleTheme,
                  onLogout: _handleLogout,
                ),
          routes: {
            '/login': (context) => LoginScreen(onLoginSuccess: _handleLogin),
            '/register': (context) => const RegisterScreen(),
            '/registration-success': (context) =>
                const RegistrationSuccessScreen(),
            '/password-reset': (context) => const PasswordResetInitiateScreen(),
            '/profile': (context) => UserProfileScreen(user: _user ?? {}),
            '/about': (context) => const AboutScreen(),
            '/password-reset-confirm': (context) {
              final settings = ModalRoute.of(context)?.settings;
              final String? token = settings?.arguments as String?;
              if (token == null) {
                return const Scaffold(
                  body: Center(child: Text("Invalid or missing reset token")),
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

class _MainScreenState extends State<MainScreen> with WidgetsBindingObserver {
  final GlobalKey<ChatBotComponentState> _chatBotKey =
      GlobalKey<ChatBotComponentState>();

  List<dynamic> _currentRelatedDocuments = [];

  // Connectivity state
  StreamSubscription<bool>? _connectivitySubscription;
  bool _isOnline = true;
  bool _showHandsfreeMode = false;
  bool _isChatOnStartPage = true;
  final VoiceConversationService _voiceSupport = VoiceConversationService();

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

  void _handleChatStateChanged() {
    final isOnStartPage = _chatBotKey.currentState?.isQuickHelpVisible ?? true;
    if (_isChatOnStartPage == isOnStartPage) return;
    setState(() {
      _isChatOnStartPage = isOnStartPage;
    });
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
                  onHomeTap: () => _chatBotKey.currentState?.startNewChat(),
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
                            child: ChatBotComponent(
                              key: _chatBotKey,
                              userId: widget.user['id'] ?? widget.user['_id'],
                              onRefreshSidebar: _refreshSidebar,
                              onRelatedDocumentsUpdate: _updateRelatedDocuments,
                              onChatStateChanged: _handleChatStateChanged,
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

            // 2. HANDSFREE MODE BUTTON / OVERLAY
            if (!isWideScreen &&
                _isOnline &&
                _voiceSupport.isSupportedPlatform &&
                _isChatOnStartPage &&
                !_showHandsfreeMode)
              Positioned(
                left: 0,
                right: 0,
                bottom: 16,
                child: Center(
                  child: FloatingActionButton.extended(
                    heroTag: 'handsfree-mode',
                    icon: const Icon(Icons.record_voice_over),
                    label: const Text('Handsfree'),
                    onPressed: () {
                      FocusManager.instance.primaryFocus?.unfocus();
                      setState(() => _showHandsfreeMode = true);
                    },
                  ),
                ),
              ),

            if (_showHandsfreeMode)
              _HandsfreeOverlay(
                chatBotKey: _chatBotKey,
                onClose: () => setState(() => _showHandsfreeMode = false),
              ),

            // 3. BINDER TABS (Overlay)
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
          color: color.withOpacity(0.45), // Transparent
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
            color: Colors.white.withOpacity(0.8),
            size: 12,
          ),
        ),
      ),
    );
  }
}

class _HandsfreeOverlay extends StatefulWidget {
  final GlobalKey<ChatBotComponentState> chatBotKey;
  final VoidCallback onClose;

  const _HandsfreeOverlay({required this.chatBotKey, required this.onClose});

  @override
  State<_HandsfreeOverlay> createState() => _HandsfreeOverlayState();
}

class _HandsfreeOverlayState extends State<_HandsfreeOverlay> {
  final VoiceConversationService _voiceService = VoiceConversationService();
  bool _isListening = false;
  bool _isThinking = false;
  bool _isSpeaking = false;
  bool _isClosing = false;
  bool _isSubmittingHeardText = false;
  String _heardText = '';
  Timer? _speechSilenceTimer;
  Timer? _listenFallbackTimer;

  @override
  void initState() {
    super.initState();
    FocusManager.instance.primaryFocus?.unfocus();
    unawaited(_startHandsfreeLoop());
  }

  @override
  void dispose() {
    _isClosing = true;
    _cancelListenTimers();
    unawaited(_voiceService.dispose());
    super.dispose();
  }

  String get _localeId {
    final code = I18nService().currentLocale.languageCode;
    return _voiceService.localeForLanguageCode(code);
  }

  Future<void> _startHandsfreeLoop() async {
    await _speak(
      'Handsfree mode started. Ask me about Bangladesh agriculture and weather.',
    );
    await _listen();
  }

  Future<void> _listen() async {
    if (_isClosing || !mounted) return;
    _cancelListenTimers();
    _heardText = '';
    _isSubmittingHeardText = false;
    setState(() {
      _isListening = true;
      _isThinking = false;
      _isSpeaking = false;
    });

    final started = await _voiceService.startListening(
      localeId: _localeId,
      onText: (text) {
        _heardText = text;
        _scheduleSilenceSubmit();
      },
      onDone: () => unawaited(_submitHeardText()),
      onError: (_) => unawaited(_restartListening()),
    );

    if (!started) {
      await _speak('Voice input is unavailable on this device.');
      if (mounted) widget.onClose();
      return;
    }

    _listenFallbackTimer = Timer(const Duration(seconds: 18), () {
      if (_heardText.trim().isEmpty) {
        unawaited(_restartListening());
      } else {
        unawaited(_submitHeardText());
      }
    });
  }

  void _scheduleSilenceSubmit() {
    if (_heardText.trim().isEmpty || _isSubmittingHeardText) return;
    _speechSilenceTimer?.cancel();
    _speechSilenceTimer = Timer(const Duration(milliseconds: 1600), () {
      unawaited(_submitHeardText());
    });
  }

  void _cancelListenTimers() {
    _speechSilenceTimer?.cancel();
    _speechSilenceTimer = null;
    _listenFallbackTimer?.cancel();
    _listenFallbackTimer = null;
  }

  Future<void> _submitHeardText() async {
    if (_isClosing || _isThinking || _isSpeaking || _isSubmittingHeardText) {
      return;
    }

    _isSubmittingHeardText = true;
    _cancelListenTimers();
    await _voiceService.stopListening();

    final text = _heardText.trim();
    if (mounted) {
      setState(() {
        _isListening = false;
        _isThinking = text.isNotEmpty;
      });
    }

    if (text.isEmpty) {
      _isSubmittingHeardText = false;
      await _restartListening();
      return;
    }

    final response = await widget.chatBotKey.currentState?.sendHandsfreeMessage(
      text,
    );
    if (_isClosing || !mounted) return;

    setState(() => _isThinking = false);
    await _speak(
      response?.trim().isNotEmpty == true
          ? response!
          : 'I could not get a response. Please try again.',
    );

    _isSubmittingHeardText = false;
    await _listen();
  }

  Future<void> _restartListening() async {
    if (_isClosing || !mounted || _isSubmittingHeardText) return;
    _cancelListenTimers();
    await _voiceService.cancelListening();
    await Future<void>.delayed(const Duration(milliseconds: 500));
    await _listen();
  }

  Future<void> _speak(String text) async {
    if (_isClosing || !mounted) return;
    setState(() {
      _isSpeaking = true;
      _isListening = false;
      _isThinking = false;
    });
    await _voiceService.speak(text, localeId: _localeId, awaitCompletion: true);
    if (mounted) setState(() => _isSpeaking = false);
  }

  Future<void> _close() async {
    _isClosing = true;
    _cancelListenTimers();
    await _voiceService.dispose();
    if (mounted) widget.onClose();
  }

  IconData get _statusIcon {
    if (_isThinking) return Icons.auto_awesome;
    if (_isSpeaking) return Icons.volume_up;
    return _isListening ? Icons.mic : Icons.mic_none;
  }

  @override
  Widget build(BuildContext context) {
    final colors = ThemeManager().getColors();
    final primary = colors['primary'] as Color;

    return Positioned.fill(
      child: WillPopScope(
        onWillPop: () async {
          await _close();
          return false;
        },
        child: Material(
          color: Colors.black,
          child: SafeArea(
            child: Stack(
              children: [
                Center(
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 250),
                    width: _isListening ? 148 : 128,
                    height: _isListening ? 148 : 128,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: primary.withOpacity(_isListening ? 0.28 : 0.18),
                      border: Border.all(color: primary, width: 2),
                    ),
                    child: Center(
                      child: _isThinking
                          ? SizedBox(
                              width: 42,
                              height: 42,
                              child: CircularProgressIndicator(color: primary),
                            )
                          : Icon(_statusIcon, color: Colors.white, size: 56),
                    ),
                  ),
                ),
                Positioned(
                  top: 12,
                  right: 12,
                  child: IconButton.filled(
                    icon: const Icon(Icons.close),
                    onPressed: _close,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
