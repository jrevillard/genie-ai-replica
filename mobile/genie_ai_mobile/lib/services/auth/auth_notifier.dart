import 'dart:async';
import 'dart:convert';

import 'package:flutter_appauth/flutter_appauth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/widgets.dart';

import 'app_auth.dart';
import 'auth_logger.dart';
import 'auth_providers.dart';
import 'auth_state.dart';
import 'connectivity_checker.dart';
import 'network_error_classifier.dart';
import 'token_storage.dart';
import '../../providers/api_providers.dart';
import '../i18n_service.dart';
import '../keycloak/keycloak_service.dart';
import 'package:openapi/api.dart';

AuthorizationServiceConfiguration _serviceConfiguration(OidcEndpoints e) =>
    AuthorizationServiceConfiguration(
      authorizationEndpoint: e.authorizationEndpoint,
      tokenEndpoint: e.tokenEndpoint,
      endSessionEndpoint: e.endSessionEndpoint,
    );

String? _extractSub(String? idToken) {
  if (idToken == null || idToken.isEmpty) return null;
  try {
    final parts = idToken.split('.');
    if (parts.length != 3) return null;
    final payload = utf8.decode(base64Url.decode(base64Url.normalize(parts[1])));
    return (jsonDecode(payload) as Map<String, dynamic>)['sub'] as String?;
  } catch (_) {
    return null;
  }
}

enum _FailedOperation { none, authorize, refreshToken, validateTokens }

class AuthNotifier extends Notifier<AuthState> with WidgetsBindingObserver {
  static const Duration refreshTokenTimeout = Duration(seconds: 15);
  static const Duration discoveryTimeout = Duration(seconds: 10);

  late final TokenStorage _tokenStorage;
  late final KeycloakService _keycloakService;
  late final AppAuth _appAuth;
  late final AuthLogger _authLogger;
  late final AuthenticationApi _authenticationApi;
  late final ConnectivityChecker _connectivityChecker;
  final NetworkErrorClassifier _networkErrorClassifier = NetworkErrorClassifier();

  bool _isAuthorizing = false;
  bool _isRefreshing = false;
  _FailedOperation _lastFailedOperation = _FailedOperation.none;
  StreamSubscription<bool>? _connectivitySubscription;
  Timer? _debounceTimer;

  @override
  AuthState build() {
    _tokenStorage = ref.watch(tokenStorageProvider);
    _keycloakService = ref.watch(keycloakServiceProvider);
    _appAuth = ref.watch(appAuthProvider);
    _authLogger = ref.read(authLoggerProvider);
    _authenticationApi = ref.watch(authenticationApiProvider);
    _connectivityChecker = ref.watch(connectivityCheckerProvider);
    WidgetsBinding.instance.addObserver(this);
    ref.onDispose(() {
      WidgetsBinding.instance.removeObserver(this);
      _connectivitySubscription?.cancel();
      _debounceTimer?.cancel();
    });

    _connectivitySubscription = _connectivityChecker.onConnectivityChanged.listen(
      _onConnectivityChanged,
      onError: (Object e) {
        _authLogger.logAuthFailure(
          errorCode: 'CONNECTIVITY_STREAM_ERROR',
          message: 'Connectivity stream error: $e',
          source: 'AuthNotifier.build',
        );
      },
    );

    Future.microtask(() => _initializeAuth());
    return const AuthState.unauthenticated();
  }

  void _onConnectivityChanged(bool isOnline) {
    _debounceTimer?.cancel();
    _debounceTimer = Timer(const Duration(milliseconds: 500), () {
      if (isOnline &&
          state.status == AuthStatus.error &&
          state.retryable &&
          _lastFailedOperation != _FailedOperation.none) {
        _autoRetryLastFailedOperation();
      }
    });
  }

  Future<void> _autoRetryLastFailedOperation() async {
    switch (_lastFailedOperation) {
      case _FailedOperation.authorize:
        await retryAuthorize();
        break;
      case _FailedOperation.refreshToken:
      case _FailedOperation.validateTokens:
        await validateTokens();
        break;
      case _FailedOperation.none:
        break;
    }
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
      final idToken = await _tokenStorage.getIdToken();
      final userId = _extractSub(idToken);
      state = AuthState.authenticated(userId: userId);
      _authLogger.logAuthEvent(
        message: 'Authenticated from stored tokens',
        source: 'AuthNotifier._initializeAuth',
      );
      return;
    }

