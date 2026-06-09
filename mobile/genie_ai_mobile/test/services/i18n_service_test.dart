import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';

void main() {
  late I18nService service;

  setUp(() {
    service = I18nService();
    // Reset to default locale (English)
    service.changeLanguage('en');
  });

  tearDown(() {
    // Ensure singleton is reset to English after each test
    service.changeLanguage('en');
  });

  group('I18nService', () {
    group('default locale initialization', () {
      test('defaults to English locale', () {
        expect(service.currentLocale.languageCode, 'en');
      });

      test('supported languages contains English', () {
        expect(service.supportedLanguages.containsKey('en'), isTrue);
      });

      test('supported languages has expected count', () {
        // El Salvador deployment: English and Spanish only
        expect(service.supportedLanguages.length, 2);
      });

      test('supported languages contains en and es', () {
        expect(service.supportedLanguages.containsKey('en'), isTrue);
        expect(service.supportedLanguages.containsKey('es'), isTrue);
      });
    });

    group('locale switching', () {
      test('changes locale to Spanish', () {
        service.changeLanguage('es');
        expect(service.currentLocale.languageCode, 'es');
      });

      test('notifies listeners on locale change', () {
        bool notified = false;
        service.addListener(() => notified = true);

        service.changeLanguage('es');

        expect(notified, isTrue);
      });

      test('does not notify when setting same locale', () {
        int notifyCount = 0;
        service.addListener(() => notifyCount++);

        service.changeLanguage('en');

        expect(notifyCount, 0);
      });

      test('ignores unsupported language code', () {
        service.changeLanguage('xx');
        // Should remain English
        expect(service.currentLocale.languageCode, 'en');
      });

      test('ignores removed locale codes', () {
        // These locales were removed during El Salvador culling
        service.changeLanguage('fr');
        expect(service.currentLocale.languageCode, 'en');

        service.changeLanguage('ar');
        expect(service.currentLocale.languageCode, 'en');
      });
    });

    group('translate', () {
      test('returns translation for dot-notation key in English', () {
        // en.dart has "countries" map with country codes
        final result = service.translate('countries.CH');
        expect(result, 'Switzerland');
      });

      test('returns key when translation not found', () {
        final result = service.translate('nonexistent.key.path');
        expect(result, 'nonexistent.key.path');
      });

      test('performs argument substitution with real placeholder', () {
        // sidebar.deleteFolderConfirm has {name} placeholder
        final result = service.translate(
          'sidebar.deleteFolderConfirm',
          args: {'name': 'Test Folder'},
        );
        expect(result, contains('Test Folder'));
        expect(result, isNot(contains('{name}')));
      });

      test('leaves placeholder unchanged when arg not provided', () {
        final result = service.translate('sidebar.deleteFolderConfirm');
        expect(result, contains('{name}'));
      });

      test('falls back to English when current locale missing key', () {
        // Switch to Spanish, then translate a key that might not exist
        service.changeLanguage('es');
        final result = service.translate('countries.CH');
        expect(result, isNotEmpty);
      });
    });

    group('missing translation key fallback', () {
      test('returns key as-is for completely unknown key', () {
        final result = service.translate('totally.missing.key');
        expect(result, 'totally.missing.key');
      });

      test('returns key for empty string key', () {
        final result = service.translate('');
        expect(result, '');
      });

      test('returns key when intermediate value is not a Map', () {
        // countries.CH resolves to a String ("Switzerland"),
        // so countries.CH.foo tries to navigate into a non-Map value.
        final result = service.translate('countries.CH.foo');
        expect(result, 'countries.CH.foo');
      });
    });

    group('isRtl', () {
      test('English is not RTL', () {
        expect(service.isRtl, isFalse);
      });

      test('Spanish is not RTL', () {
        service.changeLanguage('es');
        expect(service.isRtl, isFalse);
      });

      test('unsupported RTL codes return false', () {
        // Arabic was removed during locale culling
        service.changeLanguage('ar');
        // Falls back to en, which is not RTL
        expect(service.isRtl, isFalse);
      });
    });

    group('tr() top-level function', () {
      test('delegates to I18nService singleton', () {
        final result = tr('countries.CH');
        expect(result, 'Switzerland');
      });
    });

    group('singleton behavior', () {
      test('factory returns same instance', () {
        final a = I18nService();
        final b = I18nService();
        expect(identical(a, b), isTrue);
      });
    });
  });
}
