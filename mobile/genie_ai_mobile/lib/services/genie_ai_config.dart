import 'dart:convert';
import 'package:flutter/foundation.dart';
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

          // The shared config.json uses web public-root paths (e.g.
          // "/config/agro-genio-icon.svg"); Flutter assets live under "assets/".
          // Strip a leading slash, then map to the asset bundle key:
          // "/config/x.svg" -> "config/x.svg" -> "assets/config/x.svg".
          if (iconPath.startsWith('/')) {
            iconPath = iconPath.substring(1);
          }
          if (!iconPath.startsWith('assets/')) {
            iconPath = 'assets/$iconPath';
          }
        }
      }
      _loaded = true;
    } catch (e) {
      debugPrint("Error loading Genie AI Config: $e");
    }
  }

  static bool get isLoaded => _loaded;
}
