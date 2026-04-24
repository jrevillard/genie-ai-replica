import 'package:flutter_appauth/flutter_appauth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app_auth.dart';
import 'auth_providers.dart';
import 'auth_state.dart';
import 'token_storage.dart';
import '../keycloak/keycloak_service.dart';

class AuthNotifier extends Notifier<AuthState> {
  late final TokenStorage _tokenStorage;
  late final KeycloakService _keycloakService;
  late final AppAuth _appAuth;

  @override
  AuthState build() {
    _tokenStorage = ref.watch(tokenStorageProvider);
    _keycloakService = ref.watch(keycloakServiceProvider);
    _appAuth = ref.watch(appAuthProvider);
    Future.microtask(() => _initializeAuth());
    return const AuthState.unauthenticated();
  }

  Future<void> _initializeAuth() async {
    final expiration = await _tokenStorage.getAccessTokenExpiration();
    if (!ref.mounted) return;
    final hasTokens = await _tokenStorage.getAccessToken() != null;
    if (!ref.mounted) return;

    if (!hasTokens) {
      return;
    }

    if (expiration != null && expiration.isAfter(DateTime.now())) {
      state = const AuthState.authenticated();
      return;
    }

    await refreshToken();
  }

  Future<void> authorize() async {
    final endpoints = await _keycloakService.discoverEndpoints();
    if (!ref.mounted) return;
    if (endpoints == null) {
      state = const AuthState.error(
        message: 'Network unreachable',
        retryable: true,
      );
      return;
    }

    try {
      final tokenResponse = await _appAuth.authorizeAndExchangeCode(
        AuthorizationTokenRequest(
          _keycloakService.keycloakConfig.clientId,
          '${_keycloakService.keycloakConfig.redirectScheme}://callback',
          discoveryUrl: _keycloakService.keycloakConfig.realmUrl,
          scopes: ['openid', 'profile', 'email', 'offline_access'],
        ),
      );

      final expiration = tokenResponse.accessTokenExpirationDateTime ??
          DateTime.now().add(const Duration(seconds: 3600));

      final accessToken = tokenResponse.accessToken;
      if (accessToken == null) {
        state = const AuthState.error(
          message: 'Authentication failed',
          retryable: true,
        );
        return;
      }

      await _tokenStorage.saveTokens(
        accessToken: accessToken,
        idToken: tokenResponse.idToken ?? '',
        refreshToken: tokenResponse.refreshToken ?? '',
        accessTokenExpiration: expiration,
      );
      if (!ref.mounted) return;

      state = const AuthState.authenticated();
    } on FlutterAppAuthUserCancelledException {
      if (!ref.mounted) return;
      state = const AuthState.unauthenticated();
    } on FlutterAppAuthPlatformException catch (e) {
      state = AuthState.error(
        message: e.message ?? 'Authentication failed',
        retryable: true,
      );
    } catch (_) {
      state = const AuthState.error(
        message: 'Authentication failed',
        retryable: true,
      );
    }
  }

  Future<void> refreshToken() async {
    final currentRefreshToken = await _tokenStorage.getRefreshToken();
    if (!ref.mounted) return;
    if (currentRefreshToken == null || currentRefreshToken.isEmpty) {
      state = const AuthState.unauthenticated();
      return;
    }

    try {
      final tokenResponse = await _appAuth.token(
        TokenRequest(
          _keycloakService.keycloakConfig.clientId,
          '${_keycloakService.keycloakConfig.redirectScheme}://callback',
          discoveryUrl: _keycloakService.keycloakConfig.realmUrl,
          grantType: 'refresh_token',
          refreshToken: currentRefreshToken,
          scopes: ['openid', 'profile', 'email', 'offline_access'],
        ),
      );

      final expiration = tokenResponse.accessTokenExpirationDateTime ??
          DateTime.now().add(const Duration(seconds: 3600));

      final accessToken = tokenResponse.accessToken;
      if (accessToken == null) {
        state = const AuthState.unauthenticated();
        return;
      }

      await _tokenStorage.saveTokens(
        accessToken: accessToken,
        idToken: tokenResponse.idToken ?? '',
        refreshToken: tokenResponse.refreshToken ?? currentRefreshToken,
        accessTokenExpiration: expiration,
      );
      if (!ref.mounted) return;

      state = const AuthState.authenticated();
    } catch (_) {
      await _tokenStorage.deleteAll();
      if (!ref.mounted) return;
      state = const AuthState.unauthenticated();
    }
  }

  Future<void> validateTokens() async {
    final expiration = await _tokenStorage.getAccessTokenExpiration();
    if (!ref.mounted) return;
    if (expiration == null || expiration.isBefore(DateTime.now())) {
      await refreshToken();
    }
  }
}
