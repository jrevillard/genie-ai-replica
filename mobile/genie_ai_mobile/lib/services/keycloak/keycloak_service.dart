import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import '../../config/keycloak_config.dart';
import '../auth/auth_logger.dart';

class OidcEndpoints {
  final String authorizationEndpoint;
  final String tokenEndpoint;
  final String userinfoEndpoint;
  final String endSessionEndpoint;

  const OidcEndpoints({
    required this.authorizationEndpoint,
    required this.tokenEndpoint,
    required this.userinfoEndpoint,
    required this.endSessionEndpoint,
  });

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is OidcEndpoints &&
          runtimeType == other.runtimeType &&
          authorizationEndpoint == other.authorizationEndpoint &&
          tokenEndpoint == other.tokenEndpoint &&
          userinfoEndpoint == other.userinfoEndpoint &&
          endSessionEndpoint == other.endSessionEndpoint;

  @override
  int get hashCode => Object.hash(
        authorizationEndpoint,
        tokenEndpoint,
        userinfoEndpoint,
        endSessionEndpoint,
      );

  @override
  String toString() => 'OidcEndpoints('
      'authorization: $authorizationEndpoint, '
      'token: $tokenEndpoint, '
      'userinfo: $userinfoEndpoint, '
      'endSession: $endSessionEndpoint)';
}

class KeycloakService {
  final KeycloakConfig keycloakConfig;
  final http.Client _httpClient;
  final AuthLogger? _logger;
  OidcEndpoints? _cachedEndpoints;

  KeycloakService({
    required this.keycloakConfig,
    http.Client? httpClient,
    AuthLogger? logger,
  })  : _httpClient = httpClient ?? http.Client(),
        _logger = logger;

  Future<OidcEndpoints?> discoverEndpoints() async {
    if (_cachedEndpoints != null) return _cachedEndpoints;
    _logger?.logAuthEvent(
      message: 'Endpoint discovery started',
      source: 'KeycloakService.discoverEndpoints',
    );
    try {
      final uri = Uri.parse(
        '${keycloakConfig.realmUrl}/.well-known/openid-configuration',
      );
      final response = await _httpClient.get(uri);
      if (response.statusCode != 200) {
        _logger?.logAuthFailure(
          errorCode: 'DISCOVERY_HTTP_ERROR',
          keycloakEndpoint: keycloakConfig.realmUrl,
          httpStatus: response.statusCode,
          message: 'Discovery returned HTTP ${response.statusCode}',
          source: 'KeycloakService.discoverEndpoints',
        );
        return null;
      }
      final json = jsonDecode(response.body) as Map<String, dynamic>;
      _cachedEndpoints = OidcEndpoints(
        authorizationEndpoint: json['authorization_endpoint'] as String,
        tokenEndpoint: json['token_endpoint'] as String,
        userinfoEndpoint: json['userinfo_endpoint'] as String,
        endSessionEndpoint: json['end_session_endpoint'] as String,
      );
      _logger?.logAuthEvent(
        message: 'Endpoint discovery successful',
        source: 'KeycloakService.discoverEndpoints',
      );
      return _cachedEndpoints;
    } on SocketException {
      _logger?.logAuthFailure(
        errorCode: 'DISCOVERY_NETWORK_ERROR',
        keycloakEndpoint: keycloakConfig.realmUrl,
        networkReachable: false,
        message: 'Network unreachable during discovery',
        source: 'KeycloakService.discoverEndpoints',
      );
      return null;
    } on http.ClientException {
      _logger?.logAuthFailure(
        errorCode: 'DISCOVERY_CLIENT_ERROR',
        keycloakEndpoint: keycloakConfig.realmUrl,
        message: 'HTTP client error during discovery',
        source: 'KeycloakService.discoverEndpoints',
      );
      return null;
    } on FormatException {
      _logger?.logAuthFailure(
        errorCode: 'DISCOVERY_PARSE_ERROR',
        keycloakEndpoint: keycloakConfig.realmUrl,
        message: 'Invalid JSON in discovery response',
        source: 'KeycloakService.discoverEndpoints',
      );
      return null;
    } on TypeError {
      _logger?.logAuthFailure(
        errorCode: 'DISCOVERY_PARSE_ERROR',
        keycloakEndpoint: keycloakConfig.realmUrl,
        message: 'Unexpected response structure in discovery',
        source: 'KeycloakService.discoverEndpoints',
      );
      return null;
    }
  }

  Future<bool> endSession({String? idTokenHint}) async {
    final endpoints = await discoverEndpoints();
    if (endpoints == null) return false;

    _logger?.logAuthEvent(
      message: 'Keycloak end_session initiated',
      source: 'KeycloakService.endSession',
    );

    try {
      final queryParams = <String, String>{
        if (idTokenHint != null && idTokenHint.isNotEmpty)
          'id_token_hint': idTokenHint,
        'client_id': keycloakConfig.clientId,
      };
      final uri = Uri.parse(endpoints.endSessionEndpoint).replace(
        queryParameters: queryParams,
      );

      final response = await _httpClient.get(uri);

      if (response.statusCode == 200 || response.statusCode == 302) {
        _logger?.logAuthEvent(
          message: 'Keycloak end_session successful',
          source: 'KeycloakService.endSession',
        );
        return true;
      }

      _logger?.logAuthFailure(
        errorCode: 'KEYCLOAK_LOGOUT_FAILED',
        keycloakEndpoint: endpoints.endSessionEndpoint,
        httpStatus: response.statusCode,
        message: 'end_session returned HTTP ${response.statusCode}',
        source: 'KeycloakService.endSession',
      );
      return false;
    } on SocketException {
      _logger?.logAuthFailure(
        errorCode: 'KEYCLOAK_NETWORK_ERROR',
        keycloakEndpoint: keycloakConfig.realmUrl,
        networkReachable: false,
        message: 'Network unreachable during end_session',
        source: 'KeycloakService.endSession',
      );
      return false;
    } on http.ClientException {
      _logger?.logAuthFailure(
        errorCode: 'KEYCLOAK_CLIENT_ERROR',
        keycloakEndpoint: keycloakConfig.realmUrl,
        message: 'HTTP client error during end_session',
        source: 'KeycloakService.endSession',
      );
      return false;
    } catch (e) {
      _logger?.logAuthFailure(
        errorCode: 'KEYCLOAK_LOGOUT_ERROR',
        keycloakEndpoint: keycloakConfig.realmUrl,
        message: 'Error during end_session: $e',
        source: 'KeycloakService.endSession',
      );
      return false;
    }
  }
}
