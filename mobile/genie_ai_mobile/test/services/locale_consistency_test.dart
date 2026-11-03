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
import 'package:genie_ai_mobile/services/i18n_service.dart';

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

/// The localized text before the first colon (zh uses the full-width
/// colon) — the LEAD a caption opens with.
String leadOf(String caption) {
  final match = RegExp(r'^.*?[:：]').firstMatch(caption);
  return match?.group(0) ?? caption;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('Locale consistency', () {
    late I18nService i18n;
    late List<String> supportedLanguageCodes;

    setUp(() {
      i18n = I18nService();
      supportedLanguageCodes = i18n.supportedLanguages.keys.toList();
    });

    test('I18nService supportedLanguages matches locale files on disk', () {
      // Find all locale files in lib/i18n/locales/
      final localesDir = Directory('lib/i18n/locales');
      final localeFiles = <String>[];
      for (final entity in localesDir.listSync()) {
        if (entity is File && entity.path.endsWith('.dart')) {
          // Extract locale code from filename: en.dart -> en
          final code = entity.uri.pathSegments.last.replaceAll('.dart', '');
          localeFiles.add(code);
        }
      }
      localeFiles.sort();
      final sortedSupported = supportedLanguageCodes.toList()..sort();

      // The active locale whitelist (per flavor) must be a SUBSET of the locale
      // files on disk: all source locales stay in the repo, a deployment only
      // restricts which are active. The default flavor exposes every shipped
      // file (equality); restricted flavors (e.g. el-salvador en/es) expose fewer.
      expect(
        localeFiles.toSet().containsAll(sortedSupported),
        isTrue,
        reason:
            'I18nService.supportedLanguages ($sortedSupported) contains a code '
            'with no matching locale file on disk ($localeFiles). Every active '
            'locale must have a source file.',
      );
    });

    test('changeLanguage succeeds for every supported locale', () {
      for (final code in supportedLanguageCodes) {
        // Should not throw — verifies locale data is loaded
        expect(
          () => i18n.changeLanguage(code),
          returnsNormally,
          reason: 'changeLanguage("$code") should not throw.',
        );
      }
    });

    test('at least English locale is always supported', () {
      expect(supportedLanguageCodes, contains('en'));
    });

    test('supported languages map has display names for all codes', () {
      for (final entry in i18n.supportedLanguages.entries) {
        expect(
          entry.value,
          isNotEmpty,
          reason:
              'Locale "${entry.key}" has an empty display name in '
              'supportedLanguages map.',
        );
      }
    });

    test(
      'the outage caption does not borrow the configuration-problem lead',
      () {
        // An outage of the knowledge hierarchy is NOT a configuration
        // problem: the send guard's own comment says naming it as one
        // points the operator at the wrong thing. The three CONFIGURATION
        // captions share one lead (the localized text before the first
        // colon; zh uses the full-width colon) — the outage caption must
        // not open with it. Both halves are checked per locale, so a
        // regression names the locale.
        final bad = <String>[];
        for (final entry in shippedLocales.entries) {
          final code = entry.key;
          final chatbot = entry.value['chatbot'] as Map<String, dynamic>?;
          if (chatbot == null) {
            bad.add('$code: no chatbot section');
            continue;
          }
          final configLeads = [
            chatbot['quickHelpLabelGone'],
            chatbot['quickHelpCategoryGone'],
            chatbot['quickHelpTitleMissing'],
          ].map((caption) => leadOf(caption as String)).toList();
          if (configLeads.toSet().length != 1) {
            bad.add(
              '$code: the configuration captions do not share one lead: '
              '${configLeads.join(' | ')}',
            );
            continue;
          }
          final outage = chatbot['quickHelpScopeUnavailable'] as String?;
          if (outage == null) {
            bad.add('$code: no outage caption');
            continue;
          }
          if (outage.startsWith(configLeads.first)) {
            bad.add(
              '$code: the outage caption borrows the configuration-problem lead',
            );
          }
        }
        expect(bad, isEmpty);
      },
    );
  });
}
