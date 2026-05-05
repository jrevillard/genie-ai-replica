import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';

/// Keycloak HTTP helper for E2E tests.
/// Mirrors tests/e2e/helpers/auth.js from the web E2E suite.
class AuthHelper {
  final String keycloakUrl;
  final String realm;
  final http.Client _client;

  AuthHelper({
    required this.keycloakUrl,
    required this.realm,
    http.Client? client,
  }) : _client = client ?? insecureClient();

  static http.Client insecureClient() {
    final securityContext = SecurityContext(withTrustedRoots: false);
    final httpClient = HttpClient(context: securityContext);
    httpClient.badCertificateCallback = (cert, host, port) => true;
    return IOClient(httpClient);
  }

  /// Request the Keycloak Admin API with a bearer token.
  Future<http.Response> request(
    String method,
    String path, {
    Map<String, String>? headers,
    String? body,
  }) async {
    final uri = Uri.parse('$keycloakUrl/admin/realms/$realm$path');
    final req = http.Request(method, uri);
    if (headers != null) req.headers.addAll(headers);
    if (body != null) req.body = body;
    req.headers['Content-Type'] = 'application/json';
    final streamed = await _client.send(req);
    return http.Response.fromStream(streamed);
  }

  /// Obtain a master admin token for Keycloak Admin API calls.
  Future<String> getAdminToken(String adminPassword) async {
    final uri = Uri.parse('$keycloakUrl/realms/master/protocol/openid-connect/token');
    final response = await _client.post(
      uri,
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: 'client_id=admin-cli'
          '&username=admin'
          '&password=${Uri.encodeComponent(adminPassword)}'
          '&grant_type=password',
    );
    if (response.statusCode != 200) {
      throw Exception(
        'Failed to get admin token: ${response.statusCode} ${response.body}',
      );
    }
    final json = jsonDecode(response.body) as Map<String, dynamic>;
    return json['access_token'] as String;
  }

  /// Decode JWT claims without verification (E2E context — tokens from trusted Keycloak).
  Map<String, dynamic> parseJwtClaims(String token) {
    final parts = token.split('.');
    if (parts.length != 3) {
      throw const FormatException('Invalid JWT format');
    }
    // Base64url decode the payload
    var payload = parts[1];
    while (payload.length % 4 != 0) {
      payload += '=';
    }
    final decoded = utf8.decode(base64Url.decode(payload));
    return jsonDecode(decoded) as Map<String, dynamic>;
  }

  /// Obtain tokens via ROPC (grant_type=password) for E2E test auth injection.
  /// The client must have directAccessGrantsEnabled=true (test-only client).
  /// The user must have firstName, lastName, and emailVerified=true (Keycloak User Profile requirement).
  Future<Map<String, String>> getRopcToken({
    required String clientId,
    required String username,
    required String password,
  }) async {
    final uri = Uri.parse('$keycloakUrl/realms/$realm/protocol/openid-connect/token');
    final response = await _client.post(
      uri,
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: 'grant_type=password'
          '&client_id=${Uri.encodeComponent(clientId)}'
          '&username=${Uri.encodeComponent(username)}'
          '&password=${Uri.encodeComponent(password)}',
    );
    if (response.statusCode != 200) {
      throw Exception(
        'ROPC token request failed: ${response.statusCode} ${response.body}',
      );
    }
    final json = jsonDecode(response.body) as Map<String, dynamic>;
    final expiresIn = json['expires_in'] as int? ?? 300;
    final expiration = DateTime.now()
        .add(Duration(seconds: expiresIn))
        .toUtc()
        .toIso8601String();
    return {
      'access_token': json['access_token'] as String,
      'id_token': json['id_token'] as String? ?? '',
      'refresh_token': json['refresh_token'] as String? ?? '',
      'expires_at': expiration,
    };
  }

  void close() => _client.close();
}
