import 'package:flutter/material.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';

/// Wraps a widget with MaterialApp + Scaffold so DS components render correctly.
///
/// ThemeManager must be initialized before calling this (use helpers in
/// theme_helper.dart). Pass [routes] when the flow under test navigates by
/// name (e.g. the account-deletion flow pushes '/login' after logout).
Widget testApp(Widget child, {Map<String, WidgetBuilder> routes = const {}}) {
  final tm = ThemeManager();
  return MaterialApp(
    theme: tm.lightTheme,
    home: Scaffold(body: child),
    routes: routes,
  );
}
