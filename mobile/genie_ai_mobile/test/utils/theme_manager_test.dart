import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';

/// The first frame reads ThemeManager().tokens through lightTheme inside
/// MyApp.build — BEFORE the async config load calls setConfiguration. The
/// field was `late`, so a cold start threw LateInitializationError from the
/// MaterialApp build (observed live on the emulator 2026-11-20: the thrown
/// error was the run's first exception, which also suppressed the full
/// detail block of a second, unrelated layout exception behind it — Flutter
/// prints full exception detail only once per run).
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('tokens are readable before any configuration lands', () {
    final manager = ThemeManager();
    final tokens = manager.tokens; // threw LateInitializationError before fix
    expect(tokens.textBase, isPositive);
    expect(manager.isDarkMode, isFalse);
  });

  test('setConfiguration still rebuilds tokens from the config', () {
    final manager = ThemeManager();
    manager.setConfiguration({
      'colors': {
        'light': {
          'accent': '#112233',
          'accentFg': '#FFFFFF',
          'bg': '#FFFFFF',
          'fg': '#111111',
        },
      },
    });
    expect(manager.tokens.accent, isNotNull);
  });
}
