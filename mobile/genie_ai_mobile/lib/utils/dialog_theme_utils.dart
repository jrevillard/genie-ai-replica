import 'package:flutter/material.dart';

import '../design_system/tokens/app_tokens.dart';
import '../design_system/tokens/radii.dart';
import 'theme_manager.dart';

class DialogThemeUtils {
  static AppTokens get tokens => ThemeManager().tokens;

  static BoxDecoration modalDecoration() {
    return BoxDecoration(
      color: tokens.surface,
      borderRadius: BorderRadius.circular(DsRadii.lg),
      border: Border.all(color: tokens.border),
    );
  }

  static TextStyle inputStyle() {
    return TextStyle(
      color: tokens.fg,
      backgroundColor: tokens.surface,
    );
  }

  static Color overlayColor() => tokens.scrim;
}
