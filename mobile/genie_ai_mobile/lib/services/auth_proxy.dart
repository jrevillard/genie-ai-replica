import 'dart:convert';
import 'package:genie_ai_mobile/services/api_service.dart';

class AuthProxy {
  final ApiService _api = ApiService();

  /// Authenticate user with username and password
  Future<Map<String, dynamic>> login(String loginName, String password) async {
    // Note: Use a utility to hash the password as per authService.js hashPassword()
    final response = await _api.post('auth/login', {
      'loginName': loginName,
      'encPassword': password, 
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

  /// Refresh the access token using the refresh token
  Future<Map<String, dynamic>> refreshToken(String refreshToken) async {
    final response = await _api.post('auth/refresh-token', {
      'refreshToken': refreshToken,
    });
    
    if (response.statusCode == 200) {
      final data = jsonDecode(response.body);
      if (data['accessToken'] != null) {
        _api.setToken(data['accessToken']);
      }
      return data;
    }
    throw Exception('Refresh Token Error');
  }

  /// Log out the user
  Future<void> logout() async {
    await _api.post('auth/logout', {});
    _api.clearToken();
  }

  /// Get the currently authenticated user from the server
  Future<Map<String, dynamic>> fetchCurrentUser() async {
    final response = await _api.get('auth/me');
    return jsonDecode(response.body)['user'];
  }

  /// Initiate password reset process
  Future<Map<String, dynamic>> initiatePasswordReset(String email) async {
    final response = await _api.post('auth/reset-password', {'email': email});
    return jsonDecode(response.body);
  }

  /// Verify email with token
  Future<Map<String, dynamic>> verifyEmail(String token) async {
    final response = await _api.get('auth/verify-email/$token');
    return jsonDecode(response.body);
  }
}