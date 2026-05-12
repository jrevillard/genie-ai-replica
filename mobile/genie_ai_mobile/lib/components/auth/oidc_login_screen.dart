import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import 'package:genie_ai_mobile/services/auth/auth_providers.dart';
import 'package:genie_ai_mobile/services/auth/auth_state.dart';
import 'package:genie_ai_mobile/services/genie_ai_config.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
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
        return const _AuthErrorWidget();
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
        key: const Key('login_sign_in_button'),
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
}

class _AuthErrorWidget extends ConsumerWidget {
  const _AuthErrorWidget();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authProvider);
    final message = authState.errorMessage ?? tr('auth.unknownError');
    final retryable = authState.retryable;
    final theme = Theme.of(context);

    return Semantics(
      label: '${tr('auth.error')}: $message',
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              key: const Key('login_error_icon'),
              retryable ? Icons.wifi_off : Icons.error_outline,
              size: 64,
              color: theme.colorScheme.error,
              semanticLabel: retryable
                  ? tr('auth.noInternetConnection')
                  : tr('auth.error'),
            ),
            const SizedBox(height: 24),
            Text(
              key: const Key('login_error_message'),
              message,
              style: theme.textTheme.bodyLarge,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 32),
            Semantics(
              label: retryable ? tr('auth.retry') : tr('auth.signIn'),
              button: true,
              child: ElevatedButton(
                key: const Key('login_retry_button'),
                onPressed: () {
                  if (retryable) {
                    ref.read(authProvider.notifier).retryAuthorize();
                  } else {
                    ref.read(authProvider.notifier).authorize();
                  }
                },
                child: Text(retryable ? tr('auth.retry') : tr('auth.signIn')),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
