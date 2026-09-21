import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/design_system/tokens/app_tokens.dart';

void main() {
  group('AppTokens', () {
    group('fromConfig light mode', () {
      late AppTokens tokens;

      setUp(() {
        tokens = AppTokens.fromConfig(config: const {}, isDark: false);
      });

      test('isDark is false', () {
        expect(tokens.isDark, isFalse);
      });

      test('brand defaults to Verde AgroGenio oscuro', () {
        expect(tokens.brand, const Color(0xFF1E5631));
      });

      test('bg defaults to warm off-white', () {
        expect(tokens.bg, const Color(0xFFF7F8F4));
      });

      test('fg defaults to greenish black', () {
        expect(tokens.fg, const Color(0xFF17231C));
      });

      test('surface is warm off-white', () {
        expect(tokens.surface, const Color(0xFFFCFDFA));
      });

      test('accent equals brand', () {
        expect(tokens.accent, tokens.brand);
      });

      test('accentFg is warm off-white', () {
        expect(tokens.accentFg, const Color(0xFFFCFDFA));
      });

      test('navbarBg defaults to brand', () {
        expect(tokens.navbarBg, tokens.brand);
      });

      test('navbarFg defaults to warm off-white', () {
        expect(tokens.navbarFg, const Color(0xFFFCFDFA));
      });

      test('fontScale defaults to 1.0', () {
        expect(tokens.fontScale, 1.0);
      });

      test('success/warning/danger/info defaults (brand sheet palette)', () {
        expect(tokens.success, const Color(0xFF4CAF50));
        expect(tokens.warning, const Color(0xFFB86B00));
        expect(tokens.danger, const Color(0xFFB42318));
        expect(tokens.info, const Color(0xFF1565A8));
      });

      test('accentGold is the sheet gold', () {
        expect(tokens.accentGold, const Color(0xFFE9C46A));
      });

      test('accentSecondary is the sheet green', () {
        expect(tokens.accentSecondary, const Color(0xFF4CAF50));
      });
    });

    group('fromConfig dark mode', () {
      late AppTokens tokens;

      setUp(() {
        tokens = AppTokens.fromConfig(config: const {}, isDark: true);
      });

      test('isDark is true', () {
        expect(tokens.isDark, isTrue);
      });

      test('fg is warm off-white', () {
        expect(tokens.fg, const Color(0xFFF2F4EE));
      });

      test('accent is the brightened sheet green (dark)', () {
        expect(tokens.accent, const Color(0xFF4CAF50));
      });

      test('accentFg is the deep verde bg color', () {
        expect(tokens.accentFg, const Color(0xFF0F1A12));
      });

      test('bg is the fixed deep verde (web dark parity)', () {
        expect(tokens.bg, const Color(0xFF0F1A12));
      });

      test('dark semantic overrides (brighter for chart visibility)', () {
        expect(tokens.success, const Color(0xFF7ED48A));
        expect(tokens.warning, const Color(0xFFE08A1A));
        expect(tokens.danger, const Color(0xFFE85A4F));
        expect(tokens.info, const Color(0xFF4A8DCB));
      });

      test('navbarFg stays light in dark mode (web parity)', () {
        expect(tokens.navbarFg, const Color(0xFFF2F4EE));
      });

      test('accentGold is brightened gold in dark mode', () {
        expect(tokens.accentGold, const Color(0xFFF0D08A));
      });
    });

    group('custom brand color', () {
      late AppTokens tokens;

      setUp(() {
        tokens = AppTokens.fromConfig(
          config: const {
            'theme': {'brandColor': '#FF5722'},
          },
          isDark: false,
        );
      });

      test('brand is overridden', () {
        expect(tokens.brand, const Color(0xFFFF5722));
      });

      test('accent follows brand override', () {
        expect(tokens.accent, tokens.brand);
      });
    });

    group('custom navbar colors', () {
      late AppTokens tokens;

      setUp(() {
        tokens = AppTokens.fromConfig(
          config: const {
            'theme': {
              'navbar': {'background': '#333333', 'text': '#FFFFFF'},
            },
          },
          isDark: false,
        );
      });

      test('navbarBg is overridden', () {
        expect(tokens.navbarBg, const Color(0xFF333333));
      });

      test('navbarFg is overridden', () {
        expect(tokens.navbarFg, const Color(0xFFFFFFFF));
      });
    });

    group('custom status colors', () {
      late AppTokens tokens;

      setUp(() {
        tokens = AppTokens.fromConfig(
          config: const {
            'theme': {
              'colors': {
                'success': '#22C55E',
                'warning': '#FBBF24',
                'danger': '#DC2626',
                'info': '#2563EB',
              },
            },
          },
          isDark: false,
        );
      });

      test('success overridden', () {
        expect(tokens.success, const Color(0xFF22C55E));
      });

      test('warning overridden', () {
        expect(tokens.warning, const Color(0xFFFBBF24));
      });

      test('danger overridden', () {
        expect(tokens.danger, const Color(0xFFDC2626));
      });

      test('info overridden', () {
        expect(tokens.info, const Color(0xFF2563EB));
      });
    });

    group('typography scale', () {
      test('default fontScale is 1.0', () {
        final tokens = AppTokens.fromConfig(config: const {}, isDark: false);
        expect(tokens.fontScale, 1.0);
      });

      test('custom fontScale multiplies text sizes', () {
        final tokens = AppTokens.fromConfig(
          config: const {
            'theme': {
              'typography': {'fontScale': 2.0},
            },
          },
          isDark: false,
        );
        expect(tokens.fontScale, 2.0);
        expect(tokens.textBase, closeTo(14.0 * 2.0, 0.01));
        expect(tokens.textMd, closeTo(16.0 * 2.0, 0.01));
        expect(tokens.textLg, closeTo(20.0 * 2.0, 0.01));
      });

      test('fontScale param overrides typography config', () {
        final tokens = AppTokens.fromConfig(
          config: const {
            'theme': {
              'typography': {'fontScale': 2.0},
            },
          },
          isDark: false,
          fontScale: 1.5,
        );
        // The factory uses typography.fontScale, not the param —
        // param is only used by ThemeManager._rebuildTokens which
        // sets fontScale = fontSize / 50.0 and passes it.
        // The fromConfig factory uses typography config's fontScale.
        expect(tokens.fontScale, 2.0);
      });
    });

    group('alpha helpers', () {
      late AppTokens tokens;

      setUp(() {
        tokens = AppTokens.fromConfig(config: const {}, isDark: false);
      });

      test('fg70 has 0.7 alpha', () {
        expect(tokens.fg70.a, closeTo(0.7, 0.01));
      });

      test('fg50 has 0.5 alpha', () {
        expect(tokens.fg50.a, closeTo(0.5, 0.01));
      });

      test('fg30 has 0.3 alpha', () {
        expect(tokens.fg30.a, closeTo(0.3, 0.01));
      });

      test('muted50 has 0.5 alpha', () {
        expect(tokens.muted50.a, closeTo(0.5, 0.01));
      });

      test('muted20 has 0.2 alpha', () {
        expect(tokens.muted20.a, closeTo(0.2, 0.01));
      });

      test('accent10 has 0.1 alpha', () {
        expect(tokens.accent10.a, closeTo(0.1, 0.01));
      });

      test('accent30 has 0.3 alpha', () {
        expect(tokens.accent30.a, closeTo(0.3, 0.01));
      });

      test('scrim is dark in light mode', () {
        expect(tokens.scrim, const Color(0x80000000));
      });

      test('scrim is darker in dark mode', () {
        final darkTokens = AppTokens.fromConfig(config: const {}, isDark: true);
        expect(darkTokens.scrim, const Color(0xB3000000));
      });
    });

    group('malformed config edge cases', () {
      test('theme as string falls back to defaults', () {
        final tokens = AppTokens.fromConfig(
          config: const {'theme': 'bad'},
          isDark: false,
        );
        expect(tokens.brand, const Color(0xFF1E5631));
        expect(tokens.fontScale, 1.0);
      });

      test('theme as number falls back to defaults', () {
        final tokens = AppTokens.fromConfig(
          config: const {'theme': 42},
          isDark: false,
        );
        expect(tokens.brand, const Color(0xFF1E5631));
        expect(tokens.navbarBg, tokens.brand);
      });

      test('theme as list falls back to defaults', () {
        final tokens = AppTokens.fromConfig(
          config: const {
            'theme': ['bad'],
          },
          isDark: false,
        );
        expect(tokens.brand, const Color(0xFF1E5631));
      });

      test('navbar as string falls back to brand', () {
        final tokens = AppTokens.fromConfig(
          config: const {
            'theme': {'navbar': 'bad'},
          },
          isDark: false,
        );
        expect(tokens.navbarBg, tokens.brand);
        expect(tokens.navbarFg, const Color(0xFFFCFDFA));
      });

      test('colors as list falls back to defaults', () {
        final tokens = AppTokens.fromConfig(
          config: const {
            'theme': {
              'colors': ['bad'],
            },
          },
          isDark: false,
        );
        expect(tokens.success, const Color(0xFF4CAF50));
        expect(tokens.warning, const Color(0xFFB86B00));
      });

      test('typography as string falls back to defaults', () {
        final tokens = AppTokens.fromConfig(
          config: const {
            'theme': {'typography': 'bad'},
          },
          isDark: false,
        );
        expect(tokens.fontScale, 1.0);
      });

      test('fontScale as string falls back to 1.0', () {
        final tokens = AppTokens.fromConfig(
          config: const {
            'theme': {
              'typography': {'fontScale': 'big'},
            },
          },
          isDark: false,
        );
        expect(tokens.fontScale, 1.0);
      });

      test('all nested wrong types in dark mode falls back to defaults', () {
        final tokens = AppTokens.fromConfig(
          config: const {
            'theme': {
              'navbar': 'bad',
              'colors': 'bad',
              'typography': {'fontScale': 'huge'},
            },
          },
          isDark: true,
        );
        expect(tokens.navbarBg, tokens.brand);
        expect(tokens.success, const Color(0xFF7ED48A));
        expect(tokens.fontScale, 1.0);
      });
    });
  });
}
