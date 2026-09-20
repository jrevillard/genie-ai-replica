import 'package:flutter/material.dart';

import 'color_utils.dart';

/// Safely cast a dynamic value to `Map<String, dynamic>?`.
/// Returns `null` instead of throwing when the value is not a map.
Map<String, dynamic>? _asMap(dynamic value) {
  if (value == null) return null;
  if (value is Map<String, dynamic>) return value;
  return null;
}

/// Safely cast a dynamic value to `num?`.
/// Returns `null` instead of throwing when the value is not numeric.
num? _asNum(dynamic value) {
  if (value == null) return null;
  if (value is num) return value;
  return null;
}

class AppTokens {
  final Color brand;
  final Color bg;
  final Color fg;
  final Color surface;
  final Color muted;
  final Color mutedSoft;
  final Color border;
  final Color borderLight;

  final Color accent;
  final Color accentHover;
  final Color accentMuted;
  final Color accentFg;
  final Color accentSecondary;

  final Color navbarBg;
  final Color navbarFg;

  final Color success;
  final Color warning;
  final Color danger;
  final Color info;

  final double fontScale;
  final bool isDark;

  // Typography scale — mirrors web --text-xs through --text-3xl, scaled by fontScale
  double get textXs => 11.2 * fontScale;
  double get textSm => 12.0 * fontScale;
  double get textBase => 14.0 * fontScale;
  double get textMd => 16.0 * fontScale;
  double get textLg => 20.0 * fontScale;
  double get textXl => 24.0 * fontScale;
  double get text2xl => 32.0 * fontScale;
  double get text3xl => 40.0 * fontScale;

  const AppTokens({
    required this.brand,
    required this.bg,
    required this.fg,
    required this.surface,
    required this.muted,
    required this.mutedSoft,
    required this.border,
    required this.borderLight,
    required this.accent,
    required this.accentHover,
    required this.accentMuted,
    required this.accentFg,
    required this.accentSecondary,
    required this.navbarBg,
    required this.navbarFg,
    required this.success,
    required this.warning,
    required this.danger,
    required this.info,
    required this.fontScale,
    required this.isDark,
  });

  // Alpha helpers — eliminate repeated withValues(alpha:) calls
  Color get fg70 => fg.withValues(alpha: 0.7);
  Color get fg50 => fg.withValues(alpha: 0.5);
  Color get fg30 => fg.withValues(alpha: 0.3);
  Color get muted50 => muted.withValues(alpha: 0.5);
  Color get muted20 => muted.withValues(alpha: 0.2);
  Color get accent10 => accent.withValues(alpha: 0.1);
  Color get accent30 => accent.withValues(alpha: 0.3);
  Color get scrim => isDark ? const Color(0xB3000000) : const Color(0x80000000);

  factory AppTokens.fromConfig({
    required Map<String, dynamic> config,
    required bool isDark,
    double fontScale = 1.0,
  }) {
    final theme = _asMap(config['theme']) ?? <String, dynamic>{};
    // Fallback brand = Verde AgroGenio #176B3A — the same dev fallback the
    // web ships in theme-variables.css (--brand). Unconfigured apps now
    // render identically (the previous steel-blue #4682B4 broke parity).
    final brandColor =
        ColorUtils.parseHexNullable(theme['brandColor']) ??
        const Color(0xFF176B3A);

    if (isDark) {
      return _dark(brandColor: brandColor, theme: theme, fontScale: fontScale);
    }
    return _light(brandColor: brandColor, theme: theme, fontScale: fontScale);
  }

