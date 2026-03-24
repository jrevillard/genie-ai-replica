import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Environment type
enum Environment { development, production }

/// Secure API Key Storage Service
///
/// Stores API keys securely using flutter_secure_storage on mobile platforms.
/// Uses environment-based configuration for development vs production.
class ApiKeyService {
  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(
      encryptedSharedPreferences: true,
    ),
    iOptions: IOSOptions(
      accessibility: KeychainAccessibility.first_unlock,
    ),
  );

  static const String _initializedKey = 'api_keys_initialized';
  static const String _environmentKey = 'api_environment';

  /// API Key identifiers
  static const String googleEarthEngineKey = 'google_earth_engine_key';
  static const String googleEarthEngineClientId = 'google_earth_engine_client_id';
  static const String googleEarthEngineClientSecret = 'google_earth_engine_client_secret';
  static const String usdaApiKey = 'usda_api_key';
  static const String faoApiKey = 'fao_api_key';
  static const String sentinelHubClientId = 'sentinel_hub_client_id';
  static const String sentinelHubClientSecret = 'sentinel_hub_client_secret';

  /// Get current environment
  static Future<Environment> getEnvironment() async {
    final prefs = await SharedPreferences.getInstance();
    final env = prefs.getString(_environmentKey) ?? 'development';
    return env == 'production' ? Environment.production : Environment.development;
  }

  /// Set environment
  static Future<void> setEnvironment(Environment env) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_environmentKey, env.name);
  }

  /// Check if API keys have been initialized
  static Future<bool> isInitialized() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_initializedKey) ?? false;
  }

  /// Mark API keys as initialized
  static Future<void> markInitialized() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_initializedKey, true);
  }

  /// Store an API key securely
  static Future<void> storeApiKey(String keyId, String keyValue) async {
    try {
      await _storage.write(key: keyId, value: keyValue);
      print('[ApiKeyService] Stored API key: $keyId');
    } catch (e) {
      print('[ApiKeyService] Error storing API key $keyId: $e');
      rethrow;
    }
  }

  /// Retrieve an API key
  static Future<String?> getApiKey(String keyId) async {
    try {
      final value = await _storage.read(key: keyId);
      return value;
    } catch (e) {
      print('[ApiKeyService] Error retrieving API key $keyId: $e');
      return null;
    }
  }

  /// Delete an API key
  static Future<void> deleteApiKey(String keyId) async {
    try {
      await _storage.delete(key: keyId);
      print('[ApiKeyService] Deleted API key: $keyId');
    } catch (e) {
      print('[ApiKeyService] Error deleting API key $keyId: $e');
    }
  }

  /// Clear all stored API keys
  static Future<void> clearAllApiKeys() async {
    try {
      await _storage.deleteAll();
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(_initializedKey, false);
      print('[ApiKeyService] Cleared all API keys');
    } catch (e) {
      print('[ApiKeyService] Error clearing API keys: $e');
    }
  }

  /// Check if a specific API key exists
  static Future<bool> hasApiKey(String keyId) async {
    final value = await getApiKey(keyId);
    return value != null && value.isNotEmpty;
  }

  /// Get all available API key status
  static Future<Map<String, bool>> getApiKeyStatus() async {
    final keys = [
      googleEarthEngineKey,
      googleEarthEngineClientId,
      googleEarthEngineClientSecret,
      usdaApiKey,
      faoApiKey,
      sentinelHubClientId,
      sentinelHubClientSecret,
    ];

    final status = <String, bool>{};
    for (final key in keys) {
      status[key] = await hasApiKey(key);
    }

    return status;
  }

  /// Validate API key format (basic validation)
  static bool validateApiKeyFormat(String keyId, String keyValue) {
    switch (keyId) {
      case googleEarthEngineKey:
        // GEE tokens are typically JWT format
        return keyValue.length > 50;

      case googleEarthEngineClientId:
      case googleEarthEngineClientSecret:
        // OAuth credentials
        return keyValue.length >= 20;

      case usdaApiKey:
        // USDA API keys vary in format
        return keyValue.length >= 10;

      case faoApiKey:
        // FAO API keys
        return keyValue.length >= 10;

      case sentinelHubClientId:
      case sentinelHubClientSecret:
        // Sentinel Hub OAuth credentials
        return keyValue.length >= 20;

      default:
        return keyValue.isNotEmpty;
    }
  }
}
