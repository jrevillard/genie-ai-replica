import 'package:flutter/material.dart';
import 'package:pdf/pdf.dart';

class ColorUtils {
  /// Relative-luminance heuristic: true when the color reads as dark and
  /// needs light content on top (used to pick logo variants, etc.).
  static bool isDarkColor(Color c) {
    final l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    return l < 0.5;
  }

  static Color parseHex(String hex) {
    final cleaned = hex.replaceAll('#', '');
    if (cleaned.length == 3) {
      // CSS shorthand #RGB → #RRGGBB
      final expanded = cleaned.split('').map((c) => c * 2).join();
      return Color(int.parse('FF$expanded', radix: 16));
    } else if (cleaned.length == 6) {
      return Color(int.parse('FF$cleaned', radix: 16));
    } else if (cleaned.length == 8) {
      return Color(int.parse(cleaned, radix: 16));
    }
    throw ArgumentError('Invalid hex color: $hex');
  }

  static Color? parseHexNullable(dynamic value) {
    if (value == null || value is! String) return null;
    try {
      return parseHex(value);
    } catch (_) {
      return null;
    }
  }

  static String toHex(Color color) {
    final argb = color.toARGB32();
    return '#${argb.toRadixString(16).padLeft(8, '0').substring(2)}';
  }

  static Color brandTinted(
    Color brand, {
    required double lightness,
    double saturationMultiplier = 0.25,
  }) {
    final hsl = HSLColor.fromColor(brand);
    return hsl
        .withLightness(lightness)
        .withSaturation(hsl.saturation * saturationMultiplier)
        .toColor();
  }

  static Color lighten(Color color, double amount) {
    final hsl = HSLColor.fromColor(color);
    return hsl
        .withLightness((hsl.lightness + amount).clamp(0.0, 1.0))
        .toColor();
  }

  static Color darken(Color color, double amount) {
    final hsl = HSLColor.fromColor(color);
    return hsl
        .withLightness((hsl.lightness - amount).clamp(0.0, 1.0))
        .toColor();
  }

  static Color withAlpha(Color color, double opacity) {
    return color.withValues(alpha: opacity);
  }

  static PdfColor toPdfColor(Color color) {
    return PdfColor(
      // ignore: deprecated_member_use
      color.red / 255,
      // ignore: deprecated_member_use
      color.green / 255,
      // ignore: deprecated_member_use
      color.blue / 255,
    );
  }
}
