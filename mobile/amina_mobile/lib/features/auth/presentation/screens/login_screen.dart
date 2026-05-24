// This file is part of Amina Care.
//
// Amina Care is free software: you can redistribute it and/or modify
// it under the terms of the GNU Lesser General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Amina Care is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Lesser General Public License for more details.
//
// You should have received a copy of the GNU Lesser General Public License
// along with Amina Care. If not, see <https://www.gnu.org/licenses/>.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/navigation_menu.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../caregiver/presentation/providers/caregiver_provider.dart';
import '../../../caregiver/presentation/screens/caregiver_onboarding_screen.dart';
import '../providers/auth_provider.dart';
import '../widgets/amina_text_field.dart';
import '../widgets/auth_header.dart';
import '../widgets/login_button.dart';
import 'forgot_password_screen.dart';
import 'register_screen.dart';

// ── Design note ────────────────────────────────────────────────────────────────
//
// Login inherits its theme directly from MaterialApp (which applies
// AminaTheme.dark or AminaTheme.light based on themeModeProvider).
// Every color comes from cs.* / amina.* tokens — no hardcoded values.

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey            = GlobalKey<FormState>();
  final _emailController    = TextEditingController();
  final _passwordController = TextEditingController();
  bool  _rememberMe         = false;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  // ── Validators ────────────────────────────────────────────────────────────

  String? _validateEmail(String? v) {
    if (v == null || v.trim().isEmpty) return 'Email is required.';
    if (!RegExp(r'^[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}$').hasMatch(v.trim())) {
      return 'Enter a valid email address.';
    }
    return null;
  }

  String? _validatePassword(String? v) {
    if (v == null || v.isEmpty) return 'Password is required.';
    if (v.length < 6) return 'Password must be at least 6 characters.';
    return null;
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  Future<void> _handleLogin() async {
    FocusScope.of(context).unfocus();
    if (!(_formKey.currentState?.validate() ?? false)) return;

    final error = await ref
        .read(authProvider.notifier)
        .login(
          _emailController.text,
          _passwordController.text,
          rememberMe: _rememberMe,
        );

    if (!mounted) return;

    if (error != null) {
      final cs = Theme.of(context).colorScheme;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Row(children: [
            Icon(Icons.error_outline, color: cs.onErrorContainer, size: 18),
            const SizedBox(width: 10),
            Expanded(
              child: Text(error,
                  style: TextStyle(
                      color: cs.onErrorContainer, fontFamily: 'Inter')),
            ),
          ]),
          backgroundColor: cs.errorContainer,
          behavior: SnackBarBehavior.floating,
          shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12)),
          margin:   const EdgeInsets.all(16),
          duration: const Duration(seconds: 3),
        ),
      );
    } else {
      // Force caregiver providers to re-fetch now that a valid token exists.
      ref.invalidate(assignedCaregiversProvider);
      ref.invalidate(caregiverDirectoryProvider);
      ref.invalidate(bantabaCircleProvider);

      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => const MainNavigation()),
        (_) => false,
      );
    }
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) => _buildContent(context);

  Widget _buildContent(BuildContext context) {
    final authState = ref.watch(authProvider);
    final cs        = Theme.of(context).colorScheme;
    final amina     = Theme.of(context).extension<AminaColors>()!;

    return Scaffold(
      backgroundColor: amina.scaffoldBg,
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) => SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 28),
            child: ConstrainedBox(
              constraints: BoxConstraints(minHeight: constraints.maxHeight),
              child: IntrinsicHeight(
                child: Form(
                  key: _formKey,
                  child: Column(
                    children: [

                      // ── Brand header ────────────────────────────────────
                      const SizedBox(height: 56),
                      const AuthHeader(),
                      const SizedBox(height: 44),

                      // ── Form card ────────────────────────────────────────
                      Container(
                        padding: const EdgeInsets.all(28),
                        decoration: BoxDecoration(
                          color:        cs.surface,
                          borderRadius: BorderRadius.circular(28),
                          border:       Border.all(color: amina.cardBorder),
                          boxShadow: [
                            BoxShadow(
                              color:      amina.sageGlow,
                              blurRadius: 32,
                              offset:     Offset.zero,
                            ),
                          ],
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            // Card heading
                            Text(
                              'Welcome back',
                              style: TextStyle(
                                fontSize:   20,
                                fontWeight: FontWeight.w800,
                                color:      cs.onSurface,
                                fontFamily: 'Inter',
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              'Sign in to continue your health journey.',
                              style: TextStyle(
                                fontSize:   13,
                                color:      cs.onSurfaceVariant,
                                fontFamily: 'Inter',
                              ),
                            ),
                            const SizedBox(height: 28),

                            // Email field
                            AminaTextField(
                              label:        'Email',
                              hint:         'you@example.com',
                              prefixIcon:   Icons.mail_outline_rounded,
                              controller:   _emailController,
                              keyboardType: TextInputType.emailAddress,
                              validator:    _validateEmail,
                            ),
                            const SizedBox(height: 16),

                            // Password field
                            AminaTextField(
                              label:      'Password',
                              hint:       '••••••••',
                              prefixIcon: Icons.lock_outline_rounded,
                              controller: _passwordController,
                              isPassword: true,
                              validator:  _validatePassword,
                            ),

                            // ── Forgot password link ───────────────────────
                            Align(
                              alignment: Alignment.centerRight,
                              child: TextButton(
                                onPressed: () => Navigator.of(context).push(
                                  MaterialPageRoute(
                                    builder: (_) =>
                                        const ForgotPasswordScreen(),
                                  ),
                                ),
                                style: TextButton.styleFrom(
                                  foregroundColor: cs.primary,
                                  padding: const EdgeInsets.symmetric(
                                      vertical: 8, horizontal: 4),
                                ),
                                child: const Text(
                                  'Forgot password?',
                                  style: TextStyle(
                                    fontSize:   13,
                                    fontFamily: 'Inter',
                                  ),
                                ),
                              ),
                            ),

                            // ── Remember Me ───────────────────────────────
                            GestureDetector(
                              onTap: () =>
                                  setState(() => _rememberMe = !_rememberMe),
                              behavior: HitTestBehavior.opaque,
                              child: Padding(
                                padding:
                                    const EdgeInsets.symmetric(vertical: 4),
                                child: Row(
                                  children: [
                                    AnimatedContainer(
                                      duration: const Duration(
                                          milliseconds: 180),
                                      width:  24,
                                      height: 24,
                                      decoration: BoxDecoration(
                                        color: _rememberMe
                                            ? cs.primary
                                            : Colors.transparent,
                                        borderRadius:
                                            BorderRadius.circular(7),
                                        border: Border.all(
                                          color: _rememberMe
                                              ? cs.primary
                                              : amina.cardBorder,
                                          width: 1.8,
                                        ),
                                      ),
                                      child: _rememberMe
                                          ? Icon(
                                              Icons.check_rounded,
                                              color: cs.onPrimary,
                                              size: 16,
                                            )
                                          : null,
                                    ),
                                    const SizedBox(width: 12),
                                    Text(
                                      'Remember me',
                                      style: TextStyle(
                                        fontSize:   15,
                                        fontWeight: FontWeight.w500,
                                        color:      cs.onSurface,
                                        fontFamily: 'Inter',
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),

                            const SizedBox(height: 20),

                            // ── Sign In button ────────────────────────────
                            LoginButton(
                              isLoading: authState.isLoading,
                              onPressed: _handleLogin,
                              label:     'Sign In',
                            ),
                          ],
                        ),
                      ),

                      const SizedBox(height: 28),

                      // ── Divider ───────────────────────────────────────────
                      Row(children: [
                        Expanded(child: Divider(color: amina.divider)),
                        Padding(
                          padding:
                              const EdgeInsets.symmetric(horizontal: 14),
                          child: Text(
                            'or',
                            style: TextStyle(
                              fontSize:   13,
                              color:      cs.onSurfaceVariant,
                              fontFamily: 'Inter',
                            ),
                          ),
                        ),
                        Expanded(child: Divider(color: amina.divider)),
                      ]),

                      const SizedBox(height: 18),

                      // ── Caregiver / linking-code button ───────────────────
                      SizedBox(
                        width: double.infinity,
                        child: OutlinedButton.icon(
                          onPressed: () => Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) =>
                                  const CaregiverOnboardingScreen(),
                            ),
                          ),
                          icon: const Text('🔗',
                              style: TextStyle(fontSize: 16)),
                          label: const Text(
                            'I have a linking code',
                            style: TextStyle(
                              fontSize:   14,
                              fontWeight: FontWeight.w600,
                              fontFamily: 'Inter',
                            ),
                          ),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: cs.primary,
                            side: BorderSide(
                                color: cs.primary.withValues(alpha: 0.55),
                                width: 1.5),
                            padding: const EdgeInsets.symmetric(vertical: 14),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(14),
                            ),
                          ),
                        ),
                      ),

                      const Spacer(),

                      // ── Footer — sign up link ─────────────────────────────
                      Padding(
                        padding:
                            const EdgeInsets.only(bottom: 28, top: 32),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(
                              "Don't have an account? ",
                              style: TextStyle(
                                color:      cs.onSurfaceVariant,
                                fontSize:   14,
                                fontFamily: 'Inter',
                              ),
                            ),
                            GestureDetector(
                              onTap: () => Navigator.of(context).push(
                                MaterialPageRoute(
                                  builder: (_) => const RegisterScreen(),
                                ),
                              ),
                              child: Text(
                                'Sign up',
                                style: TextStyle(
                                  color:      cs.primary,
                                  fontSize:   14,
                                  fontWeight: FontWeight.w700,
                                  fontFamily: 'Inter',
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
