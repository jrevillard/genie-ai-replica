import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/components/settings/settings_component.dart';
import 'package:genie_ai_mobile/providers/api_providers.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../helpers/mock_current_user_api.dart';
import '../helpers/pump_frames.dart';
import '../helpers/test_app.dart';
import '../helpers/theme_helper.dart';

/// The account copy of the language seeds a device that never made a choice
/// of its own; a language the device stored wins over it, exactly like the
/// theme and the font scale. The device is the source of truth because the
/// account copy is only written when the device is online — a language
/// picked offline would otherwise be reverted by the next profile fetch.
/// The seed is not a device choice either: it is not stored, so the account
/// copy keeps updating the device until the user picks a language here.
void main() {
  tearDown(() async {
    resetThemeManager();
    I18nService().changeLanguage('en');
    // The write is asynchronous: let it land before the storage is cleared,
    // or it would seed the next test (see i18n_language_persistence_test).
    await Future<void>.delayed(const Duration(milliseconds: 20));
    SharedPreferences.setMockInitialValues({});
  });

  Future<void> pumpSettings(WidgetTester tester, MockCurrentUserApi api) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [currentUserApiProvider.overrideWithValue(api)],
        child: testApp(
          SettingsComponent(
            user: {'name': 'Test User', 'email': 'test@example.test'},
          ),
        ),
      ),
    );
    await pumpFrames(tester);
    await tester.pumpWidget(const SizedBox.shrink());
    await pumpFrames(tester);
  }

  testWidgets('the account copy seeds a device that made no choice', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    await I18nService().restoreLanguage();
    setupLightTokens();

    await pumpSettings(
      tester,
      MockCurrentUserApi(userFields: {'language': 'fr'}),
    );

    expect(I18nService().currentLocale.languageCode, 'fr');
  });

  testWidgets('the seed is not stored and does not claim the device', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    await I18nService().restoreLanguage();
    setupLightTokens();

    await pumpSettings(
      tester,
      MockCurrentUserApi(userFields: {'language': 'fr'}),
    );

    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString(I18nService.languagePreferenceKey), isNull);
    expect(I18nService().hasStoredLanguage, isFalse);
  });

  testWidgets('the account copy keeps updating a device that never chose', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    await I18nService().restoreLanguage();
    setupLightTokens();

    await pumpSettings(
      tester,
      MockCurrentUserApi(userFields: {'language': 'fr'}),
    );
    expect(I18nService().currentLocale.languageCode, 'fr');

    await pumpSettings(
      tester,
      MockCurrentUserApi(userFields: {'language': 'de'}),
    );
    expect(I18nService().currentLocale.languageCode, 'de');
  });

  testWidgets('a language the device stored wins over the account copy', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({
      I18nService.languagePreferenceKey: 'es',
    });
    await I18nService().restoreLanguage();
    setupLightTokens();

    await pumpSettings(
      tester,
      MockCurrentUserApi(userFields: {'language': 'en'}),
    );

    expect(I18nService().currentLocale.languageCode, 'es');
  });
}
