import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

/// Custom MaterialLocalizations delegate that provides fallback for unsupported locales
/// This allows the app to work with locales that don't have built-in Flutter support
class FallbackMaterialLocalizationsDelegate
    extends LocalizationsDelegate<MaterialLocalizations> {
  const FallbackMaterialLocalizationsDelegate();

  @override
  bool isSupported(Locale locale) {
    // Accept all locales
    return true;
  }

  @override
  Future<MaterialLocalizations> load(Locale locale) async {
    // Try to load the standard localization first
    try {
      return await GlobalMaterialLocalizations.delegate.load(locale);
    } catch (e) {
      // If the locale is not supported, fall back to English
      debugPrint("[FALLBACK] Locale $locale not supported, falling back to en");
      return await GlobalMaterialLocalizations.delegate.load(
        const Locale('en'),
      );
    }
  }

  @override
  bool shouldReload(FallbackMaterialLocalizationsDelegate old) => false;
}

/// Custom WidgetsLocalizations delegate that provides fallback for unsupported locales
class FallbackWidgetsLocalizationsDelegate
    extends LocalizationsDelegate<WidgetsLocalizations> {
  const FallbackWidgetsLocalizationsDelegate();

  @override
  bool isSupported(Locale locale) {
    // Accept all locales
    return true;
  }

  @override
  Future<WidgetsLocalizations> load(Locale locale) async {
    // Try to load the standard localization first
    try {
      return await GlobalWidgetsLocalizations.delegate.load(locale);
    } catch (e) {
      // If the locale is not supported, fall back to English
      debugPrint("[FALLBACK] Locale $locale not supported, falling back to en");
      return await GlobalWidgetsLocalizations.delegate.load(const Locale('en'));
    }
  }

  @override
  bool shouldReload(FallbackWidgetsLocalizationsDelegate old) => false;
}
