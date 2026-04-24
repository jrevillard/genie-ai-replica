import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import 'package:genie_ai_mobile/services/auth/auth_providers.dart';
import 'package:genie_ai_mobile/services/auth/auth_state.dart';
import 'package:genie_ai_mobile/services/genie_ai_config.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';

class OidcLoginScreen extends ConsumerWidget {
  const OidcLoginScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authProvider);
    final colors = ThemeManager().getColors();

    return Semantics(
      label: 'Login screen',
      child: Scaffold(
        backgroundColor: colors['background'],
        body: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(16.0),
            child: Container(
              constraints: const BoxConstraints(maxWidth: 400),
              padding: const EdgeInsets.all(24.0),
              decoration: BoxDecoration(
                color: colors['surface'],
                borderRadius: BorderRadius.circular(16),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.1),
                    blurRadius: 10,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _buildBranding(colors),
                  const SizedBox(height: 24),
                  _buildContent(context, ref, authState, colors),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildBranding(Map<String, dynamic> colors) {
    return Column(
      children: [
        SizedBox(
          height: 80,
          child: GenieAiConfig.iconPath.toLowerCase().endsWith('.svg')
              ? SvgPicture.asset(
                  GenieAiConfig.iconPath,
                  height: 80,
                  fit: BoxFit.contain,
                )
              : Image.asset(
                  GenieAiConfig.iconPath,
                  height: 80,
                  fit: BoxFit.contain,
                  errorBuilder: (context, error, stackTrace) {
                    return const Icon(Icons.error, size: 40);
                  },
                ),
        ),
        const SizedBox(height: 20),
        Text(
          GenieAiConfig.title,
          style: TextStyle(
            fontSize: 28,
            fontWeight: FontWeight.bold,
            color: colors['text'],
          ),
        ),
      ],
    );
  }

  Widget _buildContent(
    BuildContext context,
    WidgetRef ref,
    AuthState authState,
    Map<String, dynamic> colors,
  ) {
    switch (authState.status) {
      case AuthStatus.authenticated:
        // main.dart routes to MainScreen when authenticated;
        // this branch exists for switch exhaustiveness.
        return const SizedBox.shrink();
      case AuthStatus.unauthenticated:
        return _buildSignInButton(context, ref, colors);
      case AuthStatus.error:
        return _buildErrorState(context, ref, authState, colors);
    }
  }

  Widget _buildSignInButton(
    BuildContext context,
    WidgetRef ref,
    Map<String, dynamic> colors,
  ) {
    return Semantics(
      label: 'Sign in with your institution account',
      button: true,
      child: ElevatedButton(
        style: ElevatedButton.styleFrom(
          backgroundColor: colors['primary'],
          minimumSize: const Size(double.infinity, 48),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(8),
          ),
        ),
        onPressed: () => ref.read(authProvider.notifier).authorize(),
        child: const Text(
          'Sign in',
          style: TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.bold,
          ),
        ),
      ),
    );
  }

  Widget _buildErrorState(
    BuildContext context,
    WidgetRef ref,
    AuthState authState,
    Map<String, dynamic> colors,
  ) {
    final errorColor = Theme.of(context).colorScheme.error;

    return Column(
      children: [
        Semantics(
          label: 'Authentication error: ${authState.errorMessage}',
          child: Container(
            width: double.infinity,
            padding: const EdgeInsets.all(10),
            margin: const EdgeInsets.only(bottom: 16),
            decoration: BoxDecoration(
              color: errorColor.withValues(alpha: 0.2),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(
              children: [
                Icon(Icons.error_outline, color: errorColor),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    authState.errorMessage ?? 'An error occurred',
                    style: TextStyle(color: errorColor, fontSize: 13),
                  ),
                ),
              ],
            ),
          ),
        ),
        if (authState.retryable)
          _buildRetryButton(ref, colors)
        else
          _buildSignInButton(context, ref, colors),
      ],
    );
  }

  Widget _buildRetryButton(WidgetRef ref, Map<String, dynamic> colors) {
    return Semantics(
      label: 'Retry sign in',
      button: true,
      child: ElevatedButton(
        style: ElevatedButton.styleFrom(
          backgroundColor: colors['primary'],
          minimumSize: const Size(double.infinity, 48),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(8),
          ),
        ),
        onPressed: () => ref.read(authProvider.notifier).authorize(),
        child: const Text(
          'Retry',
          style: TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.bold,
          ),
        ),
      ),
    );
  }
}
