import 'dart:async';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:genie_ai_mobile/config/keycloak_config.dart';
import 'package:genie_ai_mobile/i18n/locales/en.dart';
import 'package:genie_ai_mobile/i18n/locales/ar.dart';
import 'package:genie_ai_mobile/i18n/locales/de.dart';
import 'package:genie_ai_mobile/i18n/locales/es.dart';
import 'package:genie_ai_mobile/i18n/locales/fr.dart';
import 'package:genie_ai_mobile/i18n/locales/id.dart';
import 'package:genie_ai_mobile/i18n/locales/pt.dart';
import 'package:genie_ai_mobile/i18n/locales/ru.dart';
import 'package:genie_ai_mobile/i18n/locales/sw.dart';
import 'package:genie_ai_mobile/i18n/locales/th.dart';
import 'package:genie_ai_mobile/i18n/locales/zh.dart';
import 'package:genie_ai_mobile/i18n/locales/bn.dart';
import 'package:genie_ai_mobile/i18n/locales/man.dart';
import 'package:genie_ai_mobile/i18n/locales/st.dart';

class I18nService extends ChangeNotifier {
  // Singleton Pattern
  static final I18nService _instance = I18nService._internal();

  factory I18nService() {
    return _instance;
  }

  I18nService._internal() {
    debugPrint(
      "[I18N SERVICE] Singleton Initialized. Default Locale: ${_currentLocale.languageCode}",
    );
  }

  // Current Locale State (Default to English)
  Locale _currentLocale = const Locale('en');
  Locale get currentLocale => _currentLocale;

  /// Storage key holding the language the user last selected.
  static const String languagePreferenceKey = 'language_preference';

  // Master set of locale codes → display names for every locale shipped in the
  // build. The subset active for this deployment is selected per-flavor via
  // KeycloakConfig.supportedLocaleCodes (see config/keycloak_config.dart).
  static const Map<String, String> _masterLocaleNames = {
    'ar': 'Arabic',
    'bn': 'Bengali',
    'zh': 'Chinese',
    'en': 'English',
    'fr': 'French',
    'de': 'German',
    'id': 'Indonesian',
    'man': 'Mandinka',
    'pt': 'Portuguese',
    'ru': 'Russian',
    'st': 'Sesotho',
    'es': 'Spanish',
    'sw': 'Kiswahili',
    'th': 'Thai',
  };

  // Locales active for THIS deployment, derived from the active flavor's
  // supportedLocaleCodes. Default flavor = all locales; the el-salvador flavor
  // restricts to ['en', 'es'].
  late final Map<String, String> supportedLanguages = {
    for (final code in getConfig().supportedLocaleCodes)
      if (_masterLocaleNames.containsKey(code)) code: _masterLocaleNames[code]!,
  };

  // Translation Data Store
  final Map<String, Map<String, dynamic>> _localizedValues = {
    'en': enLocale,
    'ar': arLocale,
    'bn': bnLocale,
    'de': deLocale,
    'es': esLocale,
    'fr': frLocale,
    'id': idLocale,
    'pt': ptLocale,
    'ru': ruLocale,
    'sw': swLocale,
    'th': thLocale,
    'zh': zhLocale,
    'man': manLocale,
    'st': stLocale,
  };

  /// Changes the language and notifies listeners to rebuild the app.
  ///
  /// The choice is also stored on the device so it survives a restart;
  /// [restoreLanguage] reads it back at startup.
  void changeLanguage(String languageCode) {
    debugPrint("[I18N SERVICE] changeLanguage called with: $languageCode");

    if (!_isSupported(languageCode)) {
      debugPrint("[I18N SERVICE] ERROR: Language $languageCode not supported.");
      return;
    }

    if (_applyLocale(languageCode)) {
      _hasStoredLanguage = true;
      unawaited(_persistLanguage(languageCode));
    }
  }

