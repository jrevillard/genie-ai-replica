import 'dart:async';
import 'dart:convert';

import 'package:flutter_appauth/flutter_appauth.dart';

import '../i18n_service.dart';
import 'app_auth.dart';
import 'auth_logger.dart';
import 'connectivity_checker.dart';
import 'network_error_classifier.dart';
import 'token_storage.dart';
import '../keycloak/keycloak_service.dart';

/// How a token refresh ended — the state-mapping input [TokenRefresher]
/// hands its listeners (#2019 half-two). The refresher is a LEAF: it owns
/// the mechanism and reports, it never touches the auth state itself, so
/// it can be depended on from anywhere in the Riverpod graph without
/// re-entering `authProvider`.
sealed class RefreshOutcome {
  const RefreshOutcome();
}

/// Fresh tokens stored; the session lives.
class RefreshSuccess extends RefreshOutcome {
  const RefreshSuccess({this.userId});

  final String? userId;
}

/// The session is over (no refresh token, refresh refused, tokens cleared).
/// [message] carries the user-facing notice when the session expired
/// mid-flight; [clearsRetry] mirrors the old arm's retry-flag handling —
/// discovery failures leave the retry flag alone.
class RefreshUnauthenticated extends RefreshOutcome {
  const RefreshUnauthenticated({this.message, this.clearsRetry = true});

  final String? message;
  final bool clearsRetry;
}

/// Transient failure worth retrying (offline, timeout) — tokens kept.
class RefreshRetryable extends RefreshOutcome {
  const RefreshRetryable(this.message);

  final String message;
}

