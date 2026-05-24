// This file is part of Amina Care.
//
// Amina Care is free software: you can redistribute it and/or modify
// it under the terms of the GNU Lesser General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Amina Care is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Lesser General Public License for more details.
//
// You should have received a copy of the GNU Lesser General Public License
// along with Amina Care. If not, see <https://www.gnu.org/licenses/>.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

// ═══════════════════════════════════════════════════════════════════════════════
// AMINA COLORS — custom theme extension
//
// Tokens that don't map cleanly to M3 ColorScheme roles live here.
// Access in any widget: Theme.of(context).extension<AminaColors>()!
// ═══════════════════════════════════════════════════════════════════════════════

@immutable
class AminaColors extends ThemeExtension<AminaColors> {
  const AminaColors({
    required this.sageGlow,
    required this.cardBorder,
    required this.sageLight,
    required this.scaffoldBg,
    required this.navBarBg,
    required this.inputFill,
    required this.divider,
  });

  /// Sage-tinted glow for box-shadows on accented elements.
  final Color sageGlow;

  /// Subtle border used on cards (not the full `outline` role).
  final Color cardBorder;

  /// Light sage tint — icon backgrounds, pill badges, etc.
  final Color sageLight;

  /// Page/scaffold background (distinct from card surface).
  final Color scaffoldBg;

  /// Bottom navigation bar background.
  final Color navBarBg;

  /// Text-field and input fill color.
  final Color inputFill;

  /// Dividers between list items.
  final Color divider;

  // ── Presets ─────────────────────────────────────────────────────────────────

  static const light = AminaColors(
    sageGlow:   Color(0x1A3D9970), // sage @10%
    cardBorder: Color(0xFFE5E7EB),
    sageLight:  Color(0xFFEDF7F3),
    scaffoldBg: Color(0xFFF8F9FA),
    navBarBg:   Color(0xFFFFFFFF),
    inputFill:  Color(0xFFF3F4F6),
    divider:    Color(0xFFE5E7EB),
  );

  static const dark = AminaColors(
    sageGlow:   Color(0x333D9970), // sage @20%
    cardBorder: Color(0xFF252833),
    sageLight:  Color(0xFF1A3D2A),
    scaffoldBg: Color(0xFF0F1117),
    navBarBg:   Color(0xFF161920),
    inputFill:  Color(0xFF1A1D26),
    divider:    Color(0xFF252833),
  );

  // ── ThemeExtension boilerplate ───────────────────────────────────────────────

  @override
  AminaColors copyWith({
    Color? sageGlow,
    Color? cardBorder,
    Color? sageLight,
    Color? scaffoldBg,
    Color? navBarBg,
    Color? inputFill,
    Color? divider,
  }) =>
      AminaColors(
        sageGlow:   sageGlow   ?? this.sageGlow,
        cardBorder: cardBorder ?? this.cardBorder,
        sageLight:  sageLight  ?? this.sageLight,
        scaffoldBg: scaffoldBg ?? this.scaffoldBg,
        navBarBg:   navBarBg   ?? this.navBarBg,
        inputFill:  inputFill  ?? this.inputFill,
        divider:    divider    ?? this.divider,
      );

