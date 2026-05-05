import 'dart:convert';
import 'package:genie_ai_mobile/services/api_service.dart';

class UserService {
  final ApiService _api;
  final String _meEndpoint = 'me';

  UserService({ApiService? api}) : _api = api ?? ApiService();

  // --- USER DATA & PROFILE ---

  Future<Map<String, dynamic>> getCurrentUserInfo() async {
    final response = await _api.get(_meEndpoint);
    if (response.statusCode == 200) {
      return jsonDecode(response.body);
    }
    throw Exception('Failed to fetch info');
  }

  Future<Map<String, dynamic>> getProfile() async {
    final response = await _api.get(_meEndpoint);
    if (response.statusCode == 200) {
      return jsonDecode(response.body);
    }
    throw Exception('Failed to load profile');
  }

  Future<void> refreshUserData() async {
    await getCurrentUserInfo();
  }

  // --- ACCOUNT MANAGEMENT ---

  Future<Map<String, dynamic>> updateAccountSettings(
    Map<String, dynamic> settings,
  ) async {
    final response = await _api.put(_meEndpoint, settings);
    return jsonDecode(response.body);
  }

  Future<Map<String, dynamic>> resetUserData() async {
    final response = await _api.post('$_meEndpoint/reset-data', {});
    return jsonDecode(response.body);
  }

  Future<Map<String, dynamic>> deleteAccount() async {
    final response = await _api.post('$_meEndpoint/delete', {});
    return jsonDecode(response.body);
  }
}
