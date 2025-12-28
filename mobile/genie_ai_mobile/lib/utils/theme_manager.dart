import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

class ThemeManager extends ChangeNotifier {
  static final ThemeManager _instance = ThemeManager._internal();
  factory ThemeManager() => _instance;
  ThemeManager._internal();

  // ===========================================================================
  // STATE
  // ===========================================================================
  
  /// Stores the loaded genie-ai-config.json
  Map<String, dynamic> _config = {};

  String currentTheme = 'light';
  String userPreference = 'light';
  bool isDarkMode = false;
  
  /// Global Font Size Scaling Factor (Default 50.0 = 1.0x scale)
  double fontSize = 50.0; 

  // ===========================================================================
  // ACTIONS
  // ===========================================================================

  /// Called by main.dart after loading the JSON configuration
  void setConfiguration(Map<String, dynamic> config) {
    _config = config;
    notifyListeners();
  }

  void setTheme(String theme) {
    userPreference = theme;

    if (theme == 'system') {
      final brightness =
          SchedulerBinding.instance.platformDispatcher.platformBrightness;
      isDarkMode = brightness == Brightness.dark;
    } else {
      isDarkMode = theme == 'dark';
    }

    currentTheme = isDarkMode ? 'dark' : 'light';
    notifyListeners();
  }

  void setFontSize(double size) {
    fontSize = size;
    notifyListeners();
  }

  void toggleTheme() => setTheme(currentTheme == 'light' ? 'dark' : 'light');

  ThemeMode get themeMode {
    if (userPreference == 'dark') return ThemeMode.dark;
    if (userPreference == 'light') return ThemeMode.light;
    return ThemeMode.system;
  }

  // ===========================================================================
  // CONFIG GETTERS & DEFAULTS
  // ===========================================================================

  Color get _primaryColor => _parseColor(_config['theme']?['primaryColor'], const Color(0xFF4E97D1));
  Color get _secondaryColor => _parseColor(_config['theme']?['secondaryColor'], const Color(0xFF26A69A));
  Color get _lightBackground => _parseColor(_config['theme']?['backgroundColor'], const Color(0xFFF5F7FA));
  Color get _lightText => _parseColor(_config['theme']?['textColor'], const Color(0xFF333333));
  
  // Navbar Configuration
  Color get _navGradientStart => _parseColor(_config['theme']?['navbar']?['gradientStart'], _primaryColor);
  Color get _navGradientEnd => _parseColor(_config['theme']?['navbar']?['gradientEnd'], _secondaryColor);
  Color get _navTextColor => _parseColor(_config['theme']?['navbar']?['textColor'], Colors.white);

  // Standard Dark Mode Colors (High Contrast Defaults)
  final Color _darkBackground = const Color(0xFF1E1E1E);
  final Color _darkSurface = const Color(0xFF2A2A2A);
  final Color _darkText = const Color(0xFFF0F0F0);
  final Color _darkBorder = const Color(0xFF3A3A3A);

  // ===========================================================================
  // DYNAMIC THEME DATA GENERATORS
  // ===========================================================================

  ThemeData get lightTheme {
    return ThemeData(
      brightness: Brightness.light,
      primaryColor: _primaryColor,
      scaffoldBackgroundColor: _lightBackground,
      cardColor: Colors.white,
      dividerColor: Colors.grey[300],
      colorScheme: ColorScheme.light(
        primary: _primaryColor,
        secondary: _secondaryColor,
        surface: Colors.white,
        onPrimary: Colors.white,
        onSurface: _lightText,
        primaryContainer: _primaryColor.withOpacity(0.1),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: _navGradientStart, // Fallback if gradient not supported in standard AppBar
        foregroundColor: _navTextColor,
        elevation: 0,
      ),
      textTheme: _buildTextTheme(_lightText),
      useMaterial3: true,
    );
  }