  static AppTokens _light({
    required Color brandColor,
    required Map<String, dynamic> theme,
    required double fontScale,
  }) {
    // Defaults mirror theme-variables.css :root (AgroGenio warm palette):
    // warm off-white bg, greenish-black fg, soft greenish borders.
    final bg =
        ColorUtils.parseHexNullable(theme['bg']) ?? const Color(0xFFF7F8F4);
    final fg =
        ColorUtils.parseHexNullable(theme['fg']) ?? const Color(0xFF17231C);

    final navbar = _asMap(theme['navbar']) ?? {};
    final navbarBg =
        ColorUtils.parseHexNullable(navbar['background']) ?? brandColor;
    final navbarFg =
        ColorUtils.parseHexNullable(navbar['text']) ?? const Color(0xFFFCFDFA);

    final colors = _asMap(theme['colors']) ?? {};
    final success =
        ColorUtils.parseHexNullable(colors['success']) ??
        const Color(0xFF69A83B); // Verde cultivo
    final warning =
        ColorUtils.parseHexNullable(colors['warning']) ??
        const Color(0xFFB86B00); // Ámbar alerta
    final danger =
        ColorUtils.parseHexNullable(colors['danger']) ??
        const Color(0xFFB42318); // Rojo crítico
    final info =
        ColorUtils.parseHexNullable(colors['info']) ??
        const Color(0xFF1565A8); // Azul servicio

    final typography = _asMap(theme['typography']) ?? {};
    final scale = (_asNum(typography['fontScale']))?.toDouble() ?? 1.0;

    return AppTokens(
      brand: brandColor,
      bg: bg,
      fg: fg,
      surface: const Color(0xFFFCFDFA),
      muted: const Color(0xFF5A6B5F),
      mutedSoft: const Color(0xFF8A9690),
      border: const Color(0xFFD6DED8),
      borderLight: const Color(0xFFE4ECE6),
      accent: brandColor,
      // Web hover #0D4B28 (verde profundo) ≈ 25% darker than the brand.
      accentHover: ColorUtils.darken(brandColor, 0.25),
      accentMuted: brandColor.withValues(alpha: 0.12),
      accentFg: const Color(0xFFFCFDFA),
      // Web --accent-secondary is the FIXED verde cultivo #69A83B.
      accentSecondary: const Color(0xFF69A83B),
      navbarBg: navbarBg,
      navbarFg: navbarFg,
      success: success,
      warning: warning,
      danger: danger,
      info: info,
      fontScale: scale,
      isDark: false,
    );
  }

  static AppTokens _dark({
    required Color brandColor,
    required Map<String, dynamic> theme,
    required double fontScale,
  }) {
    // Dark tokens are FIXED values on the web (theme-variables.css
    // [data-theme='dark']) — deep brand-tinted greens with warm off-white
    // text. They deliberately do NOT derive from the brand: --accent stays
    // verde cultivo and --brand keeps the navbar identical across modes.
    final navbar = _asMap(theme['navbar']) ?? {};
    final navbarBg =
        ColorUtils.parseHexNullable(navbar['background']) ?? brandColor;
    // Web dark: --navbar-fg: #f2f4ee — LIGHT text in both modes (the
    // previous darkened-brand text was nearly invisible on the navbar).
    final navbarFg =
        ColorUtils.parseHexNullable(navbar['text']) ?? const Color(0xFFF2F4EE);

    final colors = _asMap(theme['colors']) ?? {};
    final success =
        ColorUtils.parseHexNullable(colors['success']) ??
        const Color(0xFF9BC97B);
    final warning =
        ColorUtils.parseHexNullable(colors['warning']) ??
        const Color(0xFFE08A1A);
    final danger =
        ColorUtils.parseHexNullable(colors['danger']) ??
        const Color(0xFFE85A4F);
    final info =
        ColorUtils.parseHexNullable(colors['info']) ?? const Color(0xFF4A8DCB);

    final typography = _asMap(theme['typography']) ?? {};
    final scale = (_asNum(typography['fontScale']))?.toDouble() ?? 1.0;

    return AppTokens(
      brand: brandColor,
      bg: ColorUtils.parseHexNullable(theme['bg']) ?? const Color(0xFF0F1A12),
      fg: ColorUtils.parseHexNullable(theme['fg']) ?? const Color(0xFFF2F4EE),
      surface: const Color(0xFF16241A),
      muted: const Color(0xFF8FA395),
      mutedSoft: const Color(0xFF6B7D70),
      border: const Color(0xFF2A3B30),
      borderLight: const Color(0xFF1F2D24),
      accent: const Color(0xFF69A83B),
      accentHover: const Color(0xFF7DBC4D),
      accentMuted: const Color(0xFF69A83B).withValues(alpha: 0.15),
      accentFg: const Color(0xFF0F1A12),
      accentSecondary: const Color(0xFF176B3A),
      navbarBg: navbarBg,
      navbarFg: navbarFg,
      success: success,
      warning: warning,
      danger: danger,
      info: info,
      fontScale: scale,
      isDark: true,
    );
  }
}