    await refreshToken();
  }

  Future<void> authorize() async {
    if (_isAuthorizing) return;
    _isAuthorizing = true;
    _lastFailedOperation = _FailedOperation.authorize;

    _authLogger.logAuthEvent(
      message: 'Authorization initiated',
      source: 'AuthNotifier.authorize',
    );

    try {
      // Layer 1: Fast-fail connectivity check
      if (!_connectivityChecker.isOnline) {
        _authLogger.logAuthFailure(
          errorCode: 'AUTH_NETWORK_OFFLINE',
          networkReachable: false,
          message: tr('auth.noInternetConnection'),
          source: 'AuthNotifier.authorize',
        );
        state = AuthState.error(
          message: tr('auth.noInternetConnection'),
          retryable: true,
        );
        return;
      }

      final endpoints = await _keycloakService.discoverEndpoints().timeout(
            discoveryTimeout,
            onTimeout: () {
              throw TimeoutException(
                'Discovery timed out',
                discoveryTimeout,
              );
            },
          );
      if (!ref.mounted) return;
      if (endpoints == null) {
        _authLogger.logAuthFailure(
          errorCode: 'AUTH_DISCOVERY_FAILED',
          keycloakEndpoint: _keycloakService.keycloakConfig.realmUrl,
          message: 'Network unreachable — endpoint discovery failed',
          source: 'AuthNotifier.authorize',
        );
        state = AuthState.error(
          message: tr('auth.networkUnreachable'),
          retryable: true,
        );
        return;
      }

      final tokenResponse = await _appAuth
          .authorizeAndExchangeCode(
            AuthorizationTokenRequest(
              _keycloakService.keycloakConfig.clientId,
              '${_keycloakService.keycloakConfig.redirectScheme}://callback',
              serviceConfiguration: _serviceConfiguration(endpoints),
              scopes: ['openid', 'profile', 'email', 'offline_access'],
              allowInsecureConnections:
                  _keycloakService.keycloakConfig.allowInsecureConnections,
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
        state = AuthState.error(
          message: tr('auth.authenticationFailed'),
          retryable: false,
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

      _lastFailedOperation = _FailedOperation.none;
      _authLogger.logAuthEvent(
        message: 'Authorization successful',
        source: 'AuthNotifier.authorize',
      );
      state = AuthState.authenticated(
        userId: _extractSub(tokenResponse.idToken),
      );
    } on FlutterAppAuthUserCancelledException {
      if (!ref.mounted) return;
      _lastFailedOperation = _FailedOperation.none;
      _authLogger.logAuthEvent(
        message: 'Authorization cancelled by user',
        source: 'AuthNotifier.authorize',
      );
      state = const AuthState.unauthenticated();
    } on FlutterAppAuthPlatformException catch (e) {
      // Layer 2: Safety net — catch network drops mid-operation
      if (_networkErrorClassifier.isNetworkError(e)) {
        _authLogger.logAuthFailure(
          errorCode: 'AUTH_NETWORK_OFFLINE_MID_OP',
          networkReachable: false,
          message: 'Network lost during authentication',
          source: 'AuthNotifier.authorize',
        );
        state = AuthState.error(
          message: tr('auth.noInternetConnection'),
          retryable: true,
        );
        return;
      }
      _authLogger.logAuthFailure(
        errorCode: 'AUTH_PLATFORM_ERROR',
        keycloakEndpoint: _keycloakService.keycloakConfig.realmUrl,
        message: e.message ?? tr('auth.authenticationFailed'),
        source: 'AuthNotifier.authorize',
      );
      state = AuthState.error(
        message: e.message ?? tr('auth.authenticationFailed'),
        retryable: false,
      );
    } on TimeoutException catch (e) {
      final isDiscovery =
          (e.message?.contains('Discovery') ?? false) ||
          e.duration == discoveryTimeout;
      _authLogger.logAuthFailure(
        errorCode: isDiscovery ? 'DISCOVERY_TIMEOUT' : 'AUTH_TIMEOUT',
        networkReachable: _connectivityChecker.isOnline,
        message: tr('auth.timeout'),
        source: 'AuthNotifier.authorize',
      );
      state = AuthState.error(
        message: tr('auth.timeout'),
        retryable: true,
      );
    } on FormatException catch (e) {
      _authLogger.logAuthFailure(
        errorCode: 'AUTH_MALFORMED_RESPONSE',
        keycloakEndpoint: _keycloakService.keycloakConfig.realmUrl,
        message: 'Malformed token response: $e',
        source: 'AuthNotifier.authorize',
      );
      state = AuthState.error(
        message: tr('auth.unknownError'),
        retryable: false,
      );
    } catch (e) {
      if (_networkErrorClassifier.isNetworkError(e)) {
        _authLogger.logAuthFailure(
          errorCode: 'AUTH_NETWORK_OFFLINE_MID_OP',
          networkReachable: false,
          message: 'Network lost during authorization',
          source: 'AuthNotifier.authorize',
        );
        state = AuthState.error(
          message: tr('auth.noInternetConnection'),
          retryable: true,
        );
      } else {
        _authLogger.logAuthFailure(
          errorCode: 'AUTH_FAILED',
          keycloakEndpoint: _keycloakService.keycloakConfig.realmUrl,
          message: 'Unexpected error during authorization',
          source: 'AuthNotifier.authorize',
        );
        state = AuthState.error(
          message: tr('auth.unknownError'),
          retryable: false,
        );
      }
    } finally {
      _isAuthorizing = false;
    }
  }

  Future<void> refreshToken() async {
    if (_isRefreshing) return;
    _isRefreshing = true;
    _lastFailedOperation = _FailedOperation.refreshToken;
    try {
      _authLogger.logAuthEvent(
        message: 'Token refresh initiated',
        source: 'AuthNotifier.refreshToken',
      );

      // Layer 1: Fast-fail connectivity check
      if (!_connectivityChecker.isOnline) {
        _authLogger.logAuthFailure(
          errorCode: 'REFRESH_NETWORK_OFFLINE',
          networkReachable: false,
          message: tr('auth.noInternetConnection'),
          source: 'AuthNotifier.refreshToken',
        );
        state = AuthState.error(
          message: tr('auth.noInternetConnection'),
          retryable: true,
        );
        return;
      }

      final currentRefreshToken = await _tokenStorage.getRefreshToken();
      if (!ref.mounted) return;
      if (currentRefreshToken == null || currentRefreshToken.isEmpty) {
        _lastFailedOperation = _FailedOperation.none;
        _authLogger.logAuthEvent(
          message: 'No refresh token available — unauthenticated',
          source: 'AuthNotifier.refreshToken',
        );
        state = const AuthState.unauthenticated();
        return;
      }

      try {
      final discoveryEndpoints = await _keycloakService.discoverEndpoints().timeout(
            discoveryTimeout,
            onTimeout: () {
              throw TimeoutException(
                'Discovery timed out',
                discoveryTimeout,
              );
            },
          );
      if (!ref.mounted) return;
      if (discoveryEndpoints == null) {
        _authLogger.logAuthFailure(
          errorCode: 'REFRESH_DISCOVERY_FAILED',
          keycloakEndpoint: _keycloakService.keycloakConfig.realmUrl,
          message: 'Endpoint discovery failed during token refresh',
          source: 'AuthNotifier.refreshToken',
        );
        state = const AuthState.unauthenticated();
        return;
      }

      final tokenResponse = await _appAuth
          .token(
            TokenRequest(
              _keycloakService.keycloakConfig.clientId,
              '${_keycloakService.keycloakConfig.redirectScheme}://callback',
              serviceConfiguration: _serviceConfiguration(discoveryEndpoints),
              grantType: 'refresh_token',
              refreshToken: currentRefreshToken,
              scopes: ['openid', 'profile', 'email', 'offline_access'],
              allowInsecureConnections:
                  _keycloakService.keycloakConfig.allowInsecureConnections,
            ),
          )
          .timeout(
            refreshTokenTimeout,
            onTimeout: () {
              throw TimeoutException(
                'Token refresh timed out',
                refreshTokenTimeout,
              );
            },
          );

      final expiration = tokenResponse.accessTokenExpirationDateTime ??
          DateTime.now().add(const Duration(seconds: 3600));

      final accessToken = tokenResponse.accessToken;
      if (accessToken == null) {
        _lastFailedOperation = _FailedOperation.none;
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

      _lastFailedOperation = _FailedOperation.none;
      _authLogger.logAuthEvent(
        message: 'Token refresh successful',
        source: 'AuthNotifier.refreshToken',
      );
      state = AuthState.authenticated(
        userId: _extractSub(tokenResponse.idToken),
      );
    } on FormatException catch (e) {
      _authLogger.logAuthFailure(
        errorCode: 'REFRESH_MALFORMED_RESPONSE',
        keycloakEndpoint: _keycloakService.keycloakConfig.realmUrl,
        message: 'Malformed token response: $e',
        source: 'AuthNotifier.refreshToken',
      );
      _lastFailedOperation = _FailedOperation.none;
      await _tokenStorage.deleteAll();
      if (!ref.mounted) return;
      state = AuthState(
        status: AuthStatus.unauthenticated,
        errorMessage: tr('auth.sessionExpired'),
      );
    } on TimeoutException catch (e) {
      final isDiscovery =
          (e.message?.contains('Discovery') ?? false) ||
          e.duration == discoveryTimeout;
      _authLogger.logAuthFailure(
        errorCode: isDiscovery ? 'REFRESH_DISCOVERY_TIMEOUT' : 'REFRESH_TIMEOUT',
        networkReachable: _connectivityChecker.isOnline,
        message: tr('auth.timeout'),
        source: 'AuthNotifier.refreshToken',
      );
      state = AuthState.error(
        message: tr('auth.timeout'),
        retryable: true,
      );
    } catch (e) {
      // Layer 2: Safety net — if network error, preserve tokens
      if (_networkErrorClassifier.isNetworkError(e)) {
        _authLogger.logAuthFailure(
          errorCode: 'REFRESH_NETWORK_OFFLINE_MID_OP',
          networkReachable: false,
          message: 'Network lost during token refresh',
          source: 'AuthNotifier.refreshToken',
        );
        state = AuthState.error(
          message: tr('auth.noInternetConnection'),
          retryable: true,
        );
        return;
      }
      _lastFailedOperation = _FailedOperation.none;
      _authLogger.logAuthFailure(
        errorCode: 'REFRESH_FAILED',
        keycloakEndpoint: _keycloakService.keycloakConfig.realmUrl,
        message: 'Token refresh failed — tokens cleared',
        source: 'AuthNotifier.refreshToken',
      );
      await _tokenStorage.deleteAll();
      if (!ref.mounted) return;
      state = AuthState(
        status: AuthStatus.unauthenticated,
        errorMessage: tr('auth.sessionExpired'),
      );
    }
    } finally {
      _isRefreshing = false;
    }
  }

  Future<void> logout() async {
    _authLogger.logAuthEvent(
      message: 'Logout initiated',
      source: 'AuthNotifier.logout',
    );

    final idToken = await _tokenStorage.getIdToken();
    if (!ref.mounted) return;

    await Future.wait<void>([
      _authenticationApi.apiAuthLogoutPost().then((_) {}).catchError((_) {}),
      _keycloakService.endSession(idTokenHint: idToken).catchError((_) => false),
    ]);
    if (!ref.mounted) return;

    await _tokenStorage.deleteAll().catchError((_) {});
    if (!ref.mounted) return;

    _lastFailedOperation = _FailedOperation.none;
    _authLogger.logAuthEvent(
      message: 'Logout completed',
      source: 'AuthNotifier.logout',
    );

    state = const AuthState.unauthenticated();
  }

  Future<void> validateTokens() async {
    _lastFailedOperation = _FailedOperation.validateTokens;
    _authLogger.logAuthEvent(
      message: 'Token validation on lifecycle resume',
      source: 'AuthNotifier.validateTokens',
    );

    final expiration = await _tokenStorage.getAccessTokenExpiration();
    if (!ref.mounted) return;
    if (expiration == null || expiration.isBefore(DateTime.now())) {
      _authLogger.logAuthFailure(
        errorCode: 'TOKEN_EXPIRED',
        message:
            'Access token expired or expiration unknown — attempting refresh',
        source: 'AuthNotifier.validateTokens',
      );
      await refreshToken();
      if (!ref.mounted) return;
      if (state.status == AuthStatus.authenticated) {
        _lastFailedOperation = _FailedOperation.none;
        _authLogger.logAuthEvent(
          message: 'Token refresh succeeded after expired access token',
          source: 'AuthNotifier.validateTokens',
        );
      }
    } else {
      _lastFailedOperation = _FailedOperation.none;
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (!ref.mounted) return;
    if (state == AppLifecycleState.resumed &&
        this.state.status == AuthStatus.authenticated) {
      _authLogger.logAuthEvent(
        message: 'App resumed — triggering token validation',
        source: 'AuthNotifier.didChangeAppLifecycleState',
      );
      validateTokens();
    }
  }

  Future<void> retryAuthorize() async {
    if (state.status != AuthStatus.error || !state.retryable) {
      return;
    }
    await authorize();
  }
}
