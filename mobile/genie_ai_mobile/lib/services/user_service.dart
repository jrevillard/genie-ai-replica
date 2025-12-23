import 'dart:convert';
import 'package:crypto/crypto.dart'; // Handles SHA-256 hashing
import 'package:genie_ai_mobile/services/api_service.dart';

class UserService {
  final ApiService _api = ApiService();
  final String authEndpoint = 'auth';
  final String userEndpoint = 'users';

  // --- AUTHENTICATION & HASHING ---

  /// Mirrors hashPassword logic in userService.js/authService.js
  String hashPassword(String password) {
    var bytes = utf8.encode(password); 
    return sha256.convert(bytes).toString(); // Returns hex string
  }

  /// Primary login method used by LoginScreen.dart
  Future<Map<String, dynamic>> login(String loginName, String password) async {
    final response = await _api.post('$authEndpoint/login', {
      'loginName': loginName,
      'encPassword': hashPassword(password),
    });
    
    if (response.statusCode == 200) {
      final data = jsonDecode(response.body);
      if (data['accessToken'] != null) {
        _api.setToken(data['accessToken']);
      }
      return data;
    }
    throw Exception('Login Error: ${response.body}');
  }

  // --- REGISTRATION & AVAILABILITY ---

  /// Mirrors RegisterScreen.vue handleRegister()
  Future<Map<String, dynamic>> register(Map<String, dynamic> userData) async {
    final payload = Map<String, dynamic>.from(userData);
    if (payload.containsKey('password')) {
      payload['encPassword'] = hashPassword(payload['password']);
      payload.remove('password');
    }
    final response = await _api.post('$authEndpoint/register', payload);
    return jsonDecode(response.body);
  }

  Future<bool> checkUsernameAvailability(String username) async {
    final response = await _api.get('$userEndpoint/check-username', params: {'username': username});
    return jsonDecode(response.body)['available'] ?? false;
  }

  Future<bool> checkEmailAvailability(String email) async {
    final response = await _api.get('$userEndpoint/check-email', params: {'email': email});
    return jsonDecode(response.body)['available'] ?? false;
  }

  // --- ACCOUNT MANAGEMENT ---

  Future<Map<String, dynamic>> updateAccountSettings(Map<String, dynamic> settings) async {
    final response = await _api.put('$userEndpoint/settings', settings);
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

  Future<Map<String, dynamic>> deactivateAccount(String reason, String password) async {
    final response = await _api.post('$userEndpoint/deactivate', {
      'reason': reason,
      'password': hashPassword(password),
    });
    return jsonDecode(response.body);
  }

  Future<Map<String, dynamic>> deleteAccount(String password, {String reason = ''}) async {
    final response = await _api.post('$userEndpoint/delete', {
      'password': hashPassword(password),
      'reason': reason,
    });
    return jsonDecode(response.body);
  }

  // --- ADMINISTRATIVE (Mirrors admin methods in userService.js) ---

  Future<Map<String, dynamic>> forceUserLogout(String userId) async {
    final response = await _api.post('$userEndpoint/admin/users/$userId/force-logout', {});
    return jsonDecode(response.body);
  }

  Future<Map<String, dynamic>> resendVerificationEmailAdmin(String userId) async {
    final response = await _api.post('$userEndpoint/admin/users/$userId/resend-verification', {});
    return jsonDecode(response.body);
  }
}