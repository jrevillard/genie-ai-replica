import 'package:flutter_appauth/flutter_appauth.dart';
import 'package:flutter_appauth_platform_interface/flutter_appauth_platform_interface.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/config/keycloak_config.dart';
import 'package:genie_ai_mobile/services/auth/app_auth.dart';
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

  FakeKeycloakService({required super.keycloakConfig, this.endpointsToReturn});

  @override
  Future<OidcEndpoints?> discoverEndpoints() async => endpointsToReturn;
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

  ProviderContainer makeContainer({
    InMemoryTokenStorage? storage,
    MockAppAuth? appAuth,
    FakeKeycloakService? kcService,
  }) {
    return ProviderContainer(
      overrides: [
        tokenStorageProvider.overrideWithValue(storage ?? tokenStorage),
        keycloakServiceProvider.overrideWithValue(kcService ?? keycloakService),
        appAuthProvider.overrideWithValue(appAuth ?? mockAppAuth),
      ],
    );
  }

  setUp(() {
    tokenStorage = InMemoryTokenStorage();
    mockAppAuth = MockAppAuth();
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
}
