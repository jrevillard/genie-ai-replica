import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../design_system/tokens/app_tokens.dart';
import '../design_system/theme/app_theme.dart';

class ThemeManager extends ChangeNotifier {
  static final ThemeManager _instance = ThemeManager._internal();
  factory ThemeManager() => _instance;
  ThemeManager._internal();

  static const _keyTheme = 'theme_preference';
  static const _keyFontSize = 'font_scale';

  // ===========================================================================
  // STATE
  // ===========================================================================

  Map<String, dynamic> _config = {};

  String currentTheme = 'light';
  String userPreference = 'light';
  bool isDarkMode = false;

  double fontSize = 50.0;

  late AppTokens _tokens;

  AppTokens get tokens => _tokens;

  // ===========================================================================
  // ACTIONS
  // ===========================================================================

  void setConfiguration(Map<String, dynamic> config) {
    _config = config;
    _rebuildTokens();
    notifyListeners();
  }

  void setTheme(String theme) {
    userPreference = theme;

    if (theme == 'system') {
      final brightness =
          SchedulerBinding.instance.platformDispatcher.platformBrightness;
      isDarkMode = brightness == Brightness.dark;
    } else {
      isDarkMode = theme == 'dark';
    }

    currentTheme = isDarkMode ? 'dark' : 'light';
    _rebuildTokens();
    _persistAsync();
    notifyListeners();
  }

  void setFontSize(double size) {
    fontSize = size;
    _rebuildTokens();
    _persistAsync();
    notifyListeners();
  }

  void toggleTheme() => setTheme(currentTheme == 'light' ? 'dark' : 'light');

  ThemeMode get themeMode {
    if (userPreference == 'dark') return ThemeMode.dark;
    if (userPreference == 'light') return ThemeMode.light;
    return ThemeMode.system;
  }

  // ===========================================================================
  // PERSISTENCE
  // ===========================================================================

  /// Load persisted preferences from local storage. Call once at app start.
  Future<void> restorePreferences() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final theme = prefs.getString(_keyTheme);
      final scale = prefs.getDouble(_keyFontSize);
      if (theme != null) setTheme(theme);
      if (scale != null) setFontSize(scale);
    } catch (_) {
      // First launch or storage unavailable — keep defaults
    }
  }

  Future<void> _persistAsync() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_keyTheme, userPreference);
      await prefs.setDouble(_keyFontSize, fontSize);
    } catch (_) {
      // Silent — preferences are a nice-to-have
    }
  }

  // ===========================================================================
  // INTERNAL
  // ===========================================================================

  void _rebuildTokens() {
    final fontScale = fontSize / 50.0;
    _tokens = AppTokens.fromConfig(
      config: _config,
      isDark: isDarkMode,
      fontScale: fontScale,
    );
  }

  Map<String, dynamic> get config => _config;

  // ===========================================================================
  // DYNAMIC THEME DATA
  // ===========================================================================

  ThemeData get lightTheme => AppTheme.build(
    AppTokens.fromConfig(config: _config, isDark: false, fontScale: fontSize / 50.0),
  );

  ThemeData get darkTheme => AppTheme.build(
    AppTokens.fromConfig(config: _config, isDark: true, fontScale: fontSize / 50.0),
  );
}