  ThemeData get darkTheme {
    return ThemeData(
      brightness: Brightness.dark,
      primaryColor: _primaryColor,
      scaffoldBackgroundColor: _darkBackground,
      cardColor: _darkSurface,
      dividerColor: _darkBorder,
      colorScheme: ColorScheme.dark(
        primary: _primaryColor,
        secondary: _secondaryColor,
        surface: _darkSurface,
        onPrimary: Colors.white,
        onSurface: _darkText,
        primaryContainer: _primaryColor.withOpacity(0.3),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: _darkSurface,
        foregroundColor: Colors.white,
        elevation: 0,
      ),
      textTheme: _buildTextTheme(_darkText),
      useMaterial3: true,
    );
  }

  /// Scales text styles based on the user's font size preference (Base 50.0)
  TextTheme _buildTextTheme(Color color) {
    final double scale = fontSize / 50.0;
    
    return TextTheme(
      bodyLarge: TextStyle(color: color, fontSize: 16.0 * scale),
      bodyMedium: TextStyle(color: color, fontSize: 14.0 * scale),
      titleLarge: TextStyle(color: color, fontSize: 22.0 * scale, fontWeight: FontWeight.bold),
      titleMedium: TextStyle(color: color, fontSize: 16.0 * scale, fontWeight: FontWeight.w600),
      titleSmall: TextStyle(color: color, fontSize: 14.0 * scale, fontWeight: FontWeight.w500),
      labelLarge: TextStyle(color: color, fontSize: 14.0 * scale, fontWeight: FontWeight.w500),
    );
  }

  // ===========================================================================
  // INSTANCE HELPERS (Used by components)
  // ===========================================================================

  Map<String, dynamic> getColors() {
    return {
      'primary': _primaryColor,
      'secondary': _secondaryColor,
      'background': isDarkMode ? _darkBackground : _lightBackground,
      'surface': isDarkMode ? _darkSurface : Colors.white,
      'text': isDarkMode ? _darkText : _lightText,
      'border': isDarkMode ? _darkBorder : const Color(0xFFDCDFE4),
      'navbar': {
         'gradientStart': _navGradientStart,
         'gradientEnd': _navGradientEnd,
         'text': _navTextColor
      }
    };
  }

  /// Implementation of getDialogTheme() used by custom dialogs
  /// Returns hex strings to be compatible with DialogThemeUtils
  Map<String, dynamic> getDialogTheme() {
    final bg = isDarkMode ? _toHex(_darkSurface) : '#ffffff';
    final text = isDarkMode ? _toHex(_darkText) : _toHex(_lightText);
    final border = isDarkMode ? _toHex(_darkBorder) : '#dcdfe4';
    final primary = _toHex(_primaryColor);
    final secondary = _toHex(_secondaryColor);

    return {
      'modal': {
        'titleColor': text,
        'textColor': text,
        'background': bg,
        'borderColor': border,
      },
      'overlay': {
        'background': isDarkMode ? 'rgba(0, 0, 0, 0.7)' : 'rgba(0, 0, 0, 0.5)',
      },
      'buttons': {
        'primary': {
          'background': primary,
          'textColor': '#ffffff',
          'hoverBackground': primary,
        },
        'secondary': {
          'background': isDarkMode ? '#3a3a3a' : '#cccccc',
          'textColor': isDarkMode ? '#e0e0e0' : '#333333',
        }
      },
      'input': {
        'background': isDarkMode ? '#333333' : '#ffffff',
        'textColor': text,
        'borderColor': isDarkMode ? '#555555' : '#cccccc',
      }
    };
  }

  // ===========================================================================
  // UTILITIES
  // ===========================================================================

  /// Safely parses a hex string (e.g., "#FFFFFF") into a Color object
  static Color _parseColor(dynamic value, Color fallback) {
    if (value == null || value is! String) return fallback;
    try {
      final hex = value.replaceAll('#', '');
      if (hex.length == 6) {
        return Color(int.parse('FF$hex', radix: 16));
      } else if (hex.length == 8) {
        return Color(int.parse(hex, radix: 16));
      }
      return fallback;
    } catch (_) {
      return fallback;
    }
  }

  /// Converts a Color to a hex string #RRGGBB (ignores alpha for consistency with JS/CSS logic)
  static String _toHex(Color color) {
    return '#${color.value.toRadixString(16).padLeft(8, '0').substring(2)}';
  }
}