  @override
  AminaColors lerp(AminaColors? other, double t) {
    if (other == null) return this;
    return AminaColors(
      sageGlow:   Color.lerp(sageGlow,   other.sageGlow,   t)!,
      cardBorder: Color.lerp(cardBorder, other.cardBorder, t)!,
      sageLight:  Color.lerp(sageLight,  other.sageLight,  t)!,
      scaffoldBg: Color.lerp(scaffoldBg, other.scaffoldBg, t)!,
      navBarBg:   Color.lerp(navBarBg,   other.navBarBg,   t)!,
      inputFill:  Color.lerp(inputFill,  other.inputFill,  t)!,
      divider:    Color.lerp(divider,    other.divider,    t)!,
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AMINA THEME
//
// Two ThemeData objects — one for each mode.
// Both share the Inter font, radius-24 shapes, and the Amina sage brand color.
//
// Golden rule: widgets must NOT hardcode colors.
// Instead they read:  Theme.of(context).colorScheme.*
//                     Theme.of(context).extension<AminaColors>()!.*
// ═══════════════════════════════════════════════════════════════════════════════

abstract final class AminaTheme {
  static const _kSage        = Color(0xFF3D9970); // brand green
  static const _kSageDark    = Color(0xFF4EC48A); // slightly brighter for dark bg
  static const _kCurvature   = 24.0;

  // ── Light ──────────────────────────────────────────────────────────────────

  static ThemeData get light {
    const cs = ColorScheme(
      brightness:            Brightness.light,
      // Primary — Amina sage
      primary:               _kSage,
      onPrimary:             Colors.white,
      primaryContainer:      Color(0xFFEDF7F3),
      onPrimaryContainer:    Color(0xFF1A4A35),
      // Secondary — same sage family
      secondary:             _kSage,
      onSecondary:           Colors.white,
      secondaryContainer:    Color(0xFFEDF7F3),
      onSecondaryContainer:  Color(0xFF1A4A35),
      // Tertiary — subtle blue accent
      tertiary:              Color(0xFF3B82F6),
      onTertiary:            Colors.white,
      tertiaryContainer:     Color(0xFFEFF6FF),
      onTertiaryContainer:   Color(0xFF1E40AF),
      // Surface / card
      surface:               Color(0xFFFFFFFF),
      onSurface:             Color(0xFF1A1A1A),
      surfaceContainerHighest: Color(0xFFF8F9FA),
      surfaceContainerLow:   Color(0xFFF3F4F6),
      // Outline / border
      outline:               Color(0xFFE5E7EB),
      outlineVariant:        Color(0xFFF3F4F6),
      // Muted text / icons
      onSurfaceVariant:      Color(0xFF6B7280),
      // Error
      error:                 Color(0xFFEF4444),
      onError:               Colors.white,
      errorContainer:        Color(0xFFFEF2F2),
      onErrorContainer:      Color(0xFF991B1B),
      // Inverse (used by SnackBar)
      inverseSurface:        Color(0xFF1F222A),
      onInverseSurface:      Color(0xFFF5F5F5),
      inversePrimary:        Color(0xFF86EFAC),
      // Misc
      shadow:                Color(0xFF000000),
      scrim:                 Color(0xFF000000),
    );

    return _build(cs, AminaColors.light, Brightness.light);
  }

  // ── Dark ───────────────────────────────────────────────────────────────────

  static ThemeData get dark {
    const cs = ColorScheme(
      brightness:            Brightness.dark,
      // Primary — brighter sage so it pops on charcoal
      primary:               _kSageDark,
      onPrimary:             Color(0xFF0F1117),
      primaryContainer:      Color(0xFF1A3D2A),
      onPrimaryContainer:    Color(0xFF86EFAC),
      // Secondary
      secondary:             _kSageDark,
      onSecondary:           Color(0xFF0F1117),
      secondaryContainer:    Color(0xFF1A3D2A),
      onSecondaryContainer:  Color(0xFF86EFAC),
      // Tertiary
      tertiary:              Color(0xFF60A5FA),
      onTertiary:            Color(0xFF0F1117),
      tertiaryContainer:     Color(0xFF1E3A5F),
      onTertiaryContainer:   Color(0xFFBFDBFE),
      // Surface / card — charcoal premium
      surface:               Color(0xFF1F222A),  // card
      onSurface:             Color(0xFFF5F5F5),  // near-white
      surfaceContainerHighest: Color(0xFF0F1117), // scaffold
      surfaceContainerLow:   Color(0xFF1A1D26),
      // Outline / border — very subtle on dark
      outline:               Color(0xFF252833),
      outlineVariant:        Color(0xFF1A1D26),
      // Muted text / icons
      onSurfaceVariant:      Color(0xFF9CA3AF),
      // Error
      error:                 Color(0xFFEF4444),
      onError:               Color(0xFF0F1117),
      errorContainer:        Color(0xFF450A0A),
      onErrorContainer:      Color(0xFFFECACA),
      // Inverse
      inverseSurface:        Color(0xFFF5F5F5),
      onInverseSurface:      Color(0xFF1F222A),
      inversePrimary:        _kSage,
      // Misc
      shadow:                Color(0xFF000000),
      scrim:                 Color(0xFF000000),
    );

    return _build(cs, AminaColors.dark, Brightness.dark);
  }

  // ── Shared builder ─────────────────────────────────────────────────────────

  static ThemeData _build(
    ColorScheme cs,
    AminaColors ext,
    Brightness brightness,
  ) {
    final isDark = brightness == Brightness.dark;

    return ThemeData(
      useMaterial3:           true,
      fontFamily:             'Inter',
      colorScheme:            cs,
      scaffoldBackgroundColor: ext.scaffoldBg,
      extensions:             [ext],

      // ── System UI overlay ────────────────────────────────────────────────
      appBarTheme: AppBarTheme(
        backgroundColor:        cs.surface,
        foregroundColor:        cs.onSurface,
        elevation:              0,
        scrolledUnderElevation: 0,
        surfaceTintColor:       Colors.transparent,
        centerTitle:            true,
        titleTextStyle: TextStyle(
          color:         cs.onSurface,
          fontFamily:    'Inter',
          fontSize:      17,
          fontWeight:    FontWeight.w700,
          letterSpacing: -0.3,
        ),
        iconTheme: IconThemeData(color: cs.onSurface),
        actionsIconTheme: IconThemeData(color: cs.onSurface),
        systemOverlayStyle: isDark
            ? SystemUiOverlayStyle.light.copyWith(
                statusBarColor:               Colors.transparent,
                systemNavigationBarColor:     ext.navBarBg,
                systemNavigationBarIconBrightness: Brightness.light,
              )
            : SystemUiOverlayStyle.dark.copyWith(
                statusBarColor:               Colors.transparent,
                systemNavigationBarColor:     ext.navBarBg,
                systemNavigationBarIconBrightness: Brightness.dark,
              ),
      ),

      // ── Cards ─────────────────────────────────────────────────────────────
      cardTheme: CardThemeData(
        color:           cs.surface,
        elevation:       0,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(_kCurvature),
          side:         BorderSide(color: ext.cardBorder),
        ),
        margin: EdgeInsets.zero,
      ),

      // ── Bottom navigation ─────────────────────────────────────────────────
      bottomNavigationBarTheme: BottomNavigationBarThemeData(
        backgroundColor:     ext.navBarBg,
        selectedItemColor:   cs.primary,
        unselectedItemColor: cs.onSurfaceVariant,
        elevation:           0,
        type:                BottomNavigationBarType.fixed,
        selectedLabelStyle: const TextStyle(
          fontFamily:  'Inter',
          fontSize:    11,
          fontWeight:  FontWeight.w700,
        ),
        unselectedLabelStyle: const TextStyle(
          fontFamily: 'Inter',
          fontSize:   11,
        ),
      ),

      // ── Dialog ────────────────────────────────────────────────────────────
      dialogTheme: DialogThemeData(
        backgroundColor:  cs.surface,
        surfaceTintColor: Colors.transparent,
        elevation:        8,
        shadowColor:      cs.shadow.withValues(alpha: 0.20),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(_kCurvature),
        ),
        titleTextStyle: TextStyle(
          color:      cs.onSurface,
          fontSize:   19,
          fontWeight: FontWeight.w800,
          fontFamily: 'Inter',
        ),
        contentTextStyle: TextStyle(
          color:      cs.onSurfaceVariant,
          fontSize:   15,
          height:     1.55,
          fontFamily: 'Inter',
        ),
      ),

      // ── Input / text fields ───────────────────────────────────────────────
      inputDecorationTheme: InputDecorationTheme(
        filled:           true,
        fillColor:        ext.inputFill,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide:   BorderSide.none,
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide:   BorderSide(color: cs.primary, width: 1.5),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide:   BorderSide(color: cs.error, width: 1.5),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide:   BorderSide(color: cs.error, width: 1.5),
        ),
        hintStyle: TextStyle(
          color:      cs.onSurfaceVariant,
          fontFamily: 'Inter',
        ),
        labelStyle: TextStyle(
          color:      cs.onSurfaceVariant,
          fontFamily: 'Inter',
        ),
        contentPadding: const EdgeInsets.symmetric(
            horizontal: 16, vertical: 14),
      ),

      // ── Elevated button ───────────────────────────────────────────────────
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: cs.primary,
          foregroundColor: cs.onPrimary,
          elevation:       0,
          padding: const EdgeInsets.symmetric(
              horizontal: 24, vertical: 14),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
          textStyle: const TextStyle(
            fontSize:   15,
            fontWeight: FontWeight.w700,
            fontFamily: 'Inter',
          ),
        ),
      ),

