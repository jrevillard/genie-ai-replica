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
void main() {
  tearDown(() {
    resetThemeManager();
    I18nService().changeLanguage('en');
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('the account copy seeds a device that made no choice', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    await I18nService().restoreLanguage();
    setupLightTokens();

    final api = MockCurrentUserApi(userFields: {'language': 'fr'});
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

    expect(I18nService().currentLocale.languageCode, 'fr');

    await tester.pumpWidget(const SizedBox.shrink());
    await pumpFrames(tester);
  });

  testWidgets('a language the device stored wins over the account copy', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({
      I18nService.languagePreferenceKey: 'es',
    });
    await I18nService().restoreLanguage();
    setupLightTokens();

    final api = MockCurrentUserApi(userFields: {'language': 'en'});
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

    expect(I18nService().currentLocale.languageCode, 'es');

    await tester.pumpWidget(const SizedBox.shrink());
    await pumpFrames(tester);
  });
}
