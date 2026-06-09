import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/design_system/tokens/color_utils.dart';
import 'package:pdf/pdf.dart';

void main() {
  group('ColorUtils', () {
    group('parseHex', () {
      test('parses 6-digit hex with #', () {
        final color = ColorUtils.parseHex('#FF5722');
        expect(color, const Color(0xFFFF5722));
      });

      test('parses 6-digit hex without #', () {
        final color = ColorUtils.parseHex('FF5722');
        expect(color, const Color(0xFFFF5722));
      });

      test('parses 3-digit shorthand', () {
        final color = ColorUtils.parseHex('#F52');
        // F52 → FF5522
        expect(color, const Color(0xFFFF5522));
      });

      test('parses 8-digit ARGB hex', () {
        final color = ColorUtils.parseHex('#80FF5722');
        expect(color, const Color(0x80FF5722));
      });

      test('throws on invalid input', () {
        expect(() => ColorUtils.parseHex('nope'), throwsArgumentError);
      });

      test('throws on empty string', () {
        expect(() => ColorUtils.parseHex(''), throwsArgumentError);
      });
    });

    group('parseHexNullable', () {
      test('returns null for null input', () {
        expect(ColorUtils.parseHexNullable(null), isNull);
      });

      test('returns null for non-string input', () {
        expect(ColorUtils.parseHexNullable(42), isNull);
      });

      test('returns null for invalid hex string', () {
        expect(ColorUtils.parseHexNullable('xyz'), isNull);
      });

      test('returns Color for valid hex', () {
        expect(ColorUtils.parseHexNullable('#FF5722'), const Color(0xFFFF5722));
      });
    });

    group('toHex', () {
      test('roundtrips with parseHex', () {
        const original = Color(0xFFFF5722);
        final hex = ColorUtils.toHex(original);
        final parsed = ColorUtils.parseHex(hex);
        expect(parsed, original);
      });

      test('produces #RRGGBB format', () {
        final hex = ColorUtils.toHex(const Color(0xFFFF5722));
        expect(hex, startsWith('#'));
        expect(hex.length, 7); // # + 6 chars
      });
    });

    group('lighten', () {
      test('increases lightness', () {
        const base = Color(0xFF000000); // black
        final result = ColorUtils.lighten(base, 0.5);
        final hsl = HSLColor.fromColor(result);
        expect(hsl.lightness, greaterThan(0));
      });

      test('clamps to 1.0', () {
        const base = Color(0xFFFFFFFF);
        final result = ColorUtils.lighten(base, 0.5);
        final hsl = HSLColor.fromColor(result);
        expect(hsl.lightness, closeTo(1.0, 0.01));
      });
    });

    group('darken', () {
      test('decreases lightness', () {
        const base = Color(0xFFFFFFFF);
        final result = ColorUtils.darken(base, 0.5);
        final hsl = HSLColor.fromColor(result);
        expect(hsl.lightness, lessThan(1.0));
      });

      test('clamps to 0.0', () {
        const base = Color(0xFF000000);
        final result = ColorUtils.darken(base, 0.5);
        final hsl = HSLColor.fromColor(result);
        expect(hsl.lightness, closeTo(0.0, 0.01));
      });
    });

    group('brandTinted', () {
      test('applies lightness', () {
        const brand = Color(0xFF4682B4);
        final result = ColorUtils.brandTinted(brand, lightness: 0.5);
        final hsl = HSLColor.fromColor(result);
        expect(hsl.lightness, closeTo(0.5, 0.01));
      });

      test('applies saturation multiplier', () {
        const brand = Color(0xFF4682B4);
        final brandHsl = HSLColor.fromColor(brand);
        final result = ColorUtils.brandTinted(
          brand,
          lightness: 0.5,
          saturationMultiplier: 0.5,
        );
        final hsl = HSLColor.fromColor(result);
        expect(hsl.saturation, closeTo(brandHsl.saturation * 0.5, 0.01));
      });
    });

    group('withAlpha', () {
      test('sets alpha channel', () {
        const base = Color(0xFFFF5722);
        final result = ColorUtils.withAlpha(base, 0.5);
        expect(result.a, closeTo(0.5, 0.01));
      });

      test('full opacity', () {
        const base = Color(0xFFFF5722);
        final result = ColorUtils.withAlpha(base, 1.0);
        expect(result.a, closeTo(1.0, 0.01));
      });

      test('fully transparent', () {
        const base = Color(0xFFFF5722);
        final result = ColorUtils.withAlpha(base, 0.0);
        expect(result.a, closeTo(0.0, 0.01));
      });
    });

    group('toPdfColor', () {
      test('normalizes RGB to 0-1 range', () {
        // White: RGB(255,255,255) → (1.0, 1.0, 1.0)
        const white = Color(0xFFFFFFFF);
        final pdfWhite = ColorUtils.toPdfColor(white);
        expect(pdfWhite, equals(PdfColor(1.0, 1.0, 1.0)));
      });

      test('black normalizes to (0,0,0)', () {
        const black = Color(0xFF000000);
        final pdfBlack = ColorUtils.toPdfColor(black);
        expect(pdfBlack, equals(PdfColor(0.0, 0.0, 0.0)));
      });

      test('mid-gray normalizes correctly', () {
        const gray = Color(0xFF808080);
        final pdfGray = ColorUtils.toPdfColor(gray);
        expect(pdfGray.red, closeTo(128 / 255, 0.01));
        expect(pdfGray.green, closeTo(128 / 255, 0.01));
        expect(pdfGray.blue, closeTo(128 / 255, 0.01));
      });
    });
  });
}
