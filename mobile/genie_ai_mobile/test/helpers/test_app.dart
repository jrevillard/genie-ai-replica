import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:genie_ai_mobile/services/fallback_localizations.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
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

/// The locale-aware app shell the screen-level widget tests mount through:
/// the i18n singleton drives the locale (the AnimatedBuilder rebuilds the
/// app on a change), and the app's OWN ThemeData — a widget under a plain
/// MaterialApp resolves text themes the shipped theme does not carry (the
/// trap the mobile Visual Fidelity rule names). ONE copy so a mechanics
/// change (a delegate, the theme resolution) lands once.
///
/// [buildHome] is a BUILDER, not a widget: the shell rebuilds the screen
/// on every locale change, and a widget instance reused across rebuilds
/// is not rebuilt at all.
///
/// This is the shell for tests that pump a whole screen (which must
/// follow the i18n singleton); [testApp] above stays the minimal wrapper
/// for DS-component mounts, which need neither locale nor delegates.
Widget testAppShell(
  Widget Function() buildHome, {
  List<Locale> supportedLocales = const [Locale('en')],
  ThemeData? theme,
}) => AnimatedBuilder(
  animation: I18nService(),
  builder: (context, _) => MaterialApp(
    theme: theme ?? ThemeManager().lightTheme,
    locale: I18nService().currentLocale,
    supportedLocales: supportedLocales,
    localizationsDelegates: const [
      FallbackMaterialLocalizationsDelegate(),
      FallbackWidgetsLocalizationsDelegate(),
      GlobalCupertinoLocalizations.delegate,
    ],
    home: buildHome(),
  ),
);