/// The OIDC `sub` claim of an id token — the app's stable user id.
String? extractSub(String? idToken) {
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

/// Refreshes Keycloak tokens out-of-band — the mechanism only, no state.
///
/// #2019 half-two (2026-11-20): the interceptor's refresh closure used to
/// read `authProvider.notifier` from `authenticatedApiProvider`'s Ref — an
/// element inside `authProvider`'s own listener tree — and Riverpod 3
/// raised CircularDependencyError on EVERY invocation: a 401 could never
/// recover and each access-token expiry killed the session. This class is
/// the leaf both sides now share: it depends only on the auth leaf
/// providers, so reading it never re-enters the auth graph, and its
/// single-flight future spans BOTH entry paths (notifier-driven and
/// interceptor-driven) so Keycloak's rotating refresh token is never
/// spent twice concurrently.
///
/// The refresh logic moved verbatim from `AuthNotifier._refreshTokenLocked`
/// — same arms, same error codes, same log sources. State mapping happens
/// in the notifier via [addListener].
class TokenRefresher {
  TokenRefresher({
    required KeycloakService keycloakService,
    required AppAuth appAuth,
    required TokenStorage tokenStorage,
    required ConnectivityChecker connectivityChecker,
    AuthLogger? logger,
  }) : _keycloakService = keycloakService,
       _appAuth = appAuth,
       _tokenStorage = tokenStorage,
       _connectivityChecker = connectivityChecker,
       _logger = logger;

  static const Duration refreshTokenTimeout = Duration(seconds: 15);
  static const Duration discoveryTimeout = Duration(seconds: 10);

  final KeycloakService _keycloakService;
  final AppAuth _appAuth;
  final TokenStorage _tokenStorage;
  final ConnectivityChecker _connectivityChecker;
  final AuthLogger? _logger;
  final NetworkErrorClassifier _networkErrorClassifier =
      NetworkErrorClassifier();
  final List<void Function(RefreshOutcome)> _listeners = [];

  /// The in-flight refresh, shared by concurrent callers — notifier-driven
  /// and interceptor-driven alike (#2019). Null when none is running.
  Future<RefreshOutcome>? _inFlight;

  void addListener(void Function(RefreshOutcome outcome) listener) {
    _listeners.add(listener);
  }

  void removeListener(void Function(RefreshOutcome outcome) listener) {
    _listeners.remove(listener);
  }

  /// Runs one refresh, shared across concurrent callers, and broadcasts
  /// the outcome to the listeners BEFORE the future completes — a caller
  /// resuming from `await` observes the mapped state already applied.
  Future<RefreshOutcome> refresh() {
    final running = _inFlight;
    if (running != null) return running;
    final future = _refreshLocked();
    _inFlight = future;
    return future;
  }

  Future<RefreshOutcome> _refreshLocked() async {
    try {
      final outcome = await _doRefresh();
      for (final listener in _listeners) {
        listener(outcome);
      }
      return outcome;
    } catch (e) {
      // The MECHANISM itself faulted outside every arm (a storage read
      // throwing, e.g. a corrupted keystore — the early section of
      // _doRefresh sits outside its try). The old refreshToken caught
      // EVERY exception; the leaf refactor must preserve that contract —
      // a fire-and-forget caller (the interceptor) would otherwise get a
      // rejected future and an unhandled zone error.
      _logger?.logAuthFailure(
        errorCode: 'REFRESH_FAILED',
        keycloakEndpoint: _keycloakService.keycloakConfig.realmUrl,
        message: 'Token refresh mechanism fault: $e',
        source: 'TokenRefresher.refresh',
      );
      try {
        await _tokenStorage.deleteAll();
      } catch (_) {
        // Storage is broken; clearing is best-effort — never mask the arm.
      }
      const outcome = RefreshUnauthenticated(message: null);
      for (final listener in _listeners) {
        listener(outcome);
      }
      return outcome;
    } finally {
      _inFlight = null;
    }
  }

  Future<RefreshOutcome> _doRefresh() async {
    _logger?.logAuthEvent(
      message: 'Token refresh initiated',
      source: 'TokenRefresher.refresh',
    );

    // Layer 1: Fast-fail connectivity check
    if (!_connectivityChecker.isOnline) {
      _logger?.logAuthFailure(
        errorCode: 'REFRESH_NETWORK_OFFLINE',
        networkReachable: false,
        message: tr('auth.noInternetConnection'),
        source: 'TokenRefresher.refresh',
      );
      return RefreshRetryable(tr('auth.noInternetConnection'));
    }

    final currentRefreshToken = await _tokenStorage.getRefreshToken();
    if (currentRefreshToken == null || currentRefreshToken.isEmpty) {
      _logger?.logAuthEvent(
        message: 'No refresh token available — unauthenticated',
        source: 'TokenRefresher.refresh',
      );
      return const RefreshUnauthenticated();
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
      if (discoveryEndpoints == null) {
        _logger?.logAuthFailure(
          errorCode: 'REFRESH_DISCOVERY_FAILED',
          keycloakEndpoint: _keycloakService.keycloakConfig.realmUrl,
          message: 'Endpoint discovery failed during token refresh',
          source: 'TokenRefresher.refresh',
        );
        return const RefreshUnauthenticated(clearsRetry: false);
      }

      final tokenResponse = await _appAuth
          .token(
            TokenRequest(
              _keycloakService.keycloakConfig.clientId,
              '${_keycloakService.keycloakConfig.redirectScheme}://callback',
              serviceConfiguration: AuthorizationServiceConfiguration(
                authorizationEndpoint: discoveryEndpoints.authorizationEndpoint,
                tokenEndpoint: discoveryEndpoints.tokenEndpoint,
                endSessionEndpoint: discoveryEndpoints.endSessionEndpoint,
              ),
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
        _logger?.logAuthFailure(
          errorCode: 'REFRESH_FAILED',
          keycloakEndpoint: _keycloakService.keycloakConfig.realmUrl,
          message: 'No access token in refresh response',
          source: 'TokenRefresher.refresh',
        );
        return const RefreshUnauthenticated();
      }

      await _tokenStorage.saveTokens(
        accessToken: accessToken,
        idToken: tokenResponse.idToken ?? '',
        refreshToken: tokenResponse.refreshToken ?? currentRefreshToken,
        accessTokenExpiration: expiration,
      );

      _logger?.logAuthEvent(
        message: 'Token refresh successful',
        source: 'TokenRefresher.refresh',
      );
      return RefreshSuccess(userId: extractSub(tokenResponse.idToken));
    } on FormatException catch (e) {
      _logger?.logAuthFailure(
        errorCode: 'REFRESH_MALFORMED_RESPONSE',
        keycloakEndpoint: _keycloakService.keycloakConfig.realmUrl,
        message: 'Malformed token response: $e',
        source: 'TokenRefresher.refresh',
      );
      await _tokenStorage.deleteAll();
      return RefreshUnauthenticated(message: tr('auth.sessionExpired'));
    } on TimeoutException catch (e) {
      final isDiscovery =
          (e.message?.contains('Discovery') ?? false) ||
          e.duration == discoveryTimeout;
      _logger?.logAuthFailure(
        errorCode: isDiscovery
            ? 'REFRESH_DISCOVERY_TIMEOUT'
            : 'REFRESH_TIMEOUT',
        networkReachable: _connectivityChecker.isOnline,
        message: tr('auth.timeout'),
        source: 'TokenRefresher.refresh',
      );
      return RefreshRetryable(tr('auth.timeout'));
    } catch (e) {
      // Layer 2: Safety net — if network error, preserve tokens
      if (_networkErrorClassifier.isNetworkError(e)) {
        _logger?.logAuthFailure(
          errorCode: 'REFRESH_NETWORK_OFFLINE_MID_OP',
          networkReachable: false,
          message: 'Network lost during token refresh',
          source: 'TokenRefresher.refresh',
        );
        return RefreshRetryable(tr('auth.noInternetConnection'));
      }
      _logger?.logAuthFailure(
        errorCode: 'REFRESH_FAILED',
        keycloakEndpoint: _keycloakService.keycloakConfig.realmUrl,
        message: 'Token refresh failed — tokens cleared',
        source: 'TokenRefresher.refresh',
      );
      await _tokenStorage.deleteAll();
      return RefreshUnauthenticated(message: tr('auth.sessionExpired'));
    }
  }
}
