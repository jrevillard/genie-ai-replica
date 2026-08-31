import 'dart:convert';
import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;
import 'package:genie_ai_mobile/services/api_service.dart';

class UserService {
  final ApiService _api = ApiService();
  final String authEndpoint = 'auth';
  final String userEndpoint = 'users';

  Map<String, dynamic>? _currentUser;

  // --- AUTHENTICATION & HASHING ---

  String hashPassword(String password) {
    var bytes = utf8.encode(password);
    return sha256.convert(bytes).toString();
  }

  // Keycloak OIDC endpoints (Direct Access Grant / ROPC). Only auth transport
  // changed — the login form, and everything after login, stay as they were.
  static const String _keycloakUrl = String.fromEnvironment(
    'KEYCLOAK_URL',
    defaultValue: 'http://localhost:8081',
  );
  static const String _keycloakRealm = String.fromEnvironment(
    'KEYCLOAK_REALM',
    defaultValue: 'genie',
  );
  static const String _keycloakClientId = String.fromEnvironment(
    'KEYCLOAK_CLIENT_ID',
    defaultValue: 'genie-app',
  );

  Future<Map<String, dynamic>> login(String loginName, String password) async {
    // 1. Authenticate against Keycloak (password grant). Note: Keycloak keeps
    //    its own password hashes, so the raw password is sent (over TLS in
    //    production) — the legacy client-side sha256 no longer applies here.
    final tokenUri = Uri.parse(
      '$_keycloakUrl/realms/$_keycloakRealm/protocol/openid-connect/token',
    );
    final kcResponse = await http.post(
      tokenUri,
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: {
        'grant_type': 'password',
        'client_id': _keycloakClientId,
        'username': loginName,
        'password': password,
        'scope': 'openid profile email',
      },
    );

    final tokenData = _decodeJsonObject(kcResponse.body);
    if (kcResponse.statusCode != 200) {
      throw Exception(
        'Login Error: ${tokenData['error_description'] ?? tokenData['error'] ?? kcResponse.body}',
      );
    }

    final accessToken = tokenData['access_token'];
    if (accessToken is String && accessToken.isNotEmpty) {
      _api.setToken(accessToken);
    }

    // 2. Fetch (and auto-provision, on first login) our backend user profile
    //    so downstream code keeps receiving the ArangoDB user document.
    Map<String, dynamic> userData = {'loginName': loginName};
    try {
      final meResponse = await _api.get(userEndpoint);
      if (meResponse.statusCode == 200) {
        final me = _decodeJsonObject(meResponse.body);
        userData = me['user'] is Map<String, dynamic>
            ? me['user'] as Map<String, dynamic>
            : me;
      }
    } catch (_) {
      // Profile fetch failing shouldn't block login; token is already set.
    }

    // Flat legacy shape: old backend returned the user document's fields at the
    // top level plus tokens — downstream widgets index those keys directly.
    final data = <String, dynamic>{
      ...userData,
      'user': userData,
      'accessToken': accessToken,
      'refreshToken': tokenData['refresh_token'] ?? '',
    };
    _currentUser = data;
    return data;
  }

  Map<String, dynamic> _decodeJsonObject(String body) {
    try {
      final decoded = jsonDecode(body);
      return decoded is Map<String, dynamic> ? decoded : {};
    } catch (_) {
      return {};
    }
  }

  Future<void> logout() async {
    await _api.post('$authEndpoint/logout', {});
    _api.clearToken();
    _currentUser = null;
  }

  // --- USER DATA & PROFILE ---

  Map<String, dynamic>? getCurrentUser() => _currentUser;

  Future<Map<String, dynamic>> getCurrentUserInfo() async {
    final response = await _api.get('$authEndpoint/me');
    if (response.statusCode == 200) {
      _currentUser = jsonDecode(response.body);
      return _currentUser!;
    }
    throw Exception('Failed to fetch info');
  }

  Future<Map<String, dynamic>> getProfile(String userId) async {
    final response = await _api.get('$userEndpoint/$userId'); //
    if (response.statusCode == 200) {
      return jsonDecode(response.body);
    }
    throw Exception('Failed to load profile');
  }

  Future<void> refreshUserData() async {
    await getCurrentUserInfo();
  }

  // --- ACCOUNT MANAGEMENT ---

  Future<Map<String, dynamic>> updateAccountSettings(String userId, Map<String, dynamic> settings) async {
    // Use the specific userId to avoid greedy router collisions on the backend
    final response = await _api.put('$userEndpoint/$userId', settings);
    return jsonDecode(response.body);
  }

  Future<Map<String, dynamic>> updateEmail(String email, String password, String userId) async {
    final response = await _api.put('$userEndpoint/email', {
      'email': email,
      'password': hashPassword(password),
      'userId': userId,
    });
    return jsonDecode(response.body);
  }

  Future<Map<String, dynamic>> resetUserData() async {
    final response = await _api.post('$userEndpoint/reset-data', {}); //
    return jsonDecode(response.body);
  }

  Future<Map<String, dynamic>> deactivateAccount(String reason, String password) async {
    final response = await _api.post('$userEndpoint/deactivate', {
      'reason': reason,
      'password': hashPassword(password),
    });
    return jsonDecode(response.body);
  }

  // FIXED: Optional reason to resolve positional argument error
  Future<Map<String, dynamic>> deleteAccount(String password, {String reason = ''}) async {
    final response = await _api.post('$userEndpoint/delete', {
      'password': hashPassword(password),
      'reason': reason,
    });
    return jsonDecode(response.body);
  }

  // --- REGISTRATION & AVAILABILITY ---

  Future<Map<String, dynamic>> register(Map<String, dynamic> userData) async {
    final payload = Map<String, dynamic>.from(userData);
    final password = payload.remove('password');
    if (password is String && password.isNotEmpty) {
      payload['encPassword'] = hashPassword(password);
    }

    final response = await _api.post('$authEndpoint/register', payload);
    final data = _decodeJsonObject(response.body);

    if (response.statusCode == 200 || response.statusCode == 201) {
      return data.isNotEmpty ? data : {'success': true};
    }

    return {
      'success': false,
      'message':
          data['message'] ??
          data['error'] ??
          'Registration failed (${response.statusCode})',
    };
  }

  Future<bool> checkUsernameAvailability(String username) async {
    try {
      final response = await _api.get(
        '$userEndpoint/check-username',
        params: {'username': username},
      );
      if (response.statusCode != 200) return true;
      return jsonDecode(response.body)['available'] ?? true;
    } catch (_) {
      return true;
    }
  }

  Future<bool> checkEmailAvailability(String email) async {
    try {
      final response = await _api.get(
        '$userEndpoint/check-email',
        params: {'email': email},
      );
      if (response.statusCode != 200) return true;
      return jsonDecode(response.body)['available'] ?? true;
    } catch (_) {
      return true;
    }
  }
}