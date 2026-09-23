import 'dart:async';

import 'package:http/http.dart' as http;

import 'auth_logger.dart';
import 'token_storage.dart';

class AuthInterceptor extends http.BaseClient {
  final http.Client _inner;
  final TokenStorage tokenStorage;
  final Future<void> Function() onRefreshToken;
  final AuthLogger? _logger;

  Completer<String?>? _refreshCompleter;

  AuthInterceptor({
    required http.Client inner,
    required this.tokenStorage,
    required this.onRefreshToken,
    AuthLogger? logger,
  }) : _inner = inner,
       _logger = logger;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final token = await tokenStorage.getAccessToken();
    if (token != null) {
      request.headers['Authorization'] = 'Bearer $token';
    }

    // Capture body bytes before first send — request body stream is consumed
    // after send(), so we need the bytes to build a retry request.
    List<int>? bodyBytes;
    if (request is http.Request) {
      bodyBytes = request.bodyBytes;
    }

    final response = await _inner.send(request);

    if (response.statusCode == 401 && token != null) {
      final newToken = await _refreshMutex();
      if (newToken == null) {
        // Distinguish "the session is over" from "we could not refresh right
        // now". A surviving refresh token means the user is still logged in and
        // the failure is transient, so callers should offer a retry rather than
        // a re-login.
        final stillHasSession =
            (await tokenStorage.getRefreshToken())?.isNotEmpty ?? false;
        _logger?.logAuthFailure(
          errorCode: stillHasSession
              ? 'INTERCEPTOR_REFRESH_TRANSIENT'
              : 'INTERCEPTOR_REFRESH_FAILED',
          httpStatus: 401,
          message: stillHasSession
              ? 'Token refresh failed — session preserved, retryable'
              : 'Token refresh failed — session expired',
          source: 'AuthInterceptor.send',
        );
        throw AuthException(
          stillHasSession ? 'Could not refresh the session' : 'Session expired',
          code: stillHasSession
              ? AuthException.transientFailure
              : AuthException.sessionExpired,
        );
      }

      final retryRequest = _buildRetryRequest(request, newToken, bodyBytes);

      _logger?.logAuthEvent(
        message: 'Request retried with new token',
        source: 'AuthInterceptor.send',
      );
      final retryResponse = await _inner.send(retryRequest);

      if (retryResponse.statusCode == 401) {
        _logger?.logAuthFailure(
          errorCode: 'INTERCEPTOR_RETRY_401',
          httpStatus: 401,
          message: 'Retry also returned 401 — session expired',
          source: 'AuthInterceptor.send',
        );
        throw AuthException('Session expired after refresh');
      }
      return retryResponse;
    }
    return response;
  }

  /// Builds a retry request with the new token, preserving the original body.
  /// For requests with a body (POST/PUT/PATCH), creates an [http.Request]
  /// with the captured body bytes. For bodyless requests (GET/DELETE),
  /// creates a minimal [http.StreamedRequest].
  http.BaseRequest _buildRetryRequest(
    http.BaseRequest original,
    String newToken,
    List<int>? bodyBytes,
  ) {
    if (bodyBytes != null) {
      final retry = http.Request(original.method, original.url)
        ..headers.addAll(original.headers)
        ..headers['Authorization'] = 'Bearer $newToken'
        ..bodyBytes = bodyBytes;
      return retry;
    }

    final retry = http.StreamedRequest(original.method, original.url)
      ..headers.addAll(original.headers)
      ..headers['Authorization'] = 'Bearer $newToken'
      ..contentLength = 0;
    retry.sink.close();
    return retry;
  }

  Future<String?> _refreshMutex() async {
    if (_refreshCompleter != null) {
      return _refreshCompleter!.future;
    }
    _refreshCompleter = Completer<String?>();
    try {
      _logger?.logAuthEvent(
        message: 'Token refresh triggered by 401',
        source: 'AuthInterceptor._refreshMutex',
      );
      final tokenBefore = await tokenStorage.getAccessToken();
      await onRefreshToken();
      final newToken = await tokenStorage.getAccessToken();

      // A refresh that leaves the SAME token in place did not succeed. The
      // notifier deliberately PRESERVES tokens on a transient failure, so
      // without this check the interceptor would retry with the stale token,
      // collect another 401, and misreport a network blip as an expired
      // session.
      final refreshed = newToken != null && newToken != tokenBefore;
      if (!refreshed) {
        _logger?.logAuthFailure(
          errorCode: 'INTERCEPTOR_REFRESH_NO_NEW_TOKEN',
          httpStatus: 401,
          message: 'Refresh produced no new token',
          source: 'AuthInterceptor._refreshMutex',
        );
      }
      _refreshCompleter!.complete(refreshed ? newToken : null);
      return refreshed ? newToken : null;
    } catch (e) {
      _refreshCompleter!.complete(null);
      return null;
    } finally {
      _refreshCompleter = null;
    }
  }
}

class AuthException implements Exception {
  /// No usable access token could be obtained and the refresh token was
  /// rejected or absent: the caller must route the user back to login rather
  /// than render a raw error.
  static const String sessionExpired = 'SESSION_EXPIRED';

  /// The refresh could not complete right now but the session was PRESERVED
  /// (the refresh token survives), so the caller should offer a retry rather
  /// than sending the user back to login.
  static const String transientFailure = 'TRANSIENT_FAILURE';

  final String message;

  /// Machine-readable discriminator, so a dead session can be distinguished
  /// from a transient failure without parsing [message].
  final String code;

  AuthException(this.message, {this.code = sessionExpired});

  @override
  String toString() => 'AuthException: $message';
}
