import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

// SharedPreferences keys (non-sensitive)
const _kIsLoggedIn = 'amina_is_logged_in';
const _kRememberMe = 'amina_remember_me';
const _kAppMode = 'amina_app_mode'; // 'patient' | 'caregiverOnly'

// SecureStorage keys (sensitive)
const _kAccessToken = 'amina_access_token';
const _kSessionId = 'amina_session_id';
const _kUserEmail = 'amina_user_email';
const _kUserName = 'amina_user_name';

class AuthLocalDatasource {
  final _secure = const FlutterSecureStorage();

  // ── Token storage (secure) ─────────────────────────────────────────────────

  Future<void> saveTokens({
    required String accessToken,
    required String sessionId,
    required String email,
    required String name,
  }) async {
    await Future.wait([
      _secure.write(key: _kAccessToken, value: accessToken),
      _secure.write(key: _kSessionId, value: sessionId),
      _secure.write(key: _kUserEmail, value: email),
      _secure.write(key: _kUserName, value: name),
    ]);
  }

  Future<Map<String, String?>> loadTokens() async {
    final results = await Future.wait([
      _secure.read(key: _kAccessToken),
      _secure.read(key: _kSessionId),
      _secure.read(key: _kUserEmail),
      _secure.read(key: _kUserName),
    ]);
    return {
      'accessToken': results[0],
      'sessionId': results[1],
      'email': results[2],
      'name': results[3],
    };
  }

  Future<String?> getAccessToken() => _secure.read(key: _kAccessToken);

  Future<void> clearTokens() async {
    await Future.wait([
      _secure.delete(key: _kAccessToken),
      _secure.delete(key: _kSessionId),
      _secure.delete(key: _kUserEmail),
      _secure.delete(key: _kUserName),
    ]);
  }

  // ── Session flag (kept for caregiver flow) ─────────────────────────────────

  Future<void> saveSession() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_kIsLoggedIn, true);
  }

  // Checks secure token first; falls back to the SharedPreferences flag used
  // by the caregiver linking flow which has no access token.
  Future<bool> hasSession() async {
    final token = await _secure.read(key: _kAccessToken);
    if (token != null) return true;
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_kIsLoggedIn) ?? false;
  }

  Future<void> clearSession() async {
    await clearTokens();
    final prefs = await SharedPreferences.getInstance();
    await Future.wait([
      prefs.remove(_kIsLoggedIn),
      prefs.remove(_kRememberMe),
      prefs.remove(_kAppMode),
      prefs.remove('amina_vitals_log'),
      prefs.remove('amina_session_cache_v1'),
    ]);
  }

  // ── App mode (non-sensitive) ───────────────────────────────────────────────

  Future<void> saveAppMode(String mode) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kAppMode, mode);
  }

  Future<String> loadAppMode() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_kAppMode) ?? 'patient';
  }

  // ── Remember-me flag ───────────────────────────────────────────────────────

  Future<void> saveRememberMe({required bool value}) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_kRememberMe, value);
  }

  Future<bool> getRememberMe() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_kRememberMe) ?? false;
  }
}

final authLocalDatasourceProvider = Provider<AuthLocalDatasource>(
  (_) => AuthLocalDatasource(),
);
