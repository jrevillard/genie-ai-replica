import 'dart:convert';
import 'package:genie_ai_mobile/services/api_service.dart';

class UserProxy {
  final ApiService _api = ApiService();

  /// Register a new user
  Future<Map<String, dynamic>> register(Map<String, dynamic> userData) async {
    final response = await _api.post('auth/register', userData);
    return jsonDecode(response.body);
  }

  /// Update user account settings
  Future<Map<String, dynamic>> updateAccountSettings(Map<String, dynamic> settings) async {
    final response = await _api.put('users/settings', settings);
    return jsonDecode(response.body);
  }

  /// Update user's email address
  Future<Map<String, dynamic>> updateEmail(String newEmail, String password, String userId) async {
    final response = await _api.put('users/email', {
      'email': newEmail,
      'password': password, // Ensure this is hashed
      'userId': userId
    });
    return jsonDecode(response.body);
  }

  /// Deactivate user account
  Future<Map<String, dynamic>> deactivateAccount(String reason, String password) async {
    final response = await _api.post('users/deactivate', {
      'reason': reason,
      'password': password
    });
    return jsonDecode(response.body);
  }

  /// Permanently delete user account
  Future<Map<String, dynamic>> deleteAccount(String password, {String reason = ''}) async {
    final response = await _api.post('users/delete', {
      'password': password,
      'reason': reason
    });
    return jsonDecode(response.body);
  }

  /// ADMIN: Update user role
  Future<Map<String, dynamic>> updateUserRole(String userId, Map<String, dynamic> updateData) async {
    final response = await _api.put('users/$userId', updateData);
    return jsonDecode(response.body);
  }

  /// ADMIN: Force user logout
  Future<Map<String, dynamic>> forceUserLogout(String userId) async {
    final response = await _api.post('users/admin/users/$userId/force-logout', {});
    return jsonDecode(response.body);
  }

  /// ADMIN: Resend email verification
  Future<Map<String, dynamic>> resendVerificationEmailAdmin(String userId) async {
    final response = await _api.post('users/admin/users/$userId/resend-verification', {});
    return jsonDecode(response.body);
  }
}