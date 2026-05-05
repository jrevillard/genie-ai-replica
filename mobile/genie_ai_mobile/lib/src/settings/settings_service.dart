import 'package:flutter/material.dart';

/// A service that stores and retrieves user settings.
///
/// By default, this class does not persist user settings.
class SettingsService {
  /// Loads the User's preferred ThemeMode from local or remote storage.
  Future<ThemeMode> themeMode() async => ThemeMode.system;

  /// Persists the user's preferred ThemeMode to local or remote storage.
  Future<void> updateThemeMode(ThemeMode theme) async {}
}
