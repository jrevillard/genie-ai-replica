import 'package:flutter/material.dart';

/// Full-width sage action button shared by Login, Register, and Forgot Password.
///
/// Uses cs.primary / cs.onPrimary from the nearest Theme — adapts automatically
/// to whichever mode the parent screen forces (dark for auth, future light).
/// Shows an animated spinner while [isLoading] is true.
class LoginButton extends StatelessWidget {
  final bool isLoading;
  final VoidCallback? onPressed;

  /// Text shown on the button when not loading. Defaults to "Sign In".
  final String label;

  const LoginButton({
    super.key,
    required this.isLoading,
    required this.onPressed,
    this.label = 'Sign In',
  });

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;

    return SizedBox(
      width: double.infinity,
      height: 56,
      child: ElevatedButton(
        onPressed: isLoading ? null : onPressed,
        style: ElevatedButton.styleFrom(
          backgroundColor: cs.primary,
          disabledBackgroundColor: cs.primary.withValues(alpha: 0.45),
          foregroundColor: cs.onPrimary,
          elevation: 0,
          shadowColor: Colors.transparent,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
        ),
        child: AnimatedSwitcher(
          duration: const Duration(milliseconds: 200),
          child: isLoading
              ? SizedBox(
                  key: const ValueKey('loading'),
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(
                    color: cs.onPrimary,
                    strokeWidth: 2.5,
                  ),
                )
              : Text(
                  key: const ValueKey('label'),
                  label,
                  style: TextStyle(
                    color: cs.onPrimary,
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.3,
                    fontFamily: 'Inter',
                  ),
                ),
        ),
      ),
    );
  }
}
