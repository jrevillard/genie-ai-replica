import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../helpers/settle_preference_writes.dart';

/// The language the user picks must survive a restart: the app reads the
/// choice back from the device storage at startup, before the first frame.
/// These tests pin that contract at the storage boundary — the same place
/// ThemeManager keeps the theme and the font scale.
void main() {
  late I18nService service;

  setUp(() async {
    service = I18nService();
    service.changeLanguage('en');
    // The write of the previous state is asynchronous: let it land before
    // the storage is cleared, or it would seed the next test.
    await settlePreferenceWrites();
    SharedPreferences.setMockInitialValues({});
    // Reading the storage back also resets the "the device holds a language
    // choice" flag, which a fresh device does not hold.
    await service.restoreLanguage();
  });

  tearDown(() {
    SharedPreferences.setMockInitialValues({});
  });

  test('a language the user selected is stored on the device', () async {
    service.changeLanguage('es');
    await settlePreferenceWrites();

    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString(I18nService.languagePreferenceKey), 'es');
  });

  test('the stored language is restored on the next start', () async {
    SharedPreferences.setMockInitialValues({
      I18nService.languagePreferenceKey: 'es',
    });

    final restored = await service.restoreLanguage();

    expect(restored, isTrue);
    expect(service.currentLocale.languageCode, 'es');
  });

  test(
    'a first start without a stored language keeps the English default',
    () async {
      final restored = await service.restoreLanguage();

      expect(restored, isFalse);
      expect(service.currentLocale.languageCode, 'en');
    },
  );

  test('a stored language this deployment does not serve is ignored', () async {
    SharedPreferences.setMockInitialValues({
      I18nService.languagePreferenceKey: 'xx',
    });

    final restored = await service.restoreLanguage();

    expect(restored, isFalse);
    expect(service.currentLocale.languageCode, 'en');
  });

  test('a device that stored nothing can be seeded again', () async {
    service.changeLanguage('es');
    await settlePreferenceWrites();

    // A storage cleared behind the app's back (app data wiped) leaves the
    // device without a choice: the account copy may seed it again.
    SharedPreferences.setMockInitialValues({});
    await service.restoreLanguage();

    service.applyAccountLanguage('de');
    expect(service.currentLocale.languageCode, 'de');
  });

  test('the account copy applies without claiming the device', () async {
    service.applyAccountLanguage('fr');

    expect(service.currentLocale.languageCode, 'fr');

    await settlePreferenceWrites();
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString(I18nService.languagePreferenceKey), isNull);
  });

  test('the account copy keeps applying until the device makes a choice', () {
    service.applyAccountLanguage('fr');
    service.applyAccountLanguage('de');
    expect(service.currentLocale.languageCode, 'de');

    // A choice made on the device locks it against further account updates.
    service.changeLanguage('es');
    service.applyAccountLanguage('de');
    expect(service.currentLocale.languageCode, 'es');
  });
}
