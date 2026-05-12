import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/navigation_menu.dart';
import '../../../caregiver/presentation/screens/caregiver_dashboard.dart';
import '../../domain/entities/session_status.dart';
import '../providers/auth_provider.dart';
import 'login_screen.dart';

// ─── Session check ────────────────────────────────────────────────────────────

final _sessionCheckProvider = FutureProvider<SessionStatus>((ref) async {
  return ref.read(getSessionUsecaseProvider).call();
});


// ═══════════════════════════════════════════════════════════════════════════════
// SplashScreen
//
// Shown once at cold-start while the session check resolves (~200 ms).
// Navigates immediately to MainNavigation or LoginScreen.
// ═══════════════════════════════════════════════════════════════════════════════

class SplashScreen extends ConsumerStatefulWidget {
  const SplashScreen({super.key});

  @override
  ConsumerState<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends ConsumerState<SplashScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _ctrl;
  late final Animation<double> _fadeIn;
  late final Animation<double> _scaleIn;

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
    )..forward();

    _fadeIn = CurvedAnimation(
      parent: _ctrl,
      curve: const Interval(0, 0.7, curve: Curves.easeOut),
    );
    _scaleIn = Tween<double>(begin: 0.82, end: 1.0).animate(
      CurvedAnimation(
        parent: _ctrl,
        curve: const Interval(0, 0.7, curve: Curves.easeOutBack),
      ),
    );
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  void _navigate(SessionStatus status) {
    if (!mounted) return;
    final Widget dest = !status.hasSession
        ? const LoginScreen()
        : status.appMode == 'caregiverOnly'
            ? const CaregiverDashboard()
            : const MainNavigation();


    Navigator.of(context).pushReplacement(
      PageRouteBuilder<void>(
        pageBuilder: (_, _, _) => dest,
        transitionsBuilder: (_, animation, _, child) => FadeTransition(
          opacity: CurvedAnimation(parent: animation, curve: Curves.easeIn),
          child: child,
        ),
        transitionDuration: const Duration(milliseconds: 400),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    // Watch the session check; navigate as soon as it resolves.
    ref.listen(_sessionCheckProvider, (_, next) {
      next.whenData(_navigate);
    });

    return Scaffold(
      backgroundColor: Colors.white,
      body: Center(
        child: FadeTransition(
          opacity: _fadeIn,
          child: ScaleTransition(
            scale: _scaleIn,
            child: const _AminaLogo(),
          ),
        ),
      ),
    );
  }
}

// ─── Logo widget ──────────────────────────────────────────────────────────────

class _AminaLogo extends StatelessWidget {
  const _AminaLogo();

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // Icon container
        Container(
          width: 96,
          height: 96,
          decoration: BoxDecoration(
            color: const Color(0xFFEDF7F3),
            shape: BoxShape.circle,
            boxShadow: [
              BoxShadow(
                color: const Color(0xFF3D9970).withValues(alpha: 0.22),
                blurRadius: 32,
                offset: const Offset(0, 8),
              ),
            ],
          ),
          child: const Center(
            child: Text('🌿', style: TextStyle(fontSize: 48)),
          ),
        ),
        const SizedBox(height: 24),

        // App name
        const Text(
          'Amina Care',
          style: TextStyle(
            fontSize: 28,
            fontWeight: FontWeight.w800,
            color: Color(0xFF111827),
            letterSpacing: -0.5,
            fontFamily: 'Inter',
          ),
        ),

        const SizedBox(height: 8),
        
        // Tagline
        const Text(
          'Your personal health companion',
          style: TextStyle(
            fontSize: 15,
            color: Color(0xFF6B7280),
            fontFamily: 'Inter',
          ),
        ),
        
        const SizedBox(height: 48),
        
        // Subtle progress indicator
        SizedBox(
          width: 24,
          height: 24,
          child: CircularProgressIndicator(
            strokeWidth: 2.5,
            valueColor: AlwaysStoppedAnimation<Color>(
              const Color(0xFF3D9970).withValues(alpha: 0.55),
            ),
          ),
        ),
      ],
    );
  }
}
