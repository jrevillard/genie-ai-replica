import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:genie_ai_mobile/services/auth/auth_interceptor.dart';
import 'package:genie_ai_mobile/services/auth/auth_logger.dart';
import 'package:genie_ai_mobile/services/auth/token_storage.dart';

class _RecordingAuthLogger extends AuthLogger {
  final List<String> events = [];
  final List<String> failures = [];

  _RecordingAuthLogger() : super();

  @override
  void logAuthEvent({required String message, required String source}) {
    events.add('$source: $message');
    super.logAuthEvent(message: message, source: source);
  }

  @override
  void logAuthFailure({
    required String errorCode,
    String? keycloakEndpoint,
    int? httpStatus,
    bool? networkReachable,
    required String message,
    required String source,
  }) {
    failures.add('$source: $errorCode - $message');
    super.logAuthFailure(
      errorCode: errorCode,
      keycloakEndpoint: keycloakEndpoint,
      httpStatus: httpStatus,
      networkReachable: networkReachable,
      message: message,
      source: source,
    );
  }
}

class FakeTokenStorage implements TokenStorage {
  String? accessToken;
  String? idToken;
  String? refreshToken;
  DateTime? accessTokenExpiration;

  @override
  Future<String?> getAccessToken() async => accessToken;

  @override
  Future<String?> getIdToken() async => idToken;

  @override
  Future<String?> getRefreshToken() async => refreshToken;

  @override
  Future<DateTime?> getAccessTokenExpiration() async => accessTokenExpiration;

  @override
  Future<void> saveTokens({
    required String accessToken,
    required String idToken,
    required String refreshToken,
    required DateTime accessTokenExpiration,
  }) async {
    this.accessToken = accessToken;
    this.idToken = idToken;
    this.refreshToken = refreshToken;
    this.accessTokenExpiration = accessTokenExpiration;
  }

  @override
  Future<void> deleteAll() async {
    accessToken = null;
    idToken = null;
    refreshToken = null;
    accessTokenExpiration = null;
  }
}

/// A mock inner client that records requests and returns configurable responses.
/// Uses a [responseFn] callback so each call can decide what to return, avoiding
/// shared mutable state issues in concurrent tests.
class MockInnerClient extends http.BaseClient {
  final List<http.BaseRequest> requests = [];
  int callCount = 0;
  final http.StreamedResponse Function(http.BaseRequest request) responseFn;

  MockInnerClient({required this.responseFn});

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    requests.add(request);
    callCount++;
    return responseFn(request);
  }
}

http.StreamedResponse streamedResponse(int statusCode, String body) {
  return http.StreamedResponse(
    Stream.value(utf8.encode(body)),
    statusCode,
  );
}

void main() {
  late FakeTokenStorage tokenStorage;
  late _RecordingAuthLogger logger;
  late AuthInterceptor interceptor;

  /// Creates a fresh interceptor with default settings for each test.
  /// Override by reassigning [interceptor] inside individual tests.
  AuthInterceptor makeInterceptor({
    required http.StreamedResponse Function(http.BaseRequest) responseFn,
    Future<void> Function()? onRefreshToken,
  }) {
    return AuthInterceptor(
      inner: MockInnerClient(responseFn: responseFn),
      tokenStorage: tokenStorage,
      onRefreshToken: onRefreshToken ?? () async {},
      logger: logger,
    );
  }

  setUp(() {
    tokenStorage = FakeTokenStorage();
    logger = _RecordingAuthLogger();
    interceptor = makeInterceptor(
      responseFn: (_) => streamedResponse(200, ''),
    );
  });

  tearDown(() => interceptor.close());

  // --- Task 4.2: Bearer token injection ---
  group('Bearer token injection', () {
    test('injects Authorization: Bearer <token> header when token exists', () async {
      tokenStorage.accessToken = 'test-access-token';
      late http.BaseRequest captured;
      interceptor = makeInterceptor(responseFn: (req) {
        captured = req;
        return streamedResponse(200, 'ok');
      });

      final request = http.Request('GET', Uri.parse('https://api.example.com/data'));
      await interceptor.send(request);

      expect(captured.headers['Authorization'], equals('Bearer test-access-token'));
    });

    test('does NOT set Authorization header when token is null', () async {
      tokenStorage.accessToken = null;
      late http.BaseRequest captured;
      interceptor = makeInterceptor(responseFn: (req) {
        captured = req;
        return streamedResponse(200, 'ok');
      });

      final request = http.Request('GET', Uri.parse('https://api.example.com/data'));
      await interceptor.send(request);

      expect(captured.headers.containsKey('Authorization'), isFalse);
    });
  });

  // --- Task 4.4: 401 → refresh → retry ---
  group('401 → refresh → retry', () {
    test('triggers refresh on 401 and retries with new token', () async {
      tokenStorage.accessToken = 'old-token';
      var refreshCalled = false;
      var callIndex = 0;

      interceptor = makeInterceptor(
        responseFn: (_) {
          // First call returns 401, second returns 200
          callIndex++;
          if (callIndex == 1) return streamedResponse(401, 'Unauthorized');
          return streamedResponse(200, '{"ok": true}');
        },
        onRefreshToken: () async {
          refreshCalled = true;
          tokenStorage.accessToken = 'new-token';
        },
      );

      final request = http.Request('GET', Uri.parse('https://api.example.com/data'));
      final response = await interceptor.send(request);

      expect(refreshCalled, isTrue);
      expect(response.statusCode, equals(200));
    });
  });

  // --- Task 4.5: Concurrent 401 serialization ---
  group('Concurrent 401 serialization', () {
    test('serializes concurrent 401s — refresh called exactly once', () async {
      tokenStorage.accessToken = 'old-token';
      var refreshCallCount = 0;
      final refreshStarted = Completer<void>();
      final refreshAllowed = Completer<void>();

      interceptor = AuthInterceptor(
        inner: MockInnerClient(responseFn: (req) {
          // All calls return 401 — retries will also fail
          return streamedResponse(401, 'Unauthorized');
        }),
        tokenStorage: tokenStorage,
        onRefreshToken: () async {
          refreshCallCount++;
          refreshStarted.complete();
          // Wait until the test signals that all concurrent requests have
          // entered the mutex await, proving serialization.
          await refreshAllowed.future;
          tokenStorage.accessToken = 'new-token';
        },
        logger: logger,
      );

      // Fire 3 concurrent requests that will all get 401.
      // The first one triggers refresh; the other 2 await the same Completer.
      final futures = [
        interceptor.send(http.Request('GET', Uri.parse('https://api.example.com/1'))),
        interceptor.send(http.Request('GET', Uri.parse('https://api.example.com/2'))),
        interceptor.send(http.Request('GET', Uri.parse('https://api.example.com/3'))),
      ];

      // Wait for refresh to start, then a small delay to ensure the other
      // requests have entered the mutex await path.
      await refreshStarted.future;
      await Future.delayed(const Duration(milliseconds: 50));

      // Now allow the refresh to complete
      refreshAllowed.complete();

      // All requests retry with the new token but mock still returns 401,
      // so all throw AuthException.
      final errors = <AuthException>[];
      for (final future in futures) {
        try {
          await future;
        } on AuthException catch (e) {
          errors.add(e);
        }
      }

      expect(refreshCallCount, equals(1));
      // All 3 requests should throw AuthException (retry also 401)
      expect(errors.length, equals(3));
    });
  });

  // --- Task 4.6: Retry also 401 → AuthException ---
  group('Retry also 401', () {
    test('throws AuthException when retry also returns 401', () async {
      tokenStorage.accessToken = 'old-token';

      interceptor = makeInterceptor(
        responseFn: (_) => streamedResponse(401, 'Unauthorized'),
        onRefreshToken: () async {
          tokenStorage.accessToken = 'new-token';
        },
      );

      final request = http.Request('GET', Uri.parse('https://api.example.com/data'));

      expect(
        () => interceptor.send(request),
        throwsA(isA<AuthException>()),
      );
    });
  });

  // --- Task 4.7: Refresh failure → AuthException ---
  group('Refresh failure', () {
    test('throws AuthException when refresh callback throws', () async {
      tokenStorage.accessToken = 'old-token';

      interceptor = makeInterceptor(
        responseFn: (_) => streamedResponse(401, 'Unauthorized'),
        onRefreshToken: () async {
          throw Exception('Network error');
        },
      );

      final request = http.Request('GET', Uri.parse('https://api.example.com/data'));

      expect(
        () => interceptor.send(request),
        throwsA(isA<AuthException>()),
      );
    });

    test('throws AuthException when refresh returns null token', () async {
      tokenStorage.accessToken = 'old-token';

      interceptor = makeInterceptor(
        responseFn: (_) => streamedResponse(401, 'Unauthorized'),
        onRefreshToken: () async {
          tokenStorage.accessToken = null;
        },
      );

      final request = http.Request('GET', Uri.parse('https://api.example.com/data'));

      expect(
        () => interceptor.send(request),
        throwsA(isA<AuthException>()),
      );
    });
  });

  // --- Task 4.9: Non-401 errors pass through ---
  group('Non-401 pass-through', () {
    test('500 error passes through without refresh', () async {
      tokenStorage.accessToken = 'some-token';
      var refreshCalled = false;

      interceptor = makeInterceptor(
        responseFn: (_) => streamedResponse(500, 'Internal Server Error'),
        onRefreshToken: () async {
          refreshCalled = true;
        },
      );

      final request = http.Request('GET', Uri.parse('https://api.example.com/data'));
      final response = await interceptor.send(request);

      expect(response.statusCode, equals(500));
      expect(refreshCalled, isFalse);
    });

    test('403 error does not trigger refresh', () async {
      tokenStorage.accessToken = 'some-token';
      var refreshCalled = false;

      interceptor = makeInterceptor(
        responseFn: (_) => streamedResponse(403, 'Forbidden'),
        onRefreshToken: () async {
          refreshCalled = true;
        },
      );

      final request = http.Request('GET', Uri.parse('https://api.example.com/data'));
      final response = await interceptor.send(request);

      expect(response.statusCode, equals(403));
      expect(refreshCalled, isFalse);
    });
  });

  // --- Task 4.8: Request cloning ---
  group('Request cloning', () {
    test('retry preserves request body from original POST', () async {
      tokenStorage.accessToken = 'old-token';
      final requestBody = jsonEncode({'key': 'value'});
      var callIndex = 0;
      late http.BaseRequest retryRequest;

      interceptor = AuthInterceptor(
        inner: MockInnerClient(responseFn: (req) {
          callIndex++;
          if (callIndex == 1) return streamedResponse(401, 'Unauthorized');
          retryRequest = req;
          return streamedResponse(200, '{"ok": true}');
        }),
        tokenStorage: tokenStorage,
        onRefreshToken: () async {
          tokenStorage.accessToken = 'new-token';
        },
        logger: logger,
      );

      final request = http.Request('POST', Uri.parse('https://api.example.com/data'));
      request.body = requestBody;
      request.headers['Content-Type'] = 'application/json';

      final response = await interceptor.send(request);

      expect(response.statusCode, equals(200));
      expect(callIndex, equals(2));
      // Verify the retry request preserved the body
      expect(retryRequest, isA<http.Request>());
      expect((retryRequest as http.Request).body, equals(requestBody));
      expect(retryRequest.headers['Authorization'], equals('Bearer new-token'));
    });
  });

  // --- Logging ---
  group('Logging', () {
    test('logs token refresh triggered by 401', () async {
      tokenStorage.accessToken = 'old-token';
      var callIndex = 0;

      interceptor = makeInterceptor(
        responseFn: (_) {
          callIndex++;
          if (callIndex == 1) return streamedResponse(401, 'Unauthorized');
          return streamedResponse(200, '{"ok": true}');
        },
        onRefreshToken: () async {
          tokenStorage.accessToken = 'new-token';
        },
      );

      final request = http.Request('GET', Uri.parse('https://api.example.com/data'));
      await interceptor.send(request);

      expect(
        logger.events.any((e) => e.contains('Token refresh triggered by 401')),
        isTrue,
      );
    });

    test('logs request retried with new token', () async {
      tokenStorage.accessToken = 'old-token';
      var callIndex = 0;

      interceptor = makeInterceptor(
        responseFn: (_) {
          callIndex++;
          if (callIndex == 1) return streamedResponse(401, 'Unauthorized');
          return streamedResponse(200, '{"ok": true}');
        },
        onRefreshToken: () async {
          tokenStorage.accessToken = 'new-token';
        },
      );

      final request = http.Request('GET', Uri.parse('https://api.example.com/data'));
      await interceptor.send(request);

      expect(
        logger.events.any((e) => e.contains('Request retried with new token')),
        isTrue,
      );
    });

    test('logs failure when refresh fails', () async {
      tokenStorage.accessToken = 'old-token';

      interceptor = makeInterceptor(
        responseFn: (_) => streamedResponse(401, 'Unauthorized'),
        onRefreshToken: () async {
          throw Exception('fail');
        },
      );

      final request = http.Request('GET', Uri.parse('https://api.example.com/data'));
      try {
        await interceptor.send(request);
      } catch (_) {}

      expect(
        logger.failures.any((e) => e.contains('INTERCEPTOR_REFRESH_FAILED')),
        isTrue,
      );
    });
  });

  // --- AuthException ---
  group('AuthException', () {
    test('has message field and toString', () {
      final ex = AuthException('Session expired');
      expect(ex.message, equals('Session expired'));
      expect(ex.toString(), equals('AuthException: Session expired'));
      expect(ex, isA<Exception>());
    });
  });
}
