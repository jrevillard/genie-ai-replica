import 'package:flutter/material.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';

class ChartThemeUtils {
  /// Replicates the luminance calculation from getThemeColors()
  static bool detectDarkModeFromLuminance(Color bgColor) {
    // formula: 0.2126*R + 0.7152*G + 0.0722*B
    double luminance = (0.2126 * bgColor.red + 0.7152 * bgColor.green + 0.0722 * bgColor.blue) / 255;
    return luminance < 0.5; //
  }

  /// Full implementation of createBarGradient()
  static LinearGradient barGradient() {
    bool isDark = ThemeManager().isDarkMode;
    if (isDark) {
      return const LinearGradient(
        colors: [Color(0xFF4A8BBF), Color(0xFF2D6FA7)], //
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
      );
    } else {
      return const LinearGradient(
        colors: [Color(0xFF62D9A6), Color(0xFF2DA676)], //
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
      );
    }
  }

  /// Replicates getThemeColors() contrast logic
  static Map<String, Color> getChartTheme() {
    bool isDark = ThemeManager().isDarkMode;
    return {
      'text': isDark ? Colors.white : const Color(0xFF333333), //
      'grid': isDark ? Colors.white.withOpacity(0.15) : const Color(0xFFE0E0E0), //
      'tooltipBg': const Color(0xB3000000), // rgba(0,0,0,0.7)
      'tooltipText': Colors.white, //
    };
  }
}