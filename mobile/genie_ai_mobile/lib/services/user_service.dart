import 'dart:convert';
import 'package:crypto/crypto.dart'; 
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

  Future<Map<String, dynamic>> login(String loginName, String password) async {
    final response = await _api.post('$authEndpoint/login', {
      'loginName': loginName,
      'encPassword': hashPassword(password),
    });
    
    if (response.statusCode == 200) {
      final data = jsonDecode(response.body);
      if (data['accessToken'] != null) {
        _api.setToken(data['accessToken']);
        _currentUser = data['user'] ?? data;
      }
      return data;
    }
    throw Exception('Login Error: ${response.body}');
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
    if (payload.containsKey('password')) {
      payload['encPassword'] = hashPassword(payload['password']);
      payload.remove('password');
    }
    return jsonDecode((await _api.post('$authEndpoint/register', payload)).body);
  }

  Future<bool> checkUsernameAvailability(String username) async {
    final response = await _api.get('$userEndpoint/check-username', params: {'username': username});
    return jsonDecode(response.body)['available'] ?? false;
  }

  Future<bool> checkEmailAvailability(String email) async {
    final response = await _api.get('$userEndpoint/check-email', params: {'email': email});
    return jsonDecode(response.body)['available'] ?? false;
  }
}