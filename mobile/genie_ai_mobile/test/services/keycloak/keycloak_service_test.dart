import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:genie_ai_mobile/config/keycloak_config.dart';
import 'package:genie_ai_mobile/services/keycloak/keycloak_service.dart';

class MockHttpClient extends http.BaseClient {
  final MockHttpClientConfig _config;

  MockHttpClient(this._config);

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    if (_config.throwException != null) {
      throw _config.throwException!;
    }
    return http.StreamedResponse(
      Stream.value(utf8.encode(_config.responseBody)),
      _config.statusCode,
    );
  }
}

class MockHttpClientConfig {
  final int statusCode;
  final String responseBody;
  final Exception? throwException;

  MockHttpClientConfig({
    this.statusCode = 200,
    this.responseBody = '',
    this.throwException,
  });
}

void main() {
  const testConfig = KeycloakConfig(
    keycloakUrl: 'http://localhost:8080',
    realm: 'genie',
    clientId: 'test-client',
    redirectScheme: 'com.test.app',
    backendUrl: 'http://localhost:3000',
  );

  final wellKnownResponse = {
    'authorization_endpoint': 'http://localhost:8080/realms/genie/protocol/openid-connect/auth',
    'token_endpoint': 'http://localhost:8080/realms/genie/protocol/openid-connect/token',
    'userinfo_endpoint': 'http://localhost:8080/realms/genie/protocol/openid-connect/userinfo',
    'end_session_endpoint': 'http://localhost:8080/realms/genie/protocol/openid-connect/logout',
  };

  group('KeycloakService', () {
    group('discoverEndpoints', () {
      test('parses .well-known/openid-configuration response correctly', () async {
        final httpClient = MockHttpClient(MockHttpClientConfig(
          responseBody: jsonEncode(wellKnownResponse),
        ));
        final service = KeycloakService(
          keycloakConfig: testConfig,
          httpClient: httpClient,
        );

        final endpoints = await service.discoverEndpoints();

        expect(endpoints, isNotNull);
        expect(
          endpoints!.authorizationEndpoint,
          equals('http://localhost:8080/realms/genie/protocol/openid-connect/auth'),
        );
        expect(
          endpoints.tokenEndpoint,
          equals('http://localhost:8080/realms/genie/protocol/openid-connect/token'),
        );
        expect(
          endpoints.userinfoEndpoint,
          equals('http://localhost:8080/realms/genie/protocol/openid-connect/userinfo'),
        );
        expect(
          endpoints.endSessionEndpoint,
          equals('http://localhost:8080/realms/genie/protocol/openid-connect/logout'),
        );
      });

      test('caches discovered endpoints — second call does not make HTTP request', () async {
        var callCount = 0;
        final httpClient = MockHttpClient(MockHttpClientConfig(
          responseBody: jsonEncode(wellKnownResponse),
        ));
        final countingClient = _CountingHttpClient(httpClient, () => callCount++);
        final service = KeycloakService(
          keycloakConfig: testConfig,
          httpClient: countingClient,
        );

        await service.discoverEndpoints();
        await service.discoverEndpoints();

        expect(callCount, equals(1));
      });

      test('returns null on HTTP error (non-200 status)', () async {
        final httpClient = MockHttpClient(MockHttpClientConfig(
          statusCode: 500,
          responseBody: 'Internal Server Error',
        ));
        final service = KeycloakService(
          keycloakConfig: testConfig,
          httpClient: httpClient,
        );

        final endpoints = await service.discoverEndpoints();

        expect(endpoints, isNull);
      });

      test('returns null on SocketException (network error)', () async {
        final httpClient = MockHttpClient(MockHttpClientConfig(
          throwException: SocketException('Network unreachable'),
        ));
        final service = KeycloakService(
          keycloakConfig: testConfig,
          httpClient: httpClient,
        );

        final endpoints = await service.discoverEndpoints();

        expect(endpoints, isNull);
      });

      test('returns null on ClientException', () async {
        final httpClient = MockHttpClient(MockHttpClientConfig(
          throwException: http.ClientException('Connection refused'),
        ));
        final service = KeycloakService(
          keycloakConfig: testConfig,
          httpClient: httpClient,
        );

        final endpoints = await service.discoverEndpoints();

        expect(endpoints, isNull);
      });

      test('returns null on FormatException (invalid JSON)', () async {
        final httpClient = MockHttpClient(MockHttpClientConfig(
          responseBody: 'not-json',
        ));
        final service = KeycloakService(
          keycloakConfig: testConfig,
          httpClient: httpClient,
        );

        final endpoints = await service.discoverEndpoints();

        expect(endpoints, isNull);
      });
    });

    group('OidcEndpoints', () {
      test('has value equality', () {
        const a = OidcEndpoints(
          authorizationEndpoint: 'http://a',
          tokenEndpoint: 'http://b',
          userinfoEndpoint: 'http://c',
          endSessionEndpoint: 'http://d',
        );
        const b = OidcEndpoints(
          authorizationEndpoint: 'http://a',
          tokenEndpoint: 'http://b',
          userinfoEndpoint: 'http://c',
          endSessionEndpoint: 'http://d',
        );
        expect(a, equals(b));
      });

      test('has toString for debuggability', () {
        const endpoints = OidcEndpoints(
          authorizationEndpoint: 'http://auth',
          tokenEndpoint: 'http://token',
          userinfoEndpoint: 'http://userinfo',
          endSessionEndpoint: 'http://logout',
        );
        expect(endpoints.toString(), contains('http://auth'));
        expect(endpoints.toString(), contains('http://token'));
      });
    });

    group('endSession', () {
      test('returns true on HTTP 200', () async {
        final httpClient = MockHttpClient(MockHttpClientConfig(
          responseBody: jsonEncode(wellKnownResponse),
        ));
        final service = KeycloakService(
          keycloakConfig: testConfig,
          httpClient: httpClient,
        );

        final result = await service.endSession(idTokenHint: 'test-id-token');

        expect(result, isTrue);
      });

      test('returns true on HTTP 302 (redirect)', () async {
        // First call (discovery) returns 200, second call (endSession) returns 302
        final discoveryClient = MockHttpClient(MockHttpClientConfig(
          responseBody: jsonEncode(wellKnownResponse),
        ));
        final redirectClient = MockHttpClient(MockHttpClientConfig(
          statusCode: 302,
          responseBody: '',
        ));
        final service = KeycloakService(
          keycloakConfig: testConfig,
          httpClient: _SequentialHttpClient([discoveryClient, redirectClient]),
        );

        final result = await service.endSession(idTokenHint: 'test-id-token');

        expect(result, isTrue);
      });

      test('returns false on HTTP 400 error', () async {
        final httpClient = MockHttpClient(MockHttpClientConfig(
          statusCode: 400,
          responseBody: 'Bad Request',
        ));
        final service = KeycloakService(
          keycloakConfig: testConfig,
          httpClient: httpClient,
        );

        final result = await service.endSession(idTokenHint: 'test-id-token');

        expect(result, isFalse);
      });

      test('returns false on HTTP 500 error', () async {
        final httpClient = MockHttpClient(MockHttpClientConfig(
          statusCode: 500,
          responseBody: 'Internal Server Error',
        ));
        final service = KeycloakService(
          keycloakConfig: testConfig,
          httpClient: httpClient,
        );

        final result = await service.endSession(idTokenHint: 'test-id-token');

        expect(result, isFalse);
      });

      test('returns false on SocketException (network unreachable)', () async {
        final httpClient = MockHttpClient(MockHttpClientConfig(
          throwException: SocketException('Network unreachable'),
        ));
        final service = KeycloakService(
          keycloakConfig: testConfig,
          httpClient: httpClient,
        );

        final result = await service.endSession(idTokenHint: 'test-id-token');

        expect(result, isFalse);
      });

      test('returns false on ClientException (connection reset)', () async {
        final httpClient = MockHttpClient(MockHttpClientConfig(
          throwException: http.ClientException('Connection reset'),
        ));
        final service = KeycloakService(
          keycloakConfig: testConfig,
          httpClient: httpClient,
        );

        final result = await service.endSession(idTokenHint: 'test-id-token');

        expect(result, isFalse);
      });

      test('returns false when discovery fails (endpoints null)', () async {
        final httpClient = MockHttpClient(MockHttpClientConfig(
          statusCode: 500,
          responseBody: 'Discovery failed',
        ));
        final service = KeycloakService(
          keycloakConfig: testConfig,
          httpClient: httpClient,
        );

        // First call to endSession will try discovery which fails
        final result = await service.endSession(idTokenHint: 'test-id-token');

        expect(result, isFalse);
      });

      test('calls endpoint even with empty idTokenHint', () async {
        var callCount = 0;
        final httpClient = MockHttpClient(MockHttpClientConfig(
          responseBody: jsonEncode(wellKnownResponse),
        ));
        final countingClient = _CountingHttpClient(httpClient, () => callCount++);
        final service = KeycloakService(
          keycloakConfig: testConfig,
          httpClient: countingClient,
        );

        // First call is discovery, second is endSession
        await service.discoverEndpoints();
        final beforeCount = callCount;

        await service.endSession(idTokenHint: '');

        // Discovery was cached (callCount 1), endSession made 1 more call
        expect(callCount, equals(beforeCount + 1));
      });
    });
  });
}

class _CountingHttpClient extends http.BaseClient {
  final http.Client _inner;
  final void Function() _onCall;

  _CountingHttpClient(this._inner, this._onCall);

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    _onCall();
    return _inner.send(request);
  }
}

class _SequentialHttpClient extends http.BaseClient {
  final List<http.Client> _clients;
  int _index = 0;

  _SequentialHttpClient(this._clients);

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    if (_index >= _clients.length) {
      throw StateError('No more mock clients in sequence');
    }
    return _clients[_index++].send(request);
  }
}
