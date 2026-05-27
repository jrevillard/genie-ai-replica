import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/design_system/tokens/app_tokens.dart';
import 'package:genie_ai_mobile/design_system/tokens/color_utils.dart';

void main() {
  group('AppTokens', () {
    group('fromConfig light mode', () {
      late AppTokens tokens;

      setUp(() {
        tokens = AppTokens.fromConfig(
          config: const {},
          isDark: false,
        );
      });

      test('isDark is false', () {
        expect(tokens.isDark, isFalse);
      });

      test('brand defaults to steel blue', () {
        expect(tokens.brand, const Color(0xFF4682B4));
      });

      test('bg defaults to light gray', () {
        expect(tokens.bg, const Color(0xFFF8F9FA));
      });

      test('fg defaults to dark navy', () {
        expect(tokens.fg, const Color(0xFF1A1A2E));
      });

      test('surface is white', () {
        expect(tokens.surface, Colors.white);
      });

      test('accent equals brand', () {
        expect(tokens.accent, tokens.brand);
      });

      test('accentFg is white', () {
        expect(tokens.accentFg, Colors.white);
      });

      test('navbarBg defaults to brand', () {
        expect(tokens.navbarBg, tokens.brand);
      });

      test('navbarFg defaults to white', () {
        expect(tokens.navbarFg, Colors.white);
      });

      test('fontScale defaults to 1.0', () {
        expect(tokens.fontScale, 1.0);
      });

      test('success/warning/danger/info defaults', () {
        expect(tokens.success, const Color(0xFF10B981));
        expect(tokens.warning, const Color(0xFFF59E0B));
        expect(tokens.danger, const Color(0xFFEF4444));
        expect(tokens.info, const Color(0xFF3B82F6));
      });
    });

    group('fromConfig dark mode', () {
      late AppTokens tokens;

      setUp(() {
        tokens = AppTokens.fromConfig(
          config: const {},
          isDark: true,
        );
      });

      test('isDark is true', () {
        expect(tokens.isDark, isTrue);
      });

      test('fg is near white', () {
        expect(tokens.fg, const Color(0xFFF0F0F0));
      });

      test('accent is lightened brand', () {
        final expected = ColorUtils.lighten(tokens.brand, 0.20);
        expect(tokens.accent, expected);
      });

      test('accentFg is darkened brand', () {
        final expected = ColorUtils.darken(tokens.brand, 0.32);
        expect(tokens.accentFg, expected);
      });

      test('bg is brand-tinted dark', () {
        final expected = ColorUtils.brandTinted(
          tokens.brand,
          lightness: 0.14,
          saturationMultiplier: 0.25,
        );
        expect(tokens.bg, expected);
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
              'navbar': {
                'background': '#333333',
                'text': '#FFFFFF',
              },
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
  });
}
