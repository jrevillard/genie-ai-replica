import 'package:flutter/material.dart';

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

  /// Changes the language and notifies listeners to rebuild the app
  void changeLanguage(String languageCode) {
    debugPrint("[I18N SERVICE] changeLanguage called with: $languageCode");

    if (!supportedLanguages.containsKey(languageCode)) {
      debugPrint("[I18N SERVICE] ERROR: Language $languageCode not supported.");
      return;
    }

    if (_currentLocale.languageCode == languageCode) {
      debugPrint(
        "[I18N SERVICE] Language is already $languageCode. No change.",
      );
      return;
    }

    _currentLocale = Locale(languageCode);
    debugPrint(
      "[I18N SERVICE] Locale updated to $_currentLocale. Notifying listeners...",
    );
    notifyListeners();
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
