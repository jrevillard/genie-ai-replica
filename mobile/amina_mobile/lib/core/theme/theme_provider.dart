import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

// ─── Persistence key ──────────────────────────────────────────────────────────

const _kPrefKey = 'amina_theme_mode';

// ═══════════════════════════════════════════════════════════════════════════════
// THEME NOTIFIER
//
// Single source of truth for the current ThemeMode.
// The mode is persisted in SharedPreferences so it survives app restarts.
//
// Usage — toggle:
//   ref.read(themeModeProvider.notifier).toggle();
//
// Usage — read current mode:
//   final isDark = ref.watch(themeModeProvider) == ThemeMode.dark;
// ═══════════════════════════════════════════════════════════════════════════════

class ThemeNotifier extends StateNotifier<ThemeMode> {
  /// [initial] is the persisted value loaded in [main] before [runApp].
  ThemeNotifier(super.initial);

  // ── Public API ──────────────────────────────────────────────────────────────

  bool get isDark => state == ThemeMode.dark;

  /// Flip between light ↔ dark.
  void toggle() => setMode(isDark ? ThemeMode.light : ThemeMode.dark);

  /// Explicitly set a mode (also called from Settings page).
  void setMode(ThemeMode mode) {
    if (state == mode) return;
    state = mode;
    _persist(mode);
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  void _persist(ThemeMode mode) {
    SharedPreferences.getInstance()
        .then((prefs) => prefs.setString(_kPrefKey, mode.name));
  }

  /// Load the persisted theme before [runApp] so there's no flash.
  ///
  /// Call from [main]:
  /// ```dart
  /// final savedTheme = await ThemeNotifier.load();
  /// runApp(ProviderScope(
  ///   overrides: [
  ///     themeModeProvider.overrideWith((_) => ThemeNotifier(savedTheme)),
  ///   ],
  ///   child: const AminaCareApp(),
  /// ));
  /// ```
  static Future<ThemeMode> load() async {
    final prefs = await SharedPreferences.getInstance();
    return switch (prefs.getString(_kPrefKey)) {
      'dark'  => ThemeMode.dark,
      'light' => ThemeMode.light,
      _       => ThemeMode.light, // default: light on first launch
    };
  }
}

// ─── Provider ─────────────────────────────────────────────────────────────────

/// Provides the active [ThemeMode].
///
/// The initial value is [ThemeMode.light] but is **always overridden** in
/// [main] with the value loaded from [SharedPreferences] before the first
/// frame — so there is no light-flash on dark-mode users.
final themeModeProvider =
    StateNotifierProvider<ThemeNotifier, ThemeMode>(
  (ref) => ThemeNotifier(ThemeMode.light),
);
