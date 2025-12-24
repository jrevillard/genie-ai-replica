import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

class ThemeManager extends ChangeNotifier {
  static final ThemeManager _instance = ThemeManager._internal();
  factory ThemeManager() => _instance;
  ThemeManager._internal();

  String currentTheme = 'light';
  String userPreference = 'light';
  bool isDarkMode = false;

  // FIXED: Added missing state to resolve "ThemeManager().fontSize does not exist"
  double fontSize = 50.0;

  ThemeMode get themeMode {
    if (userPreference == 'dark') return ThemeMode.dark;
    if (userPreference == 'light') return ThemeMode.light;
    return ThemeMode.system;
  }

  /// Logic from detectInitialTheme() and setTheme()
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

  // FIXED: New method to sync the settings font size globally
  void setFontSize(double size) {
    fontSize = size;
    notifyListeners();
  }

  void toggleTheme() => setTheme(currentTheme == 'light' ? 'dark' : 'light');

  /// Full implementation of getThemeInfo()
  Map<String, dynamic> getThemeInfo() {
    return {
      'isDarkMode': isDarkMode,
      'textColor': isDarkMode ? '#FFFFFF' : '#333333',
      'backgroundColor': 'transparent',
      'tooltipBackground':
          isDarkMode ? 'rgba(30, 30, 30, 0.85)' : 'rgba(255, 255, 255, 0.85)',
      'tooltipTextColor': isDarkMode ? '#FFFFFF' : '#333333',
      'borderColor':
          isDarkMode ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.2)',
      'gridColor':
          isDarkMode ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.1)',
      'accentColor': '#4E97D1',
      'chartColors': [
        '#5470c6',
        '#91cc75',
        '#fac858',
        '#ee6666',
        '#73c0de',
        '#3ba272',
        '#fc8452',
        '#9a60b4'
      ],
    };
  }

  /// Full implementation of getDialogTheme()
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
        'borderColor': isDarkMode ? '#3a3a3a' : '#ddd',
        'placeholderColor': isDarkMode ? '#8c8c8c' : '#767676',
      },
      'tabs': {
        'background': isDarkMode ? '#252525' : '#f0f2f5',
        'activeBackground': isDarkMode ? '#2a2a2a' : '#ffffff',
        'textColor': isDarkMode ? '#f0f0f0' : '#333333',
        'activeTextColor': isDarkMode ? '#ffffff' : '#000000',
        'borderColor': isDarkMode ? '#3a3a3a' : '#cccccc',
      }
    };
  }
}
