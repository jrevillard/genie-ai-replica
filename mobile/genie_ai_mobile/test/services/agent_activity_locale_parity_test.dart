import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/i18n/locales/ar.dart';
import 'package:genie_ai_mobile/i18n/locales/bn.dart';
import 'package:genie_ai_mobile/i18n/locales/de.dart';
import 'package:genie_ai_mobile/i18n/locales/en.dart';
import 'package:genie_ai_mobile/i18n/locales/es.dart';
import 'package:genie_ai_mobile/i18n/locales/fr.dart';
import 'package:genie_ai_mobile/i18n/locales/id.dart';
import 'package:genie_ai_mobile/i18n/locales/man.dart';
import 'package:genie_ai_mobile/i18n/locales/pt.dart';
import 'package:genie_ai_mobile/i18n/locales/ru.dart';
import 'package:genie_ai_mobile/i18n/locales/st.dart';
import 'package:genie_ai_mobile/i18n/locales/sw.dart';
import 'package:genie_ai_mobile/i18n/locales/th.dart';
import 'package:genie_ai_mobile/i18n/locales/zh.dart';

// The activity line's delivery checklist, executable: mobile locale
// parity has NO CI fallback gate (a missing key degrades to English
// silently, `i18n_service.dart`), so the full key set is asserted here
// for EVERY shipped locale file. A locale added to disk without an
// entry here fails this suite instead of being silently uncovered.

/// Every shipped locale's map, by its code.
const Map<String, Map<String, dynamic>> shippedLocales = {
  'ar': arLocale,
  'bn': bnLocale,
  'de': deLocale,
  'en': enLocale,
  'es': esLocale,
  'fr': frLocale,
  'id': idLocale,
  'man': manLocale,
  'pt': ptLocale,
  'ru': ruLocale,
  'st': stLocale,
  'sw': swLocale,
  'th': thLocale,
  'zh': zhLocale,
};

/// The 11 `chatbot.agentActivity.*` keys the contract names: the four
/// state notes, the translated-grounded caption, and the two operations'
/// three lifecycle labels each.
const List<String> agentActivityKeys = [
  'working',
  'stepCompleted',
  'stepFailed',
  'verificationUnavailable',
  'verificationTranslated',
  'operations.search_knowledge.running',
  'operations.search_knowledge.completed',
  'operations.search_knowledge.failed',
  'operations.read_source.running',
  'operations.read_source.completed',
  'operations.read_source.failed',
];

dynamic _resolve(Map<String, dynamic> map, String dottedKey) {
  dynamic current = map;
  for (final segment in dottedKey.split('.')) {
    if (current is Map && current.containsKey(segment)) {
      current = current[segment];
    } else {
      return null;
    }
  }
  return current;
}

void main() {
  test(
    'all 11 chatbot.agentActivity keys ship in all 14 dart locale files',
    () {
      final localeFiles = Directory('lib/i18n/locales')
          .listSync()
          .whereType<File>()
          .map((file) => file.uri.pathSegments.last.replaceAll('.dart', ''))
          .toList();
      expect(
        shippedLocales.keys.toSet(),
        containsAll(localeFiles),
        reason:
            'A locale file exists on disk with no entry in shippedLocales: '
            'the delivery assertion would not cover it.',
      );

      final bad = <String>[];
      for (final entry in shippedLocales.entries) {
        for (final key in agentActivityKeys) {
          final value = _resolve(entry.value, 'chatbot.agentActivity.$key');
          if (value is! String || value.isEmpty) {
            bad.add('${entry.key}: missing chatbot.agentActivity.$key');
          }
        }
      }
      expect(bad, isEmpty);
    },
  );
}
