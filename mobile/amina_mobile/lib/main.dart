import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/providers/session_expired_provider.dart';
import 'core/theme/app_theme.dart';
import 'core/theme/theme_provider.dart';
import 'features/auth/presentation/providers/auth_provider.dart';
import 'features/auth/presentation/screens/login_screen.dart';
import 'features/auth/presentation/screens/splash_screen.dart';

// ─── Entry point ─────────────────────────────────────────────────────────────
//
// We load the persisted ThemeMode *before* runApp so dark-mode users never
// see a white flash on startup.  The override injects a pre-seeded notifier
// into ProviderScope, replacing the default ThemeMode.light value.

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Lock to portrait — suits a senior-focused health companion.
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  // Load persisted theme before first frame.
  final savedTheme = await ThemeNotifier.load();

  runApp(
    ProviderScope(
      overrides: [
        // Seed the notifier with the persisted mode so there is no
        // light→dark flash during initialisation.
        themeModeProvider.overrideWith(
          (_) => ThemeNotifier(savedTheme),
        ),
      ],
      child: const AminaCareApp(),
    ),
  );
}

// ─── Root widget ─────────────────────────────────────────────────────────────

/// Root of the widget tree.
///
/// Watches [themeModeProvider] so the entire app re-themes reactively.
/// Listens to [sessionExpiredProvider] so any 401 from the backend forces
/// an immediate logout and redirect to the login screen.
class AminaCareApp extends ConsumerStatefulWidget {
  const AminaCareApp({super.key});

  @override
  ConsumerState<AminaCareApp> createState() => _AminaCareAppState();
}

class _AminaCareAppState extends ConsumerState<AminaCareApp> {
  final _navigatorKey = GlobalKey<NavigatorState>();

  @override
  Widget build(BuildContext context) {
    // When the Dio interceptor detects a 401, clear auth state and go to login.
    ref.listen<bool>(sessionExpiredProvider, (_, expired) async {
      if (!expired) return;
      ref.read(sessionExpiredProvider.notifier).state = false;
      await ref.read(authProvider.notifier).logout();
      _navigatorKey.currentState?.pushAndRemoveUntil(
        MaterialPageRoute<void>(builder: (_) => const LoginScreen()),
        (route) => false,
      );
    });

    final themeMode = ref.watch(themeModeProvider);

    return MaterialApp(
      navigatorKey:              _navigatorKey,
      debugShowCheckedModeBanner: false,
      title:     'Amina Care',
      theme:     AminaTheme.light,
      darkTheme: AminaTheme.dark,
      themeMode: themeMode,
      home: const SplashScreen(),
    );
  }
}
