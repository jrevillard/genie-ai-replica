import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

class ThemeManager extends ChangeNotifier {
  static final ThemeManager _instance = ThemeManager._internal();
  factory ThemeManager() => _instance;
  ThemeManager._internal();

  String currentTheme = 'light';
  String userPreference = 'light';
  bool isDarkMode = false;
  
  // Restored: Font size state
  double fontSize = 14.0; 

  ThemeMode get themeMode {
    if (userPreference == 'dark') return ThemeMode.dark;
    if (userPreference == 'light') return ThemeMode.light;
    return ThemeMode.system;
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

  // ===========================================================================
  // STATIC THEME DATA GENERATORS (Used by main.dart)
  // ===========================================================================

  static ThemeData getLightTheme() {
    return ThemeData(
      brightness: Brightness.light,
      primaryColor: const Color(0xFF4E97D1),
      scaffoldBackgroundColor: const Color(0xFFF5F7FA),
      cardColor: Colors.white,
      dividerColor: Colors.grey[300],
      colorScheme: const ColorScheme.light(
        primary: Color(0xFF4E97D1),
        secondary: Color(0xFF26A69A),
        surface: Colors.white,
        onPrimary: Colors.white,
        onSurface: Color(0xFF333333),
        primaryContainer: Color(0xFFE3F2FD), 
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: Color(0xFF4E97D1),
        foregroundColor: Colors.white,
        elevation: 0,
      ),
      textTheme: const TextTheme(
        bodyLarge: TextStyle(color: Color(0xFF333333)),
        bodyMedium: TextStyle(color: Color(0xFF333333)),
      ),
      useMaterial3: true,
    );
  }

  static ThemeData getDarkTheme() {
    return ThemeData(
      brightness: Brightness.dark,
      primaryColor: const Color(0xFF4E97D1),
      scaffoldBackgroundColor: const Color(0xFF1E1E1E),
      cardColor: const Color(0xFF2A2A2A),
      dividerColor: const Color(0xFF3A3A3A),
      colorScheme: const ColorScheme.dark(
        primary: Color(0xFF4E97D1),
        secondary: Color(0xFF26A69A),
        surface: Color(0xFF2A2A2A),
        onPrimary: Colors.white,
        onSurface: Color(0xFFF0F0F0),
        primaryContainer: Color(0xFF4E97D1), 
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: Color(0xFF2A2A2A),
        foregroundColor: Colors.white,
        elevation: 0,
      ),
      textTheme: const TextTheme(
        bodyLarge: TextStyle(color: Color(0xFFF0F0F0)),
        bodyMedium: TextStyle(color: Color(0xFFF0F0F0)),
      ),
      useMaterial3: true,
    );
  }

  // ===========================================================================
  // INSTANCE HELPERS (Used by components)
  // ===========================================================================

  Map<String, dynamic> getColors() {
    return {
      'primary': const Color(0xFF4E97D1),
      'secondary': const Color(0xFF26A69A),
      'background': isDarkMode ? const Color(0xFF1E1E1E) : const Color(0xFFF5F7FA),
      'surface': isDarkMode ? const Color(0xFF2A2A2A) : Colors.white,
      'text': isDarkMode ? const Color(0xFFF0F0F0) : const Color(0xFF333333),
      'border': isDarkMode ? const Color(0xFF3A3A3A) : const Color(0xFFDCDFE4),
    };
  }

  /// RESTORED: Implementation of getDialogTheme() used by custom dialogs
  Map<String, dynamic> getDialogTheme() {
    return {
      'modal': {
        'titleColor': isDarkMode ? '#ffffff' : '#333333',
        'textColor': isDarkMode ? '#f0f0f0' : '#333333',
        'background': isDarkMode ? '#2a2a2a' : '#ffffff',
        'borderColor': isDarkMode ? '#3a3a3a' : '#dcdfe4',
      },
      'overlay': {
        'background': isDarkMode ? 'rgba(0, 0, 0, 0.7)' : 'rgba(0, 0, 0, 0.5)',
      },
      'buttons': {
        'primary': {
          'background': '#4E97D1',
          'textColor': '#ffffff',
          'hoverBackground': '#3a7da0',
        },
        'secondary': {
          'background': isDarkMode ? '#3a3a3a' : '#cccccc',
          'textColor': isDarkMode ? '#e0e0e0' : '#333333',
        }
      },
      'input': {
        'background': isDarkMode ? '#333333' : '#ffffff',
        'textColor': isDarkMode ? '#f0f0f0' : '#333333',
        'borderColor': isDarkMode ? '#555555' : '#cccccc',
      }
    };
  }
}