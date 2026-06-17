import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';

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
  });
}
