import 'package:flutter_appauth/flutter_appauth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app_auth.dart';
import 'auth_logger.dart';
import 'auth_providers.dart';
import 'auth_state.dart';
import 'token_storage.dart';
import '../keycloak/keycloak_service.dart';

class AuthNotifier extends Notifier<AuthState> {
  late final TokenStorage _tokenStorage;
  late final KeycloakService _keycloakService;
  late final AppAuth _appAuth;
  late final AuthLogger _authLogger;

  @override
  AuthState build() {
    _tokenStorage = ref.watch(tokenStorageProvider);
    _keycloakService = ref.watch(keycloakServiceProvider);
    _appAuth = ref.watch(appAuthProvider);
    _authLogger = ref.read(authLoggerProvider);
    Future.microtask(() => _initializeAuth());
    return const AuthState.unauthenticated();
  }

  Future<void> _initializeAuth() async {
    _authLogger.logAuthEvent(
      message: 'Auth initialization',
      source: 'AuthNotifier._initializeAuth',
    );

    final expiration = await _tokenStorage.getAccessTokenExpiration();
    if (!ref.mounted) return;
    final hasTokens = await _tokenStorage.getAccessToken() != null;
    if (!ref.mounted) return;

    if (!hasTokens) {
      _authLogger.logAuthEvent(
        message: 'No stored tokens — unauthenticated',
        source: 'AuthNotifier._initializeAuth',
      );
      return;
    }

    if (expiration != null && expiration.isAfter(DateTime.now())) {
      state = const AuthState.authenticated();
      _authLogger.logAuthEvent(
        message: 'Authenticated from stored tokens',
        source: 'AuthNotifier._initializeAuth',
      );
      return;
    }

    await refreshToken();
  }

  Future<void> authorize() async {
    _authLogger.logAuthEvent(
      message: 'Authorization initiated',
      source: 'AuthNotifier.authorize',
    );

    final endpoints = await _keycloakService.discoverEndpoints();
    if (!ref.mounted) return;
    if (endpoints == null) {
      _authLogger.logAuthFailure(
        errorCode: 'AUTH_DISCOVERY_FAILED',
        keycloakEndpoint: _keycloakService.keycloakConfig.realmUrl,
        message: 'Network unreachable — endpoint discovery failed',
        source: 'AuthNotifier.authorize',
      );
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
        _authLogger.logAuthFailure(
          errorCode: 'AUTH_FAILED',
          keycloakEndpoint: _keycloakService.keycloakConfig.realmUrl,
          message: 'No access token in response',
          source: 'AuthNotifier.authorize',
        );
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

      _authLogger.logAuthEvent(
        message: 'Authorization successful',
        source: 'AuthNotifier.authorize',
      );
      state = const AuthState.authenticated();
    } on FlutterAppAuthUserCancelledException {
      if (!ref.mounted) return;
      _authLogger.logAuthEvent(
        message: 'Authorization cancelled by user',
        source: 'AuthNotifier.authorize',
      );
      state = const AuthState.unauthenticated();
    } on FlutterAppAuthPlatformException catch (e) {
      _authLogger.logAuthFailure(
        errorCode: 'AUTH_PLATFORM_ERROR',
        keycloakEndpoint: _keycloakService.keycloakConfig.realmUrl,
        message: e.message ?? 'Authentication failed',
        source: 'AuthNotifier.authorize',
      );
      state = AuthState.error(
        message: e.message ?? 'Authentication failed',
        retryable: true,
      );
    } catch (_) {
      _authLogger.logAuthFailure(
        errorCode: 'AUTH_FAILED',
        keycloakEndpoint: _keycloakService.keycloakConfig.realmUrl,
        message: 'Unexpected error during authorization',
        source: 'AuthNotifier.authorize',
      );
      state = const AuthState.error(
        message: 'Authentication failed',
        retryable: true,
      );
    }
  }

  Future<void> refreshToken() async {
    _authLogger.logAuthEvent(
      message: 'Token refresh initiated',
      source: 'AuthNotifier.refreshToken',
    );

    final currentRefreshToken = await _tokenStorage.getRefreshToken();
    if (!ref.mounted) return;
    if (currentRefreshToken == null || currentRefreshToken.isEmpty) {
      _authLogger.logAuthEvent(
        message: 'No refresh token available — unauthenticated',
        source: 'AuthNotifier.refreshToken',
      );
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
        _authLogger.logAuthFailure(
          errorCode: 'REFRESH_FAILED',
          keycloakEndpoint: _keycloakService.keycloakConfig.realmUrl,
          message: 'No access token in refresh response',
          source: 'AuthNotifier.refreshToken',
        );
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

      _authLogger.logAuthEvent(
        message: 'Token refresh successful',
        source: 'AuthNotifier.refreshToken',
      );
      state = const AuthState.authenticated();
    } catch (_) {
      _authLogger.logAuthFailure(
        errorCode: 'REFRESH_FAILED',
        keycloakEndpoint: _keycloakService.keycloakConfig.realmUrl,
        message: 'Token refresh failed — tokens cleared',
        source: 'AuthNotifier.refreshToken',
      );
      await _tokenStorage.deleteAll();
      if (!ref.mounted) return;
      state = const AuthState.unauthenticated();
    }
  }

  Future<void> validateTokens() async {
    _authLogger.logAuthEvent(
      message: 'Token validation on lifecycle resume',
      source: 'AuthNotifier.validateTokens',
    );

    final expiration = await _tokenStorage.getAccessTokenExpiration();
    if (!ref.mounted) return;
    if (expiration == null || expiration.isBefore(DateTime.now())) {
      _authLogger.logAuthFailure(
        errorCode: 'TOKEN_EXPIRED',
        message: 'Access token expired — attempting refresh',
        source: 'AuthNotifier.validateTokens',
      );
      await refreshToken();
    }
  }
}
