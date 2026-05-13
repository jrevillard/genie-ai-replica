import 'package:flutter/material.dart';

import 'color_utils.dart';

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
    final theme = config['theme'] ?? {};
    final brandColor = ColorUtils.parseHexNullable(theme['brandColor']) ??
        const Color(0xFF4682B4);

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
    final bg = ColorUtils.parseHexNullable(theme['bg']) ??
        const Color(0xFFF8F9FA);
    final fg = ColorUtils.parseHexNullable(theme['fg']) ??
        const Color(0xFF1A1A2E);

    final navbar = theme['navbar'] as Map<String, dynamic>? ?? {};
    final navbarBg = ColorUtils.parseHexNullable(navbar['background']) ?? brandColor;
    // Web: --navbar-fg is light text contrasted from brand (l+0.56, low chroma)
    final navbarFg = ColorUtils.parseHexNullable(navbar['text']) ?? Colors.white;

    final colors = theme['colors'] as Map<String, dynamic>? ?? {};
    final success =
        ColorUtils.parseHexNullable(colors['success']) ?? const Color(0xFF10B981);
    final warning =
        ColorUtils.parseHexNullable(colors['warning']) ?? const Color(0xFFF59E0B);
    final danger =
        ColorUtils.parseHexNullable(colors['danger']) ?? const Color(0xFFEF4444);
    final info =
        ColorUtils.parseHexNullable(colors['info']) ?? const Color(0xFF3B82F6);

    final typography = theme['typography'] as Map<String, dynamic>? ?? {};
    final scale = (typography['fontScale'] as num?)?.toDouble() ?? 1.0;

    return AppTokens(
      brand: brandColor,
      bg: bg,
      fg: fg,
      surface: Colors.white,
      muted: const Color(0xFF6B7280),
      mutedSoft: const Color(0xFF9CA3AF),
      border: const Color(0xFFD1D5DB),
      borderLight: const Color(0xFFE5E7EB),
      accent: brandColor,
      accentHover: ColorUtils.darken(brandColor, 0.04),
      accentMuted: brandColor.withValues(alpha: 0.12),
      accentFg: Colors.white,
      accentSecondary: ColorUtils.darken(brandColor, 0.07),
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
    final navbar = theme['navbar'] as Map<String, dynamic>? ?? {};
    // Web: navbar-bg stays brand in both modes; navbar-fg is dark (l-0.32) in dark
    final navbarBg = ColorUtils.parseHexNullable(navbar['background']) ?? brandColor;
    // Web dark: --navbar-fg: oklch(from brand max(calc(l - 0.32), 0.1) c h)
    // Approximation: use a darkened version of the brand color
    final navbarFg = ColorUtils.parseHexNullable(navbar['text']) ?? ColorUtils.darken(brandColor, 0.25);

    final colors = theme['colors'] as Map<String, dynamic>? ?? {};
    final success =
        ColorUtils.parseHexNullable(colors['success']) ?? const Color(0xFF10B981);
    final warning =
        ColorUtils.parseHexNullable(colors['warning']) ?? const Color(0xFFF59E0B);
    final danger =
        ColorUtils.parseHexNullable(colors['danger']) ?? const Color(0xFFEF4444);
    final info =
        ColorUtils.parseHexNullable(colors['info']) ?? const Color(0xFF3B82F6);

    final typography = theme['typography'] as Map<String, dynamic>? ?? {};
    final scale = (typography['fontScale'] as num?)?.toDouble() ?? 1.0;

    return AppTokens(
      brand: brandColor,
      bg: ColorUtils.brandTinted(brandColor, lightness: 0.14, saturationMultiplier: 0.25),
      fg: const Color(0xFFF0F0F0),
      surface: ColorUtils.brandTinted(brandColor, lightness: 0.22, saturationMultiplier: 0.18),
      muted: ColorUtils.brandTinted(brandColor, lightness: 0.58, saturationMultiplier: 0.15),
      mutedSoft: ColorUtils.brandTinted(brandColor, lightness: 0.45, saturationMultiplier: 0.12),
      border: ColorUtils.brandTinted(brandColor, lightness: 0.30, saturationMultiplier: 0.20),
      borderLight: ColorUtils.brandTinted(brandColor, lightness: 0.24, saturationMultiplier: 0.18),
      accent: ColorUtils.lighten(brandColor, 0.20),
      accentHover: ColorUtils.lighten(brandColor, 0.14),
      accentMuted: brandColor.withValues(alpha: 0.15),
      accentFg: ColorUtils.darken(brandColor, 0.32),
      accentSecondary: ColorUtils.lighten(brandColor, 0.10),
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
