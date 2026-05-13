import 'package:flutter/material.dart';

import '../tokens/app_tokens.dart';
import '../tokens/radii.dart';
import '../tokens/spacing.dart';

class AppTheme {
  static ThemeData build(AppTokens tokens) {
    return ThemeData(
      brightness: tokens.isDark ? Brightness.dark : Brightness.light,
      useMaterial3: true,
      scaffoldBackgroundColor: tokens.bg,
      colorScheme: ColorScheme(
        brightness: tokens.isDark ? Brightness.dark : Brightness.light,
        primary: tokens.accent,
        onPrimary: tokens.accentFg,
        primaryContainer: tokens.accentMuted,
        secondary: tokens.accentSecondary,
        onSecondary: Colors.white,
        surface: tokens.surface,
        onSurface: tokens.fg,
        error: tokens.danger,
        onError: Colors.white,
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: tokens.navbarBg,
        foregroundColor: tokens.navbarFg,
        elevation: 0,
        centerTitle: true,
      ),
      cardTheme: CardThemeData(
        color: tokens.surface,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(DsRadii.lg),
          side: BorderSide(color: tokens.borderLight),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: tokens.isDark ? tokens.surface : tokens.bg,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(DsRadii.md),
          borderSide: BorderSide(color: tokens.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(DsRadii.md),
          borderSide: BorderSide(color: tokens.border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(DsRadii.md),
          borderSide: BorderSide(color: tokens.accent, width: 2),
        ),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: DsSpacing.md,
          vertical: DsSpacing.sm,
        ),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: tokens.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(DsRadii.lg),
        ),
      ),
      popupMenuTheme: PopupMenuThemeData(
        color: tokens.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(DsRadii.md),
          side: BorderSide(color: tokens.borderLight),
        ),
        textStyle: TextStyle(color: tokens.fg, fontSize: tokens.textBase),
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: Colors.transparent,
        shape: const RoundedRectangleBorder(),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: tokens.surface,
        contentTextStyle: TextStyle(color: tokens.fg, fontSize: tokens.textBase),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(DsRadii.md),
        ),
        behavior: SnackBarBehavior.floating,
      ),
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) return tokens.accent;
          return tokens.muted;
        }),
        trackColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) return tokens.accentMuted;
          return tokens.border;
        }),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: tokens.accent,
          foregroundColor: tokens.accentFg,
          minimumSize: const Size(double.infinity, 48),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(DsRadii.md),
          ),
          padding: const EdgeInsets.symmetric(
            horizontal: DsSpacing.md,
            vertical: DsSpacing.sm,
          ),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: tokens.accent,
          minimumSize: const Size(double.infinity, 48),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(DsRadii.md),
          ),
        ),
      ),
      dividerColor: tokens.borderLight,
      textTheme: _buildTextTheme(tokens),
    );
  }

  static TextTheme _buildTextTheme(AppTokens tokens) {
    final color = tokens.fg;
    return TextTheme(
      displayLarge: TextStyle(color: color, fontSize: tokens.text2xl, fontWeight: FontWeight.bold),
      displayMedium: TextStyle(color: color, fontSize: tokens.textXl * 1.15, fontWeight: FontWeight.bold),
      headlineLarge: TextStyle(color: color, fontSize: tokens.textXl, fontWeight: FontWeight.w600),
      headlineMedium: TextStyle(color: color, fontSize: tokens.textLg, fontWeight: FontWeight.w600),
      titleLarge: TextStyle(color: color, fontSize: tokens.textMd * 1.1, fontWeight: FontWeight.w600),
      titleMedium: TextStyle(color: color, fontSize: tokens.textMd, fontWeight: FontWeight.w500),
      titleSmall: TextStyle(color: color, fontSize: tokens.textBase, fontWeight: FontWeight.w500),
      bodyLarge: TextStyle(color: color, fontSize: tokens.textMd),
      bodyMedium: TextStyle(color: color, fontSize: tokens.textBase),
      bodySmall: TextStyle(color: color, fontSize: tokens.textSm),
      labelLarge: TextStyle(color: color, fontSize: tokens.textBase, fontWeight: FontWeight.w500),
      labelMedium: TextStyle(color: color, fontSize: tokens.textSm, fontWeight: FontWeight.w500),
      labelSmall: TextStyle(color: color, fontSize: tokens.textXs, fontWeight: FontWeight.w500),
    );
  }
}
