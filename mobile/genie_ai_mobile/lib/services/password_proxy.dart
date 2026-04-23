import 'dart:convert';
import 'package:genie_ai_mobile/services/api_service.dart';

class PasswordProxy {
  final ApiService _api = ApiService();

  /// Initiate password reset by sending email with reset token
  Future<Map<String, dynamic>> initiateReset(String email) async {
    final response = await _api.post('auth/reset-password', {'email': email});
    return jsonDecode(response.body);
  }

  /// Validate a password reset token from email
  Future<Map<String, dynamic>> validateToken(String token) async {
    final response = await _api.post('auth/validate-token', {'token': token});
    return jsonDecode(response.body);
  }

  /// Reset password with token
  Future<Map<String, dynamic>> resetPassword(
    String token,
    String newPassword,
  ) async {
    // Note: The newPassword should be hashed using SHA-256 before this call
    final response = await _api.post('auth/reset-password/confirm', {
      'token': token,
      'newPassword': newPassword,
    });
    return jsonDecode(response.body);
  }

  /// Change password for an already authenticated user
  Future<Map<String, dynamic>> changePassword(
    String currentPassword,
    String newPassword,
  ) async {
    // Note: Both passwords should be hashed using SHA-256
    final response = await _api.post('auth/change-password', {
      'currentPassword': currentPassword,
      'newPassword': newPassword,
    });
    return jsonDecode(response.body);
  }

  /// Validate password strength (UI Utility mirroring backend logic)
  Map<String, dynamic> validatePasswordStrength(String password) {
    bool hasLowercase = password.contains(RegExp(r'[a-z]'));
    bool hasUppercase = password.contains(RegExp(r'[A-Z]'));
    bool hasDigit = password.contains(RegExp(r'\d'));
    bool hasSpecial = password.contains(RegExp(r'[^a-zA-Z0-9]'));

    int score = 0;
    if (hasLowercase) score++;
    if (hasUppercase) score++;
    if (hasDigit) score++;
    if (hasSpecial) score++;
    if (password.length >= 12) score++;

    return {
      'isValid': score >= 3 && password.length >= 8,
      'score': score.clamp(0, 4),
    };
  }

  /// Utility to check if passwords match during confirmation
  bool doPasswordsMatch(String password, String confirmPassword) {
    return password == confirmPassword;
  }
}
