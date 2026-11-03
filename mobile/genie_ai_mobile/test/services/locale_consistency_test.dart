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

/// Every shipped locale's map, by its code. The set is asserted against
/// the locale files on disk by the test below, so a locale added later
/// FAILS the suite instead of being silently uncovered by the caption
/// guard.
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

/// The localized text BEFORE the first colon (zh uses the full-width
/// colon) — the LEAD a caption opens with, without the colon itself: the
/// lead is the caption's OPENING WORDS, so a caption that reworded the
/// punctuation ("Configuration problem — the hierarchy…") still borrows
/// it and is caught.
String leadOf(String caption) {
  final colon = RegExp('[:：]').firstMatch(caption);
  if (colon == null) return caption;
  return caption.substring(0, colon.start);
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
        //
        // Every locale file on disk is covered: the shipped set is
        // asserted against the directory listing, so a locale added later
        // fails this suite instead of slipping past the guard.
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
              'the caption guard would not cover it.',
        );

        final bad = <String>[];
        for (final entry in shippedLocales.entries) {
          final code = entry.key;
          final chatbot = entry.value['chatbot'] as Map<String, dynamic>?;
          if (chatbot == null) {
            bad.add('$code: no chatbot section');
            continue;
          }
          final configCaptions = [
            chatbot['quickHelpLabelGone'],
            chatbot['quickHelpCategoryGone'],
            chatbot['quickHelpTitleMissing'],
          ];
          if (configCaptions.any((caption) => caption is! String)) {
            bad.add('$code: a configuration caption is missing');
            continue;
          }
          final configLeads = configCaptions
              .map((caption) => leadOf(caption as String))
              .toList();
          if (configLeads.toSet().length != 1) {
            bad.add(
              '$code: the configuration captions do not share one lead: '
              '${configLeads.join(' | ')}',
            );
            continue;
          }
          final outage = chatbot['quickHelpScopeUnavailable'];
          if (outage is! String) {
            bad.add('$code: no outage caption');
            continue;
          }
          if (outage.trim().startsWith(configLeads.first.trim())) {
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
