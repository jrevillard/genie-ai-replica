import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/theme/app_theme.dart';
import '../providers/auth_provider.dart';
import '../widgets/amina_text_field.dart';
import '../widgets/login_button.dart';

enum _Step { request, confirm, done }

class ForgotPasswordScreen extends ConsumerStatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  ConsumerState<ForgotPasswordScreen> createState() =>
      _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends ConsumerState<ForgotPasswordScreen> {
  final _requestFormKey = GlobalKey<FormState>();
  final _confirmFormKey = GlobalKey<FormState>();
  final _emailCtrl      = TextEditingController();
  final _tokenCtrl      = TextEditingController();
  final _newPassCtrl    = TextEditingController();

  _Step   _step     = _Step.request;
  String? _devToken;

  @override
  void dispose() {
    _emailCtrl.dispose();
    _tokenCtrl.dispose();
    _newPassCtrl.dispose();
    super.dispose();
  }

  void _resetAuthState() => ref.read(authProvider.notifier).reset();

  // ── Step 1: request reset email ───────────────────────────────────────────

  Future<void> _handleRequest() async {
    FocusScope.of(context).unfocus();
    if (!(_requestFormKey.currentState?.validate() ?? false)) return;

    final (error, devToken) = await ref
        .read(authProvider.notifier)
        .sendPasswordReset(_emailCtrl.text.trim());

    if (!mounted) return;
    _resetAuthState();

    if (error != null) {
      _showError(error);
    } else {
      setState(() {
        _devToken = devToken;
        if (devToken != null) _tokenCtrl.text = devToken;
        _step = _Step.confirm;
      });
    }
  }

  // ── Step 2: confirm with token + new password ─────────────────────────────

  Future<void> _handleConfirm() async {
    FocusScope.of(context).unfocus();
    if (!(_confirmFormKey.currentState?.validate() ?? false)) return;

    final error = await ref.read(authProvider.notifier).confirmPasswordReset(
          token:       _tokenCtrl.text.trim(),
          newPassword: _newPassCtrl.text,
        );

    if (!mounted) return;
    _resetAuthState();

    if (error != null) {
      _showError(error);
    } else {
      setState(() => _step = _Step.done);
    }
  }

  void _showError(String message) {
    final cs = Theme.of(context).colorScheme;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Row(children: [
          Icon(Icons.error_outline, color: cs.onErrorContainer, size: 18),
          const SizedBox(width: 10),
          Expanded(
            child: Text(message,
                style: TextStyle(
                    color: cs.onErrorContainer, fontFamily: 'Inter')),
          ),
        ]),
        backgroundColor: cs.errorContainer,
        behavior:  SnackBarBehavior.floating,
        shape:     RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        margin:    const EdgeInsets.all(16),
        duration:  const Duration(seconds: 4),
      ),
    );
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final isDark = MediaQuery.platformBrightnessOf(context) == Brightness.dark;
    return Theme(
      data: isDark ? AminaTheme.dark : AminaTheme.light,
      child: Builder(builder: _buildContent),
    );
  }

  Widget _buildContent(BuildContext context) {
    final authState = ref.watch(authProvider);
    final cs        = Theme.of(context).colorScheme;
    final amina     = Theme.of(context).extension<AminaColors>()!;

    return PopScope(
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) _resetAuthState();
      },
      child: Scaffold(
        backgroundColor: amina.scaffoldBg,
        appBar: AppBar(
          backgroundColor:        amina.scaffoldBg,
          surfaceTintColor:       Colors.transparent,
          elevation:              0,
          scrolledUnderElevation: 0,
          leading: IconButton(
            icon: Icon(Icons.arrow_back_ios_new_rounded,
                color: cs.onSurface, size: 20),
            onPressed: () => Navigator.of(context).pop(),
          ),
          title: Text(
            'Reset Password',
            style: TextStyle(
              color:      cs.onSurface,
              fontWeight: FontWeight.w700,
              fontSize:   17,
              fontFamily: 'Inter',
            ),
          ),
          centerTitle: true,
        ),
        body: SafeArea(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 12),
            child: switch (_step) {
              _Step.request => _RequestForm(
                  formKey:     _requestFormKey,
                  emailCtrl:   _emailCtrl,
                  isLoading:   authState.isLoading,
                  onSubmit:    _handleRequest,
                  cs:          cs,
                  amina:       amina,
                ),
              _Step.confirm => _ConfirmForm(
                  formKey:     _confirmFormKey,
                  tokenCtrl:   _tokenCtrl,
                  newPassCtrl: _newPassCtrl,
                  devToken:    _devToken,
                  isLoading:   authState.isLoading,
                  onSubmit:    _handleConfirm,
                  cs:          cs,
                  amina:       amina,
                ),
              _Step.done => _DoneView(
                  email: _emailCtrl.text,
                  cs:    cs,
                  amina: amina,
                ),
            },
          ),
        ),
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 1 — Request form
// ═══════════════════════════════════════════════════════════════════════════════

