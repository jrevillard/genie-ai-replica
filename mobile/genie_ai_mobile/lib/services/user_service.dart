import 'dart:convert';
import 'package:openapi/api.dart';

class UserService {
  final CurrentUserApi _userApi;

  UserService({required CurrentUserApi userApi}) : _userApi = userApi;

  // --- USER DATA & PROFILE ---

  Future<Map<String, dynamic>> getCurrentUserInfo() async {
    final response = await _userApi.apiMeGetWithHttpInfo();
    if (response.statusCode == 200) {
      return jsonDecode(response.body);
    }
    throw Exception('Failed to fetch info');
  }

  Future<Map<String, dynamic>> getProfile() async {
    final response = await _userApi.apiMeGetWithHttpInfo();
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
    final response = await _userApi.apiMePutWithHttpInfo(
      data: jsonEncode(settings),
    );
    if (response.statusCode == 200) {
      return jsonDecode(response.body);
    }
    throw Exception('Failed to update account settings');
  }

  Future<Map<String, dynamic>> resetUserData() async {
    final response = await _userApi.apiMeResetDataPostWithHttpInfo();
    if (response.statusCode == 200) {
      return jsonDecode(response.body);
    }
    throw Exception('Failed to reset user data');
  }

  Future<Map<String, dynamic>> deleteAccount() async {
    final response = await _userApi.apiMeDeletePostWithHttpInfo();
    if (response.statusCode == 200) {
      return jsonDecode(response.body);
    }
    throw Exception('Failed to delete account');
  }
}
