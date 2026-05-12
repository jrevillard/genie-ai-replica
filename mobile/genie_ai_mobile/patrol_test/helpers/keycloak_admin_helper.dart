import 'dart:convert';

import 'package:http/http.dart' as http;

import 'auth_helper.dart';

/// Keycloak Admin API helper for E2E tests.
/// Mirrors tests/e2e/helpers/keycloak-admin.js from the web E2E suite.
class KeycloakAdminHelper {
  final AuthHelper _auth;
  final http.Client _client;

  KeycloakAdminHelper({
    required AuthHelper auth,
    http.Client? client,
  })  : _auth = auth,
        _client = client ?? AuthHelper.insecureClient();

  /// Create a Keycloak user. Returns the user ID.
  /// firstName, lastName, and emailVerified are required for ROPC login
  /// (Keycloak default User Profile requires them — see .claude/rules/SERVER-TESTING.md).
  Future<String> createUser({
    required String adminToken,
    required String realm,
    required String username,
    required String email,
    required String password,
    List<String>? realmRoles,
  }) async {
    final uri = Uri.parse('${_auth.keycloakUrl}/admin/realms/$realm/users');
    final response = await _client.post(
      uri,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $adminToken',
      },
      body: jsonEncode({
        'username': username,
        'email': email,
        'emailVerified': true,
        'firstName': username,
        'lastName': 'E2E',
        'enabled': true,
        'credentials': [
          {'type': 'password', 'value': password, 'temporary': false},
        ],
        if (realmRoles != null && realmRoles.isNotEmpty)
          'realmRoles': realmRoles,
      }),
    );

    if (response.statusCode != 201) {
      throw Exception(
        'Failed to create user: ${response.statusCode} ${response.body}',
      );
    }

    // Extract user ID from Location header
    final location = response.headers['location'];
    if (location == null) {
      throw Exception('No Location header in create user response');
    }
    final userId = location.split('/').last;
    return userId;
  }

  /// Delete a Keycloak user by ID.
  Future<void> deleteUser({
    required String adminToken,
    required String realm,
    required String userId,
  }) async {
    final uri = Uri.parse(
      '${_auth.keycloakUrl}/admin/realms/$realm/users/$userId',
    );
    final response = await _client.delete(
      uri,
      headers: {
        'Authorization': 'Bearer $adminToken',
      },
    );
    // 204 = success, 404 = already deleted — both acceptable
    if (response.statusCode != 204 && response.statusCode != 404) {
      throw Exception(
        'Failed to delete user: ${response.statusCode} ${response.body}',
      );
    }
  }

  /// Check if a user exists in Keycloak.
  Future<bool> userExists({
    required String adminToken,
    required String realm,
    required String userId,
  }) async {
    final uri = Uri.parse(
      '${_auth.keycloakUrl}/admin/realms/$realm/users/$userId',
    );
    final response = await _client.get(
      uri,
      headers: {
        'Authorization': 'Bearer $adminToken',
      },
    );
    return response.statusCode == 200;
  }

  /// Look up a user's internal UUID by username.
  /// Returns null if the user does not exist.
  Future<String?> getUserIdByUsername({
    required String adminToken,
    required String realm,
    required String username,
  }) async {
    final uri = Uri.parse(
      '${_auth.keycloakUrl}/admin/realms/$realm/users?username=$username&exact=true',
    );
    final response = await _client.get(
      uri,
      headers: {
        'Authorization': 'Bearer $adminToken',
      },
    );
    if (response.statusCode != 200) return null;
    final users = jsonDecode(response.body) as List<dynamic>;
    if (users.isEmpty) return null;
    return users[0]['id'] as String?;
  }

  /// Get the internal client ID for a given clientId.
  Future<String> getClientId({
    required String adminToken,
    required String realm,
    required String clientId,
  }) async {
    final uri = Uri.parse(
      '${_auth.keycloakUrl}/admin/realms/$realm/clients?clientId=$clientId',
    );
    final response = await _client.get(
      uri,
      headers: {
        'Authorization': 'Bearer $adminToken',
      },
    );

    if (response.statusCode != 200) {
      throw Exception(
        'Failed to get client ID: ${response.statusCode} ${response.body}',
      );
    }

    final clients = jsonDecode(response.body) as List<dynamic>;
    if (clients.isEmpty) {
      throw Exception('Client "$clientId" not found in realm "$realm"');
    }
    return clients[0]['id'] as String;
  }

  /// Update realm settings. Used to set short token lifespans for refresh tests.
  Future<void> updateRealmSettings({
    required String adminToken,
    required String realm,
    required Map<String, dynamic> settings,
  }) async {
    final uri = Uri.parse('${_auth.keycloakUrl}/admin/realms/$realm');
    final response = await _client.put(
      uri,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $adminToken',
      },
      body: jsonEncode(settings),
    );

    if (response.statusCode != 204) {
      throw Exception(
        'Failed to update realm settings: ${response.statusCode} ${response.body}',
      );
    }
  }

  /// Rotate realm keys by removing all active keys.
  /// Keycloak auto-generates new keys on the next token issuance,
  /// invalidating all existing tokens signed with the old keys.
  Future<void> rotateRealmKeys({
    required String adminToken,
    required String realm,
  }) async {
    final uri = Uri.parse(
      '${_auth.keycloakUrl}/admin/realms/$realm/keys',
    );
    final getResponse = await _client.get(
      uri,
      headers: {'Authorization': 'Bearer $adminToken'},
    );
    if (getResponse.statusCode != 200) {
      throw Exception(
        'Failed to get realm keys: ${getResponse.statusCode} ${getResponse.body}',
      );
    }

    final keys = jsonDecode(getResponse.body) as Map<String, dynamic>;
    final activeKeys = keys['keys'] as List<dynamic>? ?? [];
    for (final key in activeKeys) {
      final kid = key['kid'] as String? ?? key['id'] as String?;
      if (kid == null) continue;
      if (key['status'] != null && key['status'] != 'active') continue;

      final deleteUri = Uri.parse(
        '${_auth.keycloakUrl}/admin/realms/$realm/keys/$kid',
      );
      final deleteResponse = await _client.delete(
        deleteUri,
        headers: {'Authorization': 'Bearer $adminToken'},
      );
      if (deleteResponse.statusCode != 204 &&
          deleteResponse.statusCode != 404) {
        throw Exception(
          'Failed to delete key $kid: ${deleteResponse.statusCode} ${deleteResponse.body}',
        );
      }
    }
  }

  void close() => _client.close();

  /// Delete a user by UUID if available, otherwise look up by username first.
  /// Silently succeeds if the user does not exist (404).
  Future<void> safeDeleteUser({
    required String adminToken,
    required String realm,
    required String? userId,
    required String username,
  }) async {
    final id = userId ?? await getUserIdByUsername(
          adminToken: adminToken,
          realm: realm,
          username: username,
        );
    if (id == null) return;
    await deleteUser(adminToken: adminToken, realm: realm, userId: id);
  }
}
