import 'package:flutter/material.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';

/// Wraps a widget with MaterialApp + Scaffold so DS components render correctly.
///
/// ThemeManager must be initialized before calling this (use helpers in
/// theme_helper.dart).
Widget testApp(Widget child) {
  final tm = ThemeManager();
  return MaterialApp(
    theme: tm.lightTheme,
    home: Scaffold(body: child),
  );
}
