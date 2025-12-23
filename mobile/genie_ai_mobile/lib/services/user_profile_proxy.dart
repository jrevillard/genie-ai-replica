import 'dart:convert';
import 'package:genie_ai_mobile/services/api_service.dart';

class UserProfileProxy {
  final ApiService _api = ApiService();

  Future<Map<String, dynamic>> getProfile(String userId) async {
    final res = await _api.get('users/$userId');
    return jsonDecode(res.body);
  }

  Future<Map<String, dynamic>> updateProfile(String userId, Map<String, dynamic> data) async {
    final res = await _api.put('users/$userId', data);
    return jsonDecode(res.body);
  }

  Future<Map<String, dynamic>> updateUserRole(String userId, String role) async {
    final res = await _api.put('users/$userId/role', {'role': role});
    return jsonDecode(res.body);
  }

  Future<Map<String, dynamic>> searchUsers(Map<String, dynamic> criteria) async {
    final res = await _api.get('users/search', params: criteria);
    return jsonDecode(res.body);
  }
}