      // ── Text button ───────────────────────────────────────────────────────
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: cs.primary,
          textStyle: const TextStyle(
            fontSize:   14,
            fontWeight: FontWeight.w600,
            fontFamily: 'Inter',
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ),

      // ── Outlined button ───────────────────────────────────────────────────
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: cs.primary,
          side:            BorderSide(color: cs.primary, width: 1.5),
          padding: const EdgeInsets.symmetric(
              horizontal: 24, vertical: 14),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
          textStyle: const TextStyle(
            fontSize:   15,
            fontWeight: FontWeight.w600,
            fontFamily: 'Inter',
          ),
        ),
      ),

      // ── Switch ────────────────────────────────────────────────────────────
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) return cs.primary;
          return isDark ? const Color(0xFF6B7280) : const Color(0xFFD1D5DB);
        }),
        trackColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return cs.primary.withValues(alpha: 0.30);
          }
          return isDark
              ? const Color(0xFF374151)
              : const Color(0xFFE5E7EB);
        }),
        trackOutlineColor: WidgetStateProperty.all(Colors.transparent),
      ),

      // ── SnackBar ──────────────────────────────────────────────────────────
      snackBarTheme: SnackBarThemeData(
        backgroundColor:  cs.inverseSurface,
        contentTextStyle: TextStyle(
          color:      cs.onInverseSurface,
          fontFamily: 'Inter',
          fontSize:   14,
          fontWeight: FontWeight.w500,
        ),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
        ),
        behavior:  SnackBarBehavior.floating,
        elevation: 4,
      ),

      // ── Divider ───────────────────────────────────────────────────────────
      dividerTheme: DividerThemeData(
        color:     ext.divider,
        thickness: 1,
        space:     1,
      ),

      // ── List tile ─────────────────────────────────────────────────────────
      listTileTheme: ListTileThemeData(
        tileColor:       Colors.transparent,
        contentPadding:  const EdgeInsets.symmetric(
            horizontal: 20, vertical: 4),
        titleTextStyle: TextStyle(
          color:      cs.onSurface,
          fontFamily: 'Inter',
          fontSize:   16,
          fontWeight: FontWeight.w600,
        ),
        subtitleTextStyle: TextStyle(
          color:      cs.onSurfaceVariant,
          fontFamily: 'Inter',
          fontSize:   13,
        ),
        iconColor: cs.onSurfaceVariant,
      ),

      // ── Floating action button ────────────────────────────────────────────
      floatingActionButtonTheme: FloatingActionButtonThemeData(
        backgroundColor: cs.primary,
        foregroundColor: cs.onPrimary,
        elevation:       4,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(18),
        ),
      ),

      // ── Chip ─────────────────────────────────────────────────────────────
      chipTheme: ChipThemeData(
        backgroundColor:  ext.inputFill,
        labelStyle: TextStyle(
          color:      cs.onSurface,
          fontFamily: 'Inter',
          fontSize:   12,
          fontWeight: FontWeight.w600,
        ),
        side:  BorderSide(color: ext.cardBorder),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      ),

      // ── Page transitions — Cupertino slide everywhere ─────────────────────
      pageTransitionsTheme: const PageTransitionsTheme(
        builders: {
          TargetPlatform.android: CupertinoPageTransitionsBuilder(),
          TargetPlatform.iOS:     CupertinoPageTransitionsBuilder(),
        },
      ),

      // ── Typography — readable Inter scale ────────────────────────────────
      textTheme: TextTheme(
        // Heading
        headlineLarge:  TextStyle(fontSize: 32, fontWeight: FontWeight.w800,
            color: cs.onSurface,  fontFamily: 'Inter', letterSpacing: -0.5),
        headlineMedium: TextStyle(fontSize: 26, fontWeight: FontWeight.w700,
            color: cs.onSurface,  fontFamily: 'Inter', letterSpacing: -0.3),
        headlineSmall:  TextStyle(fontSize: 22, fontWeight: FontWeight.w700,
            color: cs.onSurface,  fontFamily: 'Inter', letterSpacing: -0.2),
        // Title
        titleLarge:   TextStyle(fontSize: 20, fontWeight: FontWeight.w700,
            color: cs.onSurface,        fontFamily: 'Inter'),
        titleMedium:  TextStyle(fontSize: 17, fontWeight: FontWeight.w700,
            color: cs.onSurface,        fontFamily: 'Inter', letterSpacing: -0.3),
        titleSmall:   TextStyle(fontSize: 15, fontWeight: FontWeight.w600,
            color: cs.onSurface,        fontFamily: 'Inter'),
        // Body — slightly larger for senior accessibility
        bodyLarge:    TextStyle(fontSize: 17, color: cs.onSurface,
            fontFamily: 'Inter', height: 1.5),
        bodyMedium:   TextStyle(fontSize: 15, color: cs.onSurface,
            fontFamily: 'Inter', height: 1.5),
        bodySmall:    TextStyle(fontSize: 13, color: cs.onSurfaceVariant,
            fontFamily: 'Inter', height: 1.4),
        // Label
        labelLarge:   TextStyle(fontSize: 14, fontWeight: FontWeight.w700,
            color: cs.onSurface,        fontFamily: 'Inter'),
        labelMedium:  TextStyle(fontSize: 12, fontWeight: FontWeight.w600,
            color: cs.onSurfaceVariant, fontFamily: 'Inter'),
        labelSmall:   TextStyle(fontSize: 10, fontWeight: FontWeight.w500,
            color: cs.onSurfaceVariant, fontFamily: 'Inter',
            letterSpacing: 0.5),
      ),
    );
  }
}