  /// Applies the language recorded on the account, when the device has not
  /// made a choice of its own yet.
  ///
  /// Unlike [changeLanguage], the applied language is not stored on the
  /// device and does not claim one: the account copy keeps updating the
  /// device until the user picks a language here.
  void applyAccountLanguage(String languageCode) {
    if (_hasStoredLanguage) return;

    debugPrint(
      "[I18N SERVICE] applyAccountLanguage called with: $languageCode",
    );
    if (!_isSupported(languageCode)) {
      debugPrint("[I18N SERVICE] ERROR: Language $languageCode not supported.");
      return;
    }

    _applyLocale(languageCode);
  }

  /// Whether this deployment serves the language (its flavor restricts the
  /// active locales).
  bool _isSupported(String languageCode) =>
      supportedLanguages.containsKey(languageCode);

  /// Applies the locale and notifies listeners. Returns false when the
  /// language is already active (no notification is sent then).
  bool _applyLocale(String languageCode) {
    if (_currentLocale.languageCode == languageCode) {
      debugPrint(
        "[I18N SERVICE] Language is already $languageCode. No change.",
      );
      return false;
    }
    _currentLocale = Locale(languageCode);
    debugPrint(
      "[I18N SERVICE] Locale updated to $_currentLocale. Notifying listeners...",
    );
    notifyListeners();
    return true;
  }

  /// Whether this device holds a language choice of its own. The account
  /// copy of the language only seeds a device that never made a choice (a
  /// fresh install, or a new phone); a language the device stored wins,
  /// exactly like the theme and the font scale.
  bool _hasStoredLanguage = false;

  /// Reads the language the user last selected on this device and applies it.
  ///
  /// Called once at startup, before the first frame, so the app opens in the
  /// language the user picked instead of falling back to English. A stored
  /// language this deployment does not serve (its flavor restricts the
  /// active locales) is ignored.
  Future<bool> restoreLanguage() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final stored = prefs.getString(languagePreferenceKey);
      if (stored == null || !_isSupported(stored)) {
        _hasStoredLanguage = false;
        debugPrint(
          "[I18N SERVICE] No stored language to restore (stored: $stored).",
        );
        return false;
      }
      _hasStoredLanguage = true;
      _applyLocale(stored);
      debugPrint("[I18N SERVICE] Restored stored language: $stored");
      return true;
    } catch (error) {
      debugPrint("[I18N SERVICE] Could not read the stored language: $error");
      return false;
    }
  }

  /// Stores the language the user selected on the device.
  Future<void> _persistLanguage(String languageCode) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(languagePreferenceKey, languageCode);
      debugPrint("[I18N SERVICE] Stored language: $languageCode");
    } catch (error) {
      debugPrint("[I18N SERVICE] Could not store the language: $error");
    }
  }

  /// Main translation method
  String translate(String key, {Map<String, dynamic>? args}) {
    // 1. Get the map for the current locale
    Map<String, dynamic>? langMap =
        _localizedValues[_currentLocale.languageCode];

    // 2. Fallback to English if not found
    langMap ??= _localizedValues['en'];
    // Only log this once per session ideally, but okay for debug now
    // debugPrint("[I18N SERVICE] Missing map for ${_currentLocale.languageCode}, falling back to EN");

    // 3. Navigate the nested keys
    dynamic value = _getValueFromMap(key, langMap ?? {});

    // 4. Fallback: If key not found in current lang, try English
    if (value == null && _currentLocale.languageCode != 'en') {
      value = _getValueFromMap(key, _localizedValues['en'] ?? {});
    }

    // 5. Final Fallback
    if (value == null) return key;

    String translation = value.toString();

    // 6. Handle Argument Substitution
    if (args != null) {
      args.forEach((key, value) {
        translation = translation.replaceAll('{$key}', value.toString());
      });
    }

    return translation;
  }

  dynamic _getValueFromMap(String key, Map<String, dynamic> map) {
    List<String> keys = key.split('.');
    dynamic current = map;

    for (String k in keys) {
      if (current is Map && current.containsKey(k)) {
        current = current[k];
      } else {
        return null;
      }
    }
    return current;
  }

  bool get isRtl {
    return _currentLocale.languageCode == 'ar' ||
        _currentLocale.languageCode == 'he' ||
        _currentLocale.languageCode == 'fa';
  }
}

String tr(String key, {Map<String, dynamic>? args}) {
  return I18nService().translate(key, args: args);
}
