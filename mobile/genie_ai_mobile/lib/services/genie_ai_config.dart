import 'dart:convert';
import 'package:flutter/services.dart';

class GenieAiConfig {
  static String title = "Genie AI"; // Default fallback
  static String iconPath = "images/genie-ai-icon-light.svg"; // Default fallback
  static bool _loaded = false;

  /// Loads the configuration from assets/genie-ai-config.json
  /// This should be called before the app runs or lazily in the screens.
  static Future<void> load() async {
    if (_loaded) return;
    try {
      final String jsonString = await rootBundle.loadString(
        'assets/config/genie-ai-config.json',
      );
      final Map<String, dynamic> config = json.decode(jsonString);

      // FIX: Access nested keys based on your JSON structure
      if (config.containsKey('app')) {
        final appConfig = config['app'];

        // Get Title
        if (appConfig['title'] != null) {
          title = appConfig['title'];
        }

        // Get Icon Value
        // JSON structure was: "icon": { "type": "file", "value": "..." }
        if (appConfig['icon'] != null && appConfig['icon']['value'] != null) {
          iconPath = appConfig['icon']['value'];

          // Remove leading slash if present (e.g. "/assets/..." -> "assets/...")
          if (iconPath.startsWith('/')) {
            iconPath = iconPath.substring(1);
          }
        }
      }
      _loaded = true;
    } catch (e) {
      print("Error loading Genie AI Config: $e");
    }
  }

  static bool get isLoaded => _loaded;
}
