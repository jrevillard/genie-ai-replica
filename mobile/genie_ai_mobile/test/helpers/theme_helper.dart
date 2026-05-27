import 'package:flutter/material.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';

import 'tokens.dart';

/// Initialize ThemeManager with light-mode default tokens.
void setupLightTokens() {
  final tm = ThemeManager();
  tm.setTheme('light');
  tm.setFontSize(50.0);
  tm.setConfiguration(Map<String, dynamic>.from(lightConfig));
}

/// Initialize ThemeManager with dark-mode default tokens.
void setupDarkTokens() {
  final tm = ThemeManager();
  tm.setTheme('dark');
  tm.setFontSize(50.0);
  tm.setConfiguration(Map<String, dynamic>.from(darkConfig));
}

/// Initialize ThemeManager with a custom config map.
void setupTokensWithConfig(Map<String, dynamic> config) {
  final tm = ThemeManager();
  tm.setTheme('light');
  tm.setFontSize(50.0);
  tm.setConfiguration(Map<String, dynamic>.from(config));
}

/// Reset ThemeManager singleton state between tests.
void resetThemeManager() {
  final tm = ThemeManager();
  tm.setTheme('light');
  tm.setFontSize(50.0);
  tm.setConfiguration({});
}
