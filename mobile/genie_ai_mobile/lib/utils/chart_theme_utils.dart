import 'package:flutter/material.dart';
import 'package:genie_ai_mobile/design_system/tokens/color_utils.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';

class ChartThemeUtils {
  static bool detectDarkModeFromLuminance(Color bgColor) {
    // ignore: deprecated_member_use
    final red = bgColor.red;
    // ignore: deprecated_member_use
    final green = bgColor.green;
    // ignore: deprecated_member_use
    final blue = bgColor.blue;
    double luminance =
        (0.2126 * red +
            0.7152 * green +
            0.0722 * blue) /
        255;
    return luminance < 0.5;
  }

  static LinearGradient barGradient() {
    final tokens = ThemeManager().tokens;
    return LinearGradient(
      colors: [
        tokens.accent,
        ColorUtils.darken(tokens.accent, 0.1),
      ],
      begin: Alignment.topCenter,
      end: Alignment.bottomCenter,
    );
  }

  static Map<String, Color> getChartTheme() {
    final tokens = ThemeManager().tokens;
    return {
      'text': tokens.fg,
      'grid': tokens.muted50,
      'tooltipBg': tokens.scrim,
      'tooltipText': tokens.fg,
    };
  }
}
