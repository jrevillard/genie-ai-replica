import 'dart:async';

import 'package:flutter_appauth/flutter_appauth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/config/keycloak_config.dart';
import 'package:genie_ai_mobile/providers/api_providers.dart';
import 'package:genie_ai_mobile/services/auth/app_auth.dart';
import 'package:genie_ai_mobile/services/auth/auth_interceptor.dart';
import 'package:genie_ai_mobile/services/auth/auth_logger.dart';
import 'package:genie_ai_mobile/services/auth/auth_providers.dart';
import 'package:genie_ai_mobile/services/auth/auth_state.dart';
import 'package:genie_ai_mobile/services/auth/connectivity_checker.dart';
import 'package:genie_ai_mobile/services/auth/token_storage.dart';
import 'package:genie_ai_mobile/services/keycloak/keycloak_service.dart';
import 'package:openapi/api.dart';

/// The REAL authenticated-API graph (#2019 half-two, 2026-11-20): unlike the
/// auth_notifier suite, these tests do NOT override `authenticationApiProvider`
/// — the whole point is the graph as production builds it, where
/// `authenticatedApiProvider` wires the interceptor's refresh closure.
///
/// The 2026-11-20 emulator evidence: every 401-triggered refresh died with
/// Riverpod's CircularDependencyError — `AuthNotifier.build` watches
/// `authenticationApiProvider`, whose graph wires the interceptor with a
/// closure reading `authProvider.notifier`, so the refresh closure ran from
/// an element inside `authProvider`'s own listener tree. Riverpod 3 detects
/// the loop on EVERY call — the session silently died at each token expiry.
class _MockAppAuth implements AppAuth {
  AuthorizationTokenResponse Function(AuthorizationTokenRequest)? onAuthorize;
  TokenResponse Function(TokenRequest)? onToken;
  Exception? tokenException;

  @override
  Future<AuthorizationTokenResponse> authorizeAndExchangeCode(
    AuthorizationTokenRequest request,
  ) async {
    final make = onAuthorize;
    if (make == null) throw StateError('authorize not stubbed');
    return make(request);
  }

  @override
  Future<TokenResponse> token(TokenRequest request) async {
    if (tokenException != null) throw tokenException!;
    final make = onToken;
    if (make == null) throw StateError('token not stubbed');
    return make(request);
  }
}

class _FakeKeycloakService extends KeycloakService {
  _FakeKeycloakService({required super.keycloakConfig});

  final OidcEndpoints endpoints = const OidcEndpoints(
    authorizationEndpoint: 'http://localhost:8080/auth',
    tokenEndpoint: 'http://localhost:8080/token',
    userinfoEndpoint: 'http://localhost:8080/userinfo',
    endSessionEndpoint: 'http://localhost:8080/logout',
  );

  @override
  Future<OidcEndpoints?> discoverEndpoints() async => endpoints;

  @override
  Future<bool> endSession({String? idTokenHint}) async => true;
}

class _FakeTokenStorage implements TokenStorage {
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

class _FakeConnectivityChecker implements ConnectivityChecker {
  @override
  bool isOnline = true;

  @override
  Stream<bool> get onConnectivityChanged => const Stream<bool>.empty();
}

final _testConfig = KeycloakConfig(
  keycloakUrl: 'http://localhost:8080',
  realm: 'genie',
  clientId: 'test-client',
  redirectScheme: 'com.test.app',
  backendUrl: 'http://localhost:3000',
);

TokenResponse _freshTokens() => TokenResponse(
  'fresh-at',
  'fresh-rt',
  DateTime.now().add(const Duration(hours: 1)),
  null,
  'Bearer',
  null,
  null,
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late ProviderContainer container;
  late _FakeTokenStorage storage;
  late _MockAppAuth appAuth;

  setUp(() {
    storage = _FakeTokenStorage();
    appAuth = _MockAppAuth();
    container = ProviderContainer(
      overrides: [
        tokenStorageProvider.overrideWithValue(storage),
        keycloakServiceProvider.overrideWithValue(
          _FakeKeycloakService(keycloakConfig: _testConfig),
        ),
        appAuthProvider.overrideWithValue(appAuth),
        authLoggerProvider.overrideWithValue(AuthLogger()),
        connectivityCheckerProvider.overrideWithValue(
          _FakeConnectivityChecker(),
        ),
        // Deliberately NO override for authenticationApiProvider or
        // authenticatedApiProvider — production's graph IS the subject.
      ],
    );
  });

  tearDown(() => container.dispose());

  /// Builds authProvider first (its listener contract asserted below), lets
  /// the init microtask settle on an empty store, then seeds a live session.
  Future<void> seedAuthenticatedSession() async {
    container.read(authProvider);
    await Future<void>.delayed(Duration.zero);
    await Future<void>.delayed(Duration.zero);
    await storage.saveTokens(
      accessToken: 'stale-at',
      idToken: 'stale-idt',
      refreshToken: 'stale-rt',
      accessTokenExpiration: DateTime.now().add(const Duration(hours: 1)),
    );
  }

  AuthInterceptor interceptorOfContainer() =>
      container.read(authenticatedHttpClientProvider) as AuthInterceptor;

  test(
    'the interceptor refresh closure never re-enters authProvider '
    '(#2019 half-two: the live CircularDependencyError)',
    () async {
      await seedAuthenticatedSession();
      final interceptor = interceptorOfContainer();
      appAuth.onToken = (_) => _freshTokens();

      // The 2026-11-20 live fault: this threw Riverpod's
      // CircularDependencyError on EVERY invocation, so a 401 could never
      // recover — the session died at the first access-token expiry.
      await interceptor.onRefreshToken();

      expect(await storage.getAccessToken(), equals('fresh-at'));
      expect(await storage.getRefreshToken(), equals('fresh-rt'));
    },
  );

  test(
    'an interceptor-triggered refresh updates the auth state '
    '— the session-expiry contract the UI observes',
    () async {
      await seedAuthenticatedSession();
      final interceptor = interceptorOfContainer();
      appAuth.onToken = (_) => _freshTokens();

      await interceptor.onRefreshToken();

      expect(
        container.read(authProvider).status,
        equals(AuthStatus.authenticated),
      );
    },
  );

  test(
    'an interceptor-triggered refresh shares the in-flight refresh with the '
    'notifier (#2019: one token request, never a rotation race)',
    () async {
      await seedAuthenticatedSession();
      final interceptor = interceptorOfContainer();

      var tokenRequests = 0;
      appAuth.onToken = (_) {
        tokenRequests++;
        return _freshTokens();
      };

      final viaInterceptor = interceptor.onRefreshToken();
      final viaNotifier = container.read(authProvider.notifier).refreshToken();
      await Future.wait([viaInterceptor, viaNotifier]);

      // Keycloak rotates refresh tokens: two concurrent refreshes with the
      // same token would hand one caller an invalid_grant and kill the
      // session. The single-flight must span BOTH entry paths.
      expect(tokenRequests, equals(1));
      expect(await storage.getAccessToken(), equals('fresh-at'));
    },
  );
}
