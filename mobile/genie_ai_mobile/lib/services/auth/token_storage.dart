import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

abstract class TokenStorage {
  Future<String?> getAccessToken();
  Future<String?> getIdToken();
  Future<String?> getRefreshToken();
  Future<DateTime?> getAccessTokenExpiration();
  Future<void> saveTokens({
    required String accessToken,
    required String idToken,
    required String refreshToken,
    required DateTime accessTokenExpiration,
  });
  Future<void> deleteAll();
}

class SecureTokenStorage implements TokenStorage {
  static const _storageKey = 'auth_tokens';
  final FlutterSecureStorage _storage;

  SecureTokenStorage({FlutterSecureStorage? storage})
      : _storage = storage ?? const FlutterSecureStorage();

  @override
  Future<String?> getAccessToken() async {
    final data = await _readBlob();
    return data?['access_token'] as String?;
  }

  @override
  Future<String?> getIdToken() async {
    final data = await _readBlob();
    return data?['id_token'] as String?;
  }

  @override
  Future<String?> getRefreshToken() async {
    final data = await _readBlob();
    return data?['refresh_token'] as String?;
  }

  @override
  Future<DateTime?> getAccessTokenExpiration() async {
    final data = await _readBlob();
    final raw = data?['access_token_expiration'] as String?;
    if (raw == null) return null;
    return DateTime.tryParse(raw);
  }

  @override
  Future<void> saveTokens({
    required String accessToken,
    required String idToken,
    required String refreshToken,
    required DateTime accessTokenExpiration,
  }) async {
    final blob = jsonEncode({
      'access_token': accessToken,
      'id_token': idToken,
      'refresh_token': refreshToken,
      'access_token_expiration': accessTokenExpiration.toUtc().toIso8601String(),
    });
    await _storage.write(key: _storageKey, value: blob);
  }

  /// Clears the auth_tokens key. Named deleteAll() to match [TokenStorage]
  /// interface; all token data lives under the single blob key.
  @override
  Future<void> deleteAll() async {
    try {
      await _storage.delete(key: _storageKey);
    } catch (_) {}
  }

  Future<Map<String, dynamic>?> _readBlob() async {
    try {
      final raw = await _storage.read(key: _storageKey);
      if (raw == null) return null;
      return jsonDecode(raw) as Map<String, dynamic>;
    } on FormatException {
      return null;
    }
  }
}

class InMemoryTokenStorage implements TokenStorage {
  final Map<String, String> _store = {};

  @override
  Future<String?> getAccessToken() async => _get('access_token');

  @override
  Future<String?> getIdToken() async => _get('id_token');

  @override
  Future<String?> getRefreshToken() async => _get('refresh_token');

  @override
  Future<DateTime?> getAccessTokenExpiration() async {
    final raw = _get('access_token_expiration');
    if (raw == null) return null;
    return DateTime.tryParse(raw);
  }

  @override
  Future<void> saveTokens({
    required String accessToken,
    required String idToken,
    required String refreshToken,
    required DateTime accessTokenExpiration,
  }) async {
    _store.clear();
    _store['access_token'] = accessToken;
    _store['id_token'] = idToken;
    _store['refresh_token'] = refreshToken;
    _store['access_token_expiration'] =
        accessTokenExpiration.toUtc().toIso8601String();
  }

  @override
  Future<void> deleteAll() async {
    _store.clear();
  }

  String? _get(String key) => _store[key];
}
