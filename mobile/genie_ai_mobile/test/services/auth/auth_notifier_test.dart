import 'package:flutter_appauth/flutter_appauth.dart';
import 'package:flutter_appauth_platform_interface/flutter_appauth_platform_interface.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:genie_ai_mobile/config/keycloak_config.dart';
import 'package:genie_ai_mobile/services/api_service.dart';
import 'package:genie_ai_mobile/services/auth/app_auth.dart';
import 'package:genie_ai_mobile/services/auth/auth_logger.dart';
import 'package:genie_ai_mobile/services/auth/auth_providers.dart';
import 'package:genie_ai_mobile/services/auth/auth_state.dart';
import 'package:genie_ai_mobile/services/auth/token_storage.dart';
import 'package:genie_ai_mobile/services/keycloak/keycloak_service.dart';

class MockAppAuth implements AppAuth {
  AuthorizationTokenResponse Function(AuthorizationTokenRequest)? onAuthorize;
  TokenResponse Function(TokenRequest)? onToken;
  Exception? authorizeException;
  Exception? tokenException;

  @override
  Future<AuthorizationTokenResponse> authorizeAndExchangeCode(
    AuthorizationTokenRequest request,
  ) async {
    if (authorizeException != null) throw authorizeException!;
    return onAuthorize!(request);
  }

  @override
  Future<TokenResponse> token(TokenRequest request) async {
    if (tokenException != null) throw tokenException!;
    return onToken!(request);
  }
}

class FakeKeycloakService extends KeycloakService {
  final OidcEndpoints? endpointsToReturn;
  bool endSessionResult = true;
  bool endSessionCalled = false;
  Exception? endSessionException;

  FakeKeycloakService({required super.keycloakConfig, this.endpointsToReturn});

  @override
  Future<OidcEndpoints?> discoverEndpoints() async => endpointsToReturn;

  @override
  Future<bool> endSession({String? idTokenHint}) async {
    endSessionCalled = true;
    if (endSessionException != null) throw endSessionException!;
    return endSessionResult;
  }
}

class RecordingAuthLogger extends AuthLogger {
  final List<String> events = [];
  final List<String> failures = [];

  RecordingAuthLogger() : super();

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

class FakeApiService extends ApiService {
  bool postLogoutCalled = false;
  bool postLogoutThrows = false;

  FakeApiService() : super(httpClient: _FakeHttpClient());

  @override
  Future<http.Response> post(String endpoint, Map<String, dynamic> data) async {
    if (endpoint == 'auth/logout') {
      postLogoutCalled = true;
      if (postLogoutThrows) throw Exception('Backend logout failed');
    }
    return http.Response('{"ok": true}', 200);
  }
}

class _FakeHttpClient extends http.BaseClient {
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    return http.StreamedResponse(
      const Stream.empty(),
      200,
    );
  }
}

const testConfig = KeycloakConfig(
  keycloakUrl: 'http://localhost:8080',
  realm: 'genie',
  clientId: 'test-client',
  redirectScheme: 'com.test.app',
  backendUrl: 'http://localhost:3000',
);

const testEndpoints = OidcEndpoints(
  authorizationEndpoint: 'http://localhost:8080/realms/genie/protocol/openid-connect/auth',
  tokenEndpoint: 'http://localhost:8080/realms/genie/protocol/openid-connect/token',
  userinfoEndpoint: 'http://localhost:8080/realms/genie/protocol/openid-connect/userinfo',
  endSessionEndpoint: 'http://localhost:8080/realms/genie/protocol/openid-connect/logout',
);

