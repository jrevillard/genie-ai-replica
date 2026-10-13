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
import '../../services/api_service.dart';
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
    final payload = utf8.decode(
      base64Url.decode(base64Url.normalize(parts[1])),
    );
    return (jsonDecode(payload) as Map<String, dynamic>)['sub'] as String?;
  } catch (_) {
    return null;
  }
}

/// True only when the token endpoint definitively rejected the grant — i.e. the
/// refresh token is dead and no amount of retrying will help.
///
/// Everything else (network drops, timeouts, malformed bodies, unknown platform
/// errors) is treated as TRANSIENT and must not end the session. DW-325 was
/// exactly this mistake: the catch-all cleared every token on any failure, so a
/// single hiccup logged the user out permanently with no path back.
bool _isUnrecoverableGrantError(Object error) {
  final buffer = StringBuffer(error.toString());
  if (error is FlutterAppAuthPlatformException) {
    buffer
      ..write(' ')
      ..write(error.code);
    if (error.message != null) {
      buffer
        ..write(' ')
        ..write(error.message);
    }
    buffer
      ..write(' ')
      ..write(error.platformErrorDetails);
  }
  final text = buffer.toString().toLowerCase();
  return text.contains('invalid_grant') ||
      text.contains('invalid_token') ||
      text.contains('unauthorized_client');
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
  final NetworkErrorClassifier _networkErrorClassifier =
      NetworkErrorClassifier();

  bool _isAuthorizing = false;
  _FailedOperation _lastFailedOperation = _FailedOperation.none;
  StreamSubscription<bool>? _connectivitySubscription;
  Timer? _debounceTimer;

  /// Completes when an in-flight refresh finishes. Callers that arrive while a
  /// refresh is running must AWAIT this instead of returning early — returning
  /// early left them reading the previous (already expired) token and retrying
  /// straight into a second 401.
  Completer<void>? _refreshInFlight;

  /// Refreshes shortly before the access token expires so the ordinary case
  /// never reaches a 401 at all. Realm `genie` issues 5-minute tokens
  /// (`accessTokenLifespan=300`), so without this a foregrounded app 401s every
  /// few minutes and depends entirely on reactive recovery.
  Timer? _proactiveRefreshTimer;

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
      _proactiveRefreshTimer?.cancel();
    });

    _connectivitySubscription = _connectivityChecker.onConnectivityChanged
        .listen(
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
      _scheduleProactiveRefresh(expiration);
      _installApiServiceRefreshHook();
      await _pushTokenToApiService();
      if (!ref.mounted) return;
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
          throw TimeoutException('Discovery timed out', discoveryTimeout);
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

      final tokenResponse = await _appAuth.authorizeAndExchangeCode(
        AuthorizationTokenRequest(
          _keycloakService.keycloakConfig.clientId,
          '${_keycloakService.keycloakConfig.redirectScheme}://callback',
          serviceConfiguration: _serviceConfiguration(endpoints),
          scopes: ['openid', 'profile', 'email', 'offline_access'],
          allowInsecureConnections:
              _keycloakService.keycloakConfig.allowInsecureConnections,
        ),
      );

      final expiration =
          tokenResponse.accessTokenExpirationDateTime ??
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
      _scheduleProactiveRefresh(expiration);
      _authLogger.logAuthEvent(
        message: 'Authorization successful',
        source: 'AuthNotifier.authorize',
      );
      _installApiServiceRefreshHook();
      await _pushTokenToApiService();
      if (!ref.mounted) return;
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
      state = AuthState.error(message: tr('auth.timeout'), retryable: true);
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

  /// Pushes the current access token into the plain ApiService used by
  /// the agri features (they do not go through the openapi
  /// AuthInterceptor). Called on every authenticated transition.
  Future<void> _pushTokenToApiService() async {
    final token = await _tokenStorage.getAccessToken();
    if (token != null && token.isNotEmpty) {
      ApiService().setToken(token);
    } else {
      ApiService().clearToken();
    }
  }

  /// Installed once: lets ApiService retry a 401 after a real refresh.
  void _installApiServiceRefreshHook() {
    ApiService.refreshHook = () async {
      await refreshToken();
      final token = await _tokenStorage.getAccessToken();
      if (token != null && token.isNotEmpty) ApiService().setToken(token);
      return token != null && token.isNotEmpty;
    };
  }

  /// Schedules a refresh at ~80% of the token's remaining lifetime.
  ///
  /// The lead is clamped to [15s, 120s] so a short-lived token still refreshes
  /// promptly and a long-lived one does not fire absurdly early.
  void _scheduleProactiveRefresh(DateTime expiration) {
    _proactiveRefreshTimer?.cancel();
    final remaining = expiration.difference(DateTime.now());
    if (remaining.isNegative) return;

    var leadSeconds = (remaining.inSeconds * 0.2).round();
    if (leadSeconds < 15) leadSeconds = 15;
    if (leadSeconds > 120) leadSeconds = 120;

    final delay = remaining - Duration(seconds: leadSeconds);
    if (delay.isNegative) return;

    _proactiveRefreshTimer = Timer(delay, () {
      if (!ref.mounted) return;
      if (state.status != AuthStatus.authenticated) return;
      _authLogger.logAuthEvent(
        message: 'Proactive token refresh (expires in ${leadSeconds}s)',
        source: 'AuthNotifier._scheduleProactiveRefresh',
      );
      refreshToken();
    });
  }

  Future<void> refreshToken() async {
    // A caller arriving while a refresh is already running must WAIT for it.
    // The old `if (_isRefreshing) return;` returned immediately, so the caller
    // went on to read the still-expired token and retried into a second 401
    // (`AuthException: Session expired after refresh`).
    final inFlight = _refreshInFlight;
    if (inFlight != null) {
      await inFlight.future;
      return;
    }
    final completer = Completer<void>();
    _refreshInFlight = completer;
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
        final discoveryEndpoints = await _keycloakService
            .discoverEndpoints()
            .timeout(
              discoveryTimeout,
              onTimeout: () {
                throw TimeoutException('Discovery timed out', discoveryTimeout);
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

        final expiration =
            tokenResponse.accessTokenExpirationDateTime ??
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
        _scheduleProactiveRefresh(expiration);
        _authLogger.logAuthEvent(
          message: 'Token refresh successful',
          source: 'AuthNotifier.refreshToken',
        );
        await _pushTokenToApiService();
        if (!ref.mounted) return;
        state = AuthState.authenticated(
          userId: _extractSub(tokenResponse.idToken),
        );
      } on FormatException catch (e) {
        // A malformed body is a server/proxy hiccup, not a rejected grant.
        // Tokens are preserved so the next attempt can succeed.
        _lastFailedOperation = _FailedOperation.refreshToken;
        _authLogger.logAuthFailure(
          errorCode: 'REFRESH_MALFORMED_RESPONSE',
          keycloakEndpoint: _keycloakService.keycloakConfig.realmUrl,
          message: 'Malformed token response (tokens preserved): $e',
          source: 'AuthNotifier.refreshToken',
        );
        state = AuthState.error(message: tr('auth.timeout'), retryable: true);
      } on TimeoutException catch (e) {
        final isDiscovery =
            (e.message?.contains('Discovery') ?? false) ||
            e.duration == discoveryTimeout;
        _authLogger.logAuthFailure(
          errorCode: isDiscovery
              ? 'REFRESH_DISCOVERY_TIMEOUT'
              : 'REFRESH_TIMEOUT',
          networkReachable: _connectivityChecker.isOnline,
          message: tr('auth.timeout'),
          source: 'AuthNotifier.refreshToken',
        );
        state = AuthState.error(message: tr('auth.timeout'), retryable: true);
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
        // Only a definitive grant rejection may end the session. Clearing
        // tokens on anything else (the previous behaviour) logged the user out
        // permanently with no path back — see DW-325.
        if (!_isUnrecoverableGrantError(e)) {
          _lastFailedOperation = _FailedOperation.refreshToken;
          _authLogger.logAuthFailure(
            errorCode: 'REFRESH_TRANSIENT_FAILURE',
            networkReachable: _connectivityChecker.isOnline,
            keycloakEndpoint: _keycloakService.keycloakConfig.realmUrl,
            message: 'Token refresh failed transiently — tokens preserved: $e',
            source: 'AuthNotifier.refreshToken',
          );
          state = AuthState.error(message: tr('auth.timeout'), retryable: true);
          return;
        }
        _lastFailedOperation = _FailedOperation.none;
        _proactiveRefreshTimer?.cancel();
        _authLogger.logAuthFailure(
          errorCode: 'REFRESH_GRANT_REJECTED',
          keycloakEndpoint: _keycloakService.keycloakConfig.realmUrl,
          message: 'Refresh token rejected — session ended: $e',
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
      _refreshInFlight = null;
      if (!completer.isCompleted) completer.complete();
    }
  }

  Future<void> logout() async {
    // Stop the proactive timer first: a refresh firing mid-logout would race
    // the token wipe and could re-establish a session the user just ended.
    _proactiveRefreshTimer?.cancel();
    _authLogger.logAuthEvent(
      message: 'Logout initiated',
      source: 'AuthNotifier.logout',
    );

    final idToken = await _tokenStorage.getIdToken();
    if (!ref.mounted) return;

    await Future.wait<void>([
      _authenticationApi.apiAuthLogoutPost().then((_) {}).catchError((_) {}),
      _keycloakService
          .endSession(idTokenHint: idToken)
          .catchError((_) => false),
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
