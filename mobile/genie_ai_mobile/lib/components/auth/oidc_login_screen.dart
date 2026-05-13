import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import 'package:genie_ai_mobile/services/auth/auth_providers.dart';
import 'package:genie_ai_mobile/services/auth/auth_state.dart';
import 'package:genie_ai_mobile/services/genie_ai_config.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';

// Design System Imports
import 'package:genie_ai_mobile/design_system/components/ds_button.dart';
import 'package:genie_ai_mobile/design_system/tokens/spacing.dart';
import 'package:genie_ai_mobile/design_system/tokens/radii.dart';
import 'package:genie_ai_mobile/design_system/tokens/app_tokens.dart';

class OidcLoginScreen extends ConsumerWidget {
  const OidcLoginScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authProvider);
    final tokens = ThemeManager().tokens;

    return Semantics(
      label: 'Login screen',
      child: Scaffold(
        backgroundColor: tokens.bg,
        body: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(DsSpacing.md),
            child: Container(
              constraints: const BoxConstraints(maxWidth: 400),
              padding: const EdgeInsets.all(DsSpacing.lg),
              decoration: BoxDecoration(
                color: tokens.surface,
                borderRadius: BorderRadius.circular(DsRadii.xl),
                boxShadow: [
                  BoxShadow(
                    color: tokens.muted20,
                    blurRadius: 10,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _buildBranding(tokens),
                  const SizedBox(height: DsSpacing.lg),
                  _buildContent(context, ref, authState, tokens),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildBranding(AppTokens tokens) {
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
                    return Icon(Icons.error, size: 40, color: tokens.danger);
                  },
                ),
        ),
        const SizedBox(height: DsSpacing.lg),
        Text(
          GenieAiConfig.title,
          style: TextStyle(
            fontSize: ThemeManager().tokens.text2xl,
            fontWeight: FontWeight.bold,
            color: tokens.fg,
          ),
        ),
      ],
    );
  }

  Widget _buildContent(
    BuildContext context,
    WidgetRef ref,
    AuthState authState,
    AppTokens tokens,
  ) {
    switch (authState.status) {
      case AuthStatus.authenticated:
        // main.dart routes to MainScreen when authenticated;
        // this branch exists for switch exhaustiveness.
        return const SizedBox.shrink();
      case AuthStatus.unauthenticated:
        return _buildSignInButton(context, ref);
      case AuthStatus.error:
        return const _AuthErrorWidget();
    }
  }

  Widget _buildSignInButton(
    BuildContext context,
    WidgetRef ref,
  ) {
    return Semantics(
      label: 'Sign in with your institution account',
      button: true,
      child: DsButton(
        key: const Key('login_sign_in_button'),
        label: 'Sign in',
        variant: DsButtonVariant.primary,
        onPressed: () => ref.read(authProvider.notifier).authorize(),
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
    final tokens = ThemeManager().tokens;

    return Semantics(
      label: '${tr('auth.error')}: $message',
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: DsSpacing.xl),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              key: const Key('login_error_icon'),
              retryable ? Icons.wifi_off : Icons.error_outline,
              size: 64,
              color: tokens.danger,
              semanticLabel: retryable
                  ? tr('auth.noInternetConnection')
                  : tr('auth.error'),
            ),
            const SizedBox(height: DsSpacing.lg),
            Text(
              key: const Key('login_error_message'),
              message,
              style: TextStyle(
                fontSize: ThemeManager().tokens.textMd,
                color: tokens.fg,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: DsSpacing.xl),
            Semantics(
              label: retryable ? tr('auth.retry') : tr('auth.signIn'),
              button: true,
              child: DsButton(
                key: const Key('login_retry_button'),
                label: retryable ? tr('auth.retry') : tr('auth.signIn'),
                variant: DsButtonVariant.primary,
                onPressed: () {
                  if (retryable) {
                    ref.read(authProvider.notifier).retryAuthorize();
                  } else {
                    ref.read(authProvider.notifier).authorize();
                  }
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