void main() {
  late ProviderContainer container;
  late InMemoryTokenStorage tokenStorage;
  late MockAppAuth mockAppAuth;
  late FakeKeycloakService keycloakService;
  late RecordingAuthLogger recordingLogger;
  late FakeApiService fakeApiService;

  ProviderContainer makeContainer({
    InMemoryTokenStorage? storage,
    MockAppAuth? appAuth,
    FakeKeycloakService? kcService,
    RecordingAuthLogger? logger,
    FakeApiService? apiService,
  }) {
    return ProviderContainer(
      overrides: [
        tokenStorageProvider.overrideWithValue(storage ?? tokenStorage),
        keycloakServiceProvider.overrideWithValue(kcService ?? keycloakService),
        appAuthProvider.overrideWithValue(appAuth ?? mockAppAuth),
        authLoggerProvider.overrideWithValue(logger ?? recordingLogger),
        apiServiceProvider.overrideWithValue(apiService ?? fakeApiService),
      ],
    );
  }

  setUp(() {
    tokenStorage = InMemoryTokenStorage();
    mockAppAuth = MockAppAuth();
    recordingLogger = RecordingAuthLogger();
    fakeApiService = FakeApiService();
    keycloakService = FakeKeycloakService(
      keycloakConfig: testConfig,
      endpointsToReturn: testEndpoints,
    );
    container = makeContainer();
  });

  tearDown(() => container.dispose());

  group('authorize', () {
    test('succeeds — state becomes authenticated', () async {
      mockAppAuth.onAuthorize = (_) => AuthorizationTokenResponse(
        'at',
        'rt',
        DateTime.now().add(Duration(hours: 1)),
        'idt',
        'Bearer',
        null,
        null,
        null,
      );

      await container.read(authProvider.notifier).authorize();
      final state = container.read(authProvider);

      expect(state.status, equals(AuthStatus.authenticated));
      expect(await tokenStorage.getAccessToken(), equals('at'));
      expect(await tokenStorage.getRefreshToken(), equals('rt'));
    });

    test('user cancels — state becomes unauthenticated', () async {
      mockAppAuth.authorizeException = FlutterAppAuthUserCancelledException(
        code: 'user_cancelled',
        message: 'cancelled',
        platformErrorDetails: FlutterAppAuthPlatformErrorDetails(),
      );

      await container.read(authProvider.notifier).authorize();
      final state = container.read(authProvider);

      expect(state.status, equals(AuthStatus.unauthenticated));
    });

    test('network error — state becomes error with retryable true', () async {
      mockAppAuth.authorizeException = FlutterAppAuthPlatformException(
        code: 'no_browser_available',
        message: 'Network unreachable',
        platformErrorDetails: FlutterAppAuthPlatformErrorDetails(),
      );

      await container.read(authProvider.notifier).authorize();
      final state = container.read(authProvider);

      expect(state.status, equals(AuthStatus.error));
      expect(state.retryable, isTrue);
      expect(state.errorMessage, equals('Network unreachable'));
    });

    test('discovery failure — state becomes error with retryable true', () async {
      final noEndpointsService = FakeKeycloakService(
        keycloakConfig: testConfig,
        endpointsToReturn: null,
      );
      final c = makeContainer(kcService: noEndpointsService);

      await c.read(authProvider.notifier).authorize();
      final state = c.read(authProvider);

      expect(state.status, equals(AuthStatus.error));
      expect(state.retryable, isTrue);
      expect(state.errorMessage, equals('Network unreachable'));
      c.dispose();
    });
  });

  group('refreshToken', () {
    test('succeeds — state becomes authenticated, new tokens saved', () async {
      await tokenStorage.saveTokens(
        accessToken: 'old-at',
        idToken: 'old-idt',
        refreshToken: 'old-rt',
        accessTokenExpiration: DateTime.now().subtract(Duration(hours: 1)),
      );

      mockAppAuth.onToken = (_) => TokenResponse(
        'new-at',
        'new-rt',
        DateTime.now().add(Duration(hours: 1)),
        null,
        'Bearer',
        null,
        null,
      );

      await container.read(authProvider.notifier).refreshToken();
      final state = container.read(authProvider);

      expect(state.status, equals(AuthStatus.authenticated));
      expect(await tokenStorage.getAccessToken(), equals('new-at'));
      expect(await tokenStorage.getRefreshToken(), equals('new-rt'));
    });

    test('no refresh token — state becomes unauthenticated', () async {
      await container.read(authProvider.notifier).refreshToken();
      final state = container.read(authProvider);

      expect(state.status, equals(AuthStatus.unauthenticated));
    });

    test('fails — tokens deleted, state becomes unauthenticated', () async {
      await tokenStorage.saveTokens(
        accessToken: 'old-at',
        idToken: 'old-idt',
        refreshToken: 'old-rt',
        accessTokenExpiration: DateTime.now().subtract(Duration(hours: 1)),
      );

      mockAppAuth.tokenException = Exception('Refresh failed');

      await container.read(authProvider.notifier).refreshToken();
      final state = container.read(authProvider);

      expect(state.status, equals(AuthStatus.unauthenticated));
      expect(await tokenStorage.getAccessToken(), isNull);
    });
  });

  group('_initializeAuth (via build)', () {
    test('no tokens — state stays unauthenticated (AC #11)', () async {
      // build() fires _initializeAuth via microtask; with no tokens stored,
      // _initializeAuth returns early — state stays unauthenticated
      final state = container.read(authProvider);
      expect(state.status, equals(AuthStatus.unauthenticated));
    });

    test('valid tokens — _initializeAuth sets authenticated (AC #9)', () async {
      // Pre-populate storage BEFORE creating the container
      final preloadedStorage = InMemoryTokenStorage();
      await preloadedStorage.saveTokens(
        accessToken: 'valid-at',
        idToken: 'idt',
        refreshToken: 'rt',
        accessTokenExpiration: DateTime.now().add(Duration(hours: 1)),
      );

      final c = makeContainer(storage: preloadedStorage);
      // Trigger provider initialization
      c.read(authProvider.notifier);
      // Let Future.microtask(() => _initializeAuth()) complete
      await Future.delayed(Duration.zero);

      final state = c.read(authProvider);
      expect(state.status, equals(AuthStatus.authenticated));
      c.dispose();
    });

    test('expired tokens — _initializeAuth triggers refresh (AC #10)', () async {
      final preloadedStorage = InMemoryTokenStorage();
      await preloadedStorage.saveTokens(
        accessToken: 'expired-at',
        idToken: 'idt',
        refreshToken: 'rt',
        accessTokenExpiration: DateTime.now().subtract(Duration(hours: 1)),
      );

      final refreshAuth = MockAppAuth();
      refreshAuth.onToken = (_) => TokenResponse(
        'refreshed-at',
        'refreshed-rt',
        DateTime.now().add(Duration(hours: 1)),
        null,
        'Bearer',
        null,
        null,
      );

      final c = makeContainer(storage: preloadedStorage, appAuth: refreshAuth);
      c.read(authProvider.notifier);
      await Future.delayed(Duration.zero);

      final state = c.read(authProvider);
      expect(state.status, equals(AuthStatus.authenticated));
      expect(await preloadedStorage.getAccessToken(), equals('refreshed-at'));
      c.dispose();
    });

    test('expired tokens with refresh failure — state unauthenticated', () async {
      final preloadedStorage = InMemoryTokenStorage();
      await preloadedStorage.saveTokens(
        accessToken: 'expired-at',
        idToken: 'idt',
        refreshToken: 'rt',
        accessTokenExpiration: DateTime.now().subtract(Duration(hours: 1)),
      );

      final failAuth = MockAppAuth();
      failAuth.tokenException = Exception('Refresh failed');

      final c = makeContainer(storage: preloadedStorage, appAuth: failAuth);
      c.read(authProvider.notifier);
      await Future.delayed(Duration.zero);

      final state = c.read(authProvider);
      expect(state.status, equals(AuthStatus.unauthenticated));
      c.dispose();
    });
  });

  group('refreshToken — error message on failure (AC3)', () {
    test('sets errorMessage on refresh failure', () async {
      await tokenStorage.saveTokens(
        accessToken: 'old-at',
        idToken: 'old-idt',
        refreshToken: 'old-rt',
        accessTokenExpiration: DateTime.now().subtract(Duration(hours: 1)),
      );

      mockAppAuth.tokenException = Exception('Refresh failed');

      await container.read(authProvider.notifier).refreshToken();
      final state = container.read(authProvider);

      expect(state.status, equals(AuthStatus.unauthenticated));
      expect(
        state.errorMessage,
        equals('Your session has expired. Please sign in again.'),
      );
    });
  });

  group('refreshToken — rotation (AC2)', () {
    test('persists new refresh token from token endpoint', () async {
      await tokenStorage.saveTokens(
        accessToken: 'old-at',
        idToken: 'old-idt',
        refreshToken: 'old-rt',
        accessTokenExpiration: DateTime.now().subtract(Duration(hours: 1)),
      );

      mockAppAuth.onToken = (_) => TokenResponse(
        'new-at',
        'new-rt',
        DateTime.now().add(Duration(hours: 1)),
        null,
        'Bearer',
        null,
        null,
      );

      await container.read(authProvider.notifier).refreshToken();

      expect(await tokenStorage.getRefreshToken(), equals('new-rt'));
      expect(await tokenStorage.getAccessToken(), equals('new-at'));
    });
  });

  group('logout', () {
    test('success — endSession called, deleteAll called, state unauthenticated', () async {
      await tokenStorage.saveTokens(
        accessToken: 'at',
        idToken: 'idt',
        refreshToken: 'rt',
        accessTokenExpiration: DateTime.now().add(Duration(hours: 1)),
      );

      await container.read(authProvider.notifier).logout();
      final state = container.read(authProvider);

      expect(keycloakService.endSessionCalled, isTrue);
      expect(await tokenStorage.getAccessToken(), isNull);
      expect(state.status, equals(AuthStatus.unauthenticated));
    });

    test('logs initiated and completed events (AC8)', () async {
      await tokenStorage.saveTokens(
        accessToken: 'at',
        idToken: 'idt',
        refreshToken: 'rt',
        accessTokenExpiration: DateTime.now().add(Duration(hours: 1)),
      );

      await container.read(authProvider.notifier).logout();

      expect(
        recordingLogger.events,
        containsAll([
          'AuthNotifier.logout: Logout initiated',
          'AuthNotifier.logout: Logout completed',
        ]),
      );
    });

    test('Keycloak failure — deleteAll still called, state unauthenticated', () async {
      await tokenStorage.saveTokens(
        accessToken: 'at',
        idToken: 'idt',
        refreshToken: 'rt',
        accessTokenExpiration: DateTime.now().add(Duration(hours: 1)),
      );

      keycloakService.endSessionResult = false;

      await container.read(authProvider.notifier).logout();
      final state = container.read(authProvider);

      expect(keycloakService.endSessionCalled, isTrue);
      expect(await tokenStorage.getAccessToken(), isNull);
      expect(state.status, equals(AuthStatus.unauthenticated));
    });

    test('Keycloak throws — catchError absorbs it, deleteAll still called', () async {
      await tokenStorage.saveTokens(
        accessToken: 'at',
        idToken: 'idt',
        refreshToken: 'rt',
        accessTokenExpiration: DateTime.now().add(Duration(hours: 1)),
      );

      keycloakService.endSessionException = Exception('Network error');

      await container.read(authProvider.notifier).logout();
      final state = container.read(authProvider);

      expect(keycloakService.endSessionCalled, isTrue);
      expect(await tokenStorage.getAccessToken(), isNull);
      expect(state.status, equals(AuthStatus.unauthenticated));
    });

    test('post-logout re-auth — authorize() works after logout()', () async {
      await tokenStorage.saveTokens(
        accessToken: 'at',
        idToken: 'idt',
        refreshToken: 'rt',
        accessTokenExpiration: DateTime.now().add(Duration(hours: 1)),
      );

      await container.read(authProvider.notifier).logout();
      expect(container.read(authProvider).status, equals(AuthStatus.unauthenticated));

      mockAppAuth.onAuthorize = (_) => AuthorizationTokenResponse(
        'new-at',
        'new-rt',
        DateTime.now().add(Duration(hours: 1)),
        'new-idt',
        'Bearer',
        null,
        null,
        null,
      );

      await container.read(authProvider.notifier).authorize();
      final state = container.read(authProvider);

      expect(state.status, equals(AuthStatus.authenticated));
      expect(await tokenStorage.getAccessToken(), equals('new-at'));
    });

    test('Future.wait — backend logout called alongside endSession (AC11)', () async {
      await tokenStorage.saveTokens(
        accessToken: 'at',
        idToken: 'idt',
        refreshToken: 'rt',
        accessTokenExpiration: DateTime.now().add(Duration(hours: 1)),
      );

      await container.read(authProvider.notifier).logout();

      expect(fakeApiService.postLogoutCalled, isTrue);
      expect(keycloakService.endSessionCalled, isTrue);
      expect(await tokenStorage.getAccessToken(), isNull);
    });

    test('Future.wait — backend fails, endSession still called (AC11)', () async {
      await tokenStorage.saveTokens(
        accessToken: 'at',
        idToken: 'idt',
        refreshToken: 'rt',
        accessTokenExpiration: DateTime.now().add(Duration(hours: 1)),
      );

      fakeApiService.postLogoutThrows = true;

      await container.read(authProvider.notifier).logout();

      expect(keycloakService.endSessionCalled, isTrue);
      expect(await tokenStorage.getAccessToken(), isNull);
      expect(container.read(authProvider).status, equals(AuthStatus.unauthenticated));
    });

    test('Future.wait — Keycloak fails, backend still called (AC11)', () async {
      await tokenStorage.saveTokens(
        accessToken: 'at',
        idToken: 'idt',
        refreshToken: 'rt',
        accessTokenExpiration: DateTime.now().add(Duration(hours: 1)),
      );

      keycloakService.endSessionResult = false;

      await container.read(authProvider.notifier).logout();

      expect(fakeApiService.postLogoutCalled, isTrue);
      expect(await tokenStorage.getAccessToken(), isNull);
      expect(container.read(authProvider).status, equals(AuthStatus.unauthenticated));
    });
  });
}