class _RequestForm extends StatelessWidget {
  final GlobalKey<FormState> formKey;
  final TextEditingController emailCtrl;
  final bool         isLoading;
  final VoidCallback onSubmit;
  final ColorScheme  cs;
  final AminaColors  amina;

  const _RequestForm({
    required this.formKey,
    required this.emailCtrl,
    required this.isLoading,
    required this.onSubmit,
    required this.cs,
    required this.amina,
  });

  String? _validateEmail(String? v) {
    if (v == null || v.trim().isEmpty) return 'Email is required.';
    if (!RegExp(r'^[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}$').hasMatch(v.trim())) {
      return 'Enter a valid email address.';
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    return Form(
      key: formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 20),
          Container(
            width: 68, height: 68,
            decoration: BoxDecoration(
              shape:  BoxShape.circle,
              color:  amina.sageLight,
              border: Border.all(
                  color: cs.primary.withValues(alpha: 0.30), width: 1.5),
              boxShadow: [
                BoxShadow(
                    color: amina.sageGlow, blurRadius: 28, spreadRadius: 3),
              ],
            ),
            child: Icon(Icons.lock_reset_rounded, color: cs.primary, size: 32),
          ),
          const SizedBox(height: 24),
          Text(
            'Forgot your password?',
            style: TextStyle(
              fontSize: 22, fontWeight: FontWeight.w800,
              color: cs.onSurface, fontFamily: 'Inter',
            ),
          ),
          const SizedBox(height: 10),
          Text(
            'Enter your email and we\'ll send you a link to reset your password.',
            style: TextStyle(
              fontSize: 14, color: cs.onSurfaceVariant,
              height: 1.55, fontFamily: 'Inter',
            ),
          ),
          const SizedBox(height: 36),
          AminaTextField(
            label:        'Email',
            hint:         'you@example.com',
            prefixIcon:   Icons.mail_outline_rounded,
            controller:   emailCtrl,
            keyboardType: TextInputType.emailAddress,
            validator:    _validateEmail,
          ),
          const SizedBox(height: 32),
          LoginButton(
            isLoading: isLoading,
            onPressed: onSubmit,
            label:     'Send Reset Link',
          ),
        ],
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2 — Confirm form (token + new password)
// ═══════════════════════════════════════════════════════════════════════════════

class _ConfirmForm extends StatelessWidget {
  final GlobalKey<FormState>  formKey;
  final TextEditingController tokenCtrl;
  final TextEditingController newPassCtrl;
  final String?      devToken;
  final bool         isLoading;
  final VoidCallback onSubmit;
  final ColorScheme  cs;
  final AminaColors  amina;

  const _ConfirmForm({
    required this.formKey,
    required this.tokenCtrl,
    required this.newPassCtrl,
    required this.devToken,
    required this.isLoading,
    required this.onSubmit,
    required this.cs,
    required this.amina,
  });

  @override
  Widget build(BuildContext context) {
    return Form(
      key: formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 20),

          // Icon
          Container(
            width: 68, height: 68,
            decoration: BoxDecoration(
              shape:  BoxShape.circle,
              color:  amina.sageLight,
              border: Border.all(
                  color: cs.primary.withValues(alpha: 0.30), width: 1.5),
              boxShadow: [
                BoxShadow(
                    color:      amina.sageGlow,
                    blurRadius: 28,
                    spreadRadius: 3),
              ],
            ),
            child: Icon(Icons.vpn_key_rounded,
                color: cs.primary, size: 30),
          ),
          const SizedBox(height: 24),

          Text(
            'Enter your reset code',
            style: TextStyle(
              fontSize: 22, fontWeight: FontWeight.w800,
              color: cs.onSurface, fontFamily: 'Inter',
            ),
          ),
          const SizedBox(height: 10),
          Text(
            devToken != null
                ? 'No email server is configured. Your reset token is shown below — copy it into the field and set your new password.'
                : 'Check your email for the reset token and enter it below along with your new password.',
            style: TextStyle(
              fontSize: 14, color: cs.onSurfaceVariant,
              height: 1.55, fontFamily: 'Inter',
            ),
          ),

          // Dev token banner
          if (devToken != null) ...[
            const SizedBox(height: 16),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              decoration: BoxDecoration(
                color:        const Color(0xFFFFFBEB),
                borderRadius: BorderRadius.circular(14),
                border: Border.all(
                    color: const Color(0xFFF59E0B).withValues(alpha: 0.5)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Row(children: [
                    Icon(Icons.info_outline_rounded,
                        color: Color(0xFFB45309), size: 16),
                    SizedBox(width: 6),
                    Text(
                      'Dev token (no SMTP)',
                      style: TextStyle(
                        fontSize: 12, fontWeight: FontWeight.w700,
                        color: Color(0xFF92400E), fontFamily: 'Inter',
                      ),
                    ),
                  ]),
                  const SizedBox(height: 6),
                  SelectableText(
                    devToken!,
                    style: const TextStyle(
                      fontSize:   13,
                      fontFamily: 'monospace',
                      color:      Color(0xFF92400E),
                      letterSpacing: 0.5,
                    ),
                  ),
                ],
              ),
            ),
          ],

          const SizedBox(height: 28),

          // Token field
          AminaTextField(
            label:      'Reset Token',
            hint:       'Paste your token here',
            prefixIcon: Icons.vpn_key_outlined,
            controller: tokenCtrl,
            validator:  (v) =>
                (v == null || v.trim().isEmpty) ? 'Token is required.' : null,
          ),
          const SizedBox(height: 20),

          // New password field
          AminaTextField(
            label:      'New Password',
            hint:       'At least 4 characters',
            prefixIcon: Icons.lock_outline_rounded,
            controller: newPassCtrl,
            isPassword: true,
            validator: (v) {
              if (v == null || v.isEmpty) return 'Password is required.';
              if (v.length < 4) return 'Password must be at least 4 characters.';
              return null;
            },
          ),
          const SizedBox(height: 32),

          LoginButton(
            isLoading: isLoading,
            onPressed: onSubmit,
            label:     'Set New Password',
          ),
        ],
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 3 — Done
// ═══════════════════════════════════════════════════════════════════════════════

class _DoneView extends StatelessWidget {
  final String      email;
  final ColorScheme cs;
  final AminaColors amina;

  const _DoneView({
    required this.email,
    required this.cs,
    required this.amina,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        const SizedBox(height: 40),
        Container(
          width: 80, height: 80,
          decoration: BoxDecoration(
            shape:  BoxShape.circle,
            color:  amina.sageLight,
            border: Border.all(
                color: cs.primary.withValues(alpha: 0.30), width: 1.5),
            boxShadow: [
              BoxShadow(
                  color: amina.sageGlow, blurRadius: 36, spreadRadius: 4),
            ],
          ),
          child: Icon(Icons.check_circle_outline_rounded,
              color: cs.primary, size: 40),
        ),
        const SizedBox(height: 28),
        Text(
          'Password updated!',
          style: TextStyle(
            fontSize: 22, fontWeight: FontWeight.w800,
            color: cs.onSurface, fontFamily: 'Inter',
          ),
        ),
        const SizedBox(height: 12),
        Text(
          'Your password for $email has been reset.\nYou can now sign in with your new password.',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 14, color: cs.onSurfaceVariant,
            height: 1.55, fontFamily: 'Inter',
          ),
        ),
        const SizedBox(height: 40),
        SizedBox(
          width: double.infinity,
          height: 56,
          child: OutlinedButton(
            onPressed: () => Navigator.of(context).pop(),
            style: OutlinedButton.styleFrom(
              foregroundColor: cs.primary,
              side: BorderSide(
                  color: cs.primary.withValues(alpha: 0.55), width: 1.5),
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16)),
            ),
            child: Text(
              'Back to Sign In',
              style: TextStyle(
                color: cs.primary, fontSize: 16,
                fontWeight: FontWeight.w700, fontFamily: 'Inter',
              ),
            ),
          ),
        ),
      ],
    );
  }
}
