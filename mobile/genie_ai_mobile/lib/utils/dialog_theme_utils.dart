import 'package:flutter/material.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';

class DialogThemeUtils {
  /// Replicates generateDialogThemeVariables()
  static Map<String, dynamic> get currentThemeData =>
      ThemeManager().getDialogTheme();

  static BoxDecoration modalDecoration() {
    final modal = currentThemeData['modal'];
    return BoxDecoration(
      color: _parseHex(modal['background']), //
      borderRadius: BorderRadius.circular(8),
      border: Border.all(color: _parseHex(modal['borderColor'])), //
    );
  }

  static TextStyle inputStyle() {
    final input = currentThemeData['input'];
    return TextStyle(
      color: _parseHex(input['textColor']), //
      backgroundColor: _parseHex(input['background']), //
    );
  }

  static Color overlayColor() =>
      _parseHex(currentThemeData['overlay']['background']); //

  /// Utility to handle hex strings and rgba from your JS
  static Color _parseHex(String colorStr) {
    if (colorStr.startsWith('rgba')) {
      final values = colorStr.replaceAll(RegExp(r'[^\d,.]'), '').split(',');
      return Color.fromRGBO(
        int.parse(values[0]),
        int.parse(values[1]),
        int.parse(values[2]),
        double.parse(values[3]),
      );
    }
    return Color(int.parse(colorStr.replaceFirst('#', '0xFF')));
  }
}
