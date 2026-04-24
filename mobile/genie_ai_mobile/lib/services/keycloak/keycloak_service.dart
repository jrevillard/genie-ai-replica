import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import '../../config/keycloak_config.dart';

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
  OidcEndpoints? _cachedEndpoints;

  KeycloakService({
    required this.keycloakConfig,
    http.Client? httpClient,
  }) : _httpClient = httpClient ?? http.Client();

  Future<OidcEndpoints?> discoverEndpoints() async {
    if (_cachedEndpoints != null) return _cachedEndpoints;
    try {
      final uri = Uri.parse(
        '${keycloakConfig.realmUrl}/.well-known/openid-configuration',
      );
      final response = await _httpClient.get(uri);
      if (response.statusCode != 200) return null;
      final json = jsonDecode(response.body) as Map<String, dynamic>;
      _cachedEndpoints = OidcEndpoints(
        authorizationEndpoint: json['authorization_endpoint'] as String,
        tokenEndpoint: json['token_endpoint'] as String,
        userinfoEndpoint: json['userinfo_endpoint'] as String,
        endSessionEndpoint: json['end_session_endpoint'] as String,
      );
      return _cachedEndpoints;
    } on SocketException {
      return null;
    } on http.ClientException {
      return null;
    } on FormatException {
      return null;
    } on TypeError {
      return null;
    }
  }
}
