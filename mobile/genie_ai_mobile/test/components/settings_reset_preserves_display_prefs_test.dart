import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:genie_ai_mobile/components/settings/settings_component.dart';
import 'package:genie_ai_mobile/providers/api_providers.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';

import '../helpers/test_app.dart';
import '../helpers/theme_helper.dart';
import 'settings_reset_files_deletion_test.dart' show MockCurrentUserApi;

/// The reset-data flow must leave the locally stored display preferences
/// (theme, font scale) untouched: the user asked to reset their profile
/// data and chat history, not their look-and-feel. The web client
/// preserves its display preferences across the reset (#1444); this pins
/// the same contract on mobile, where the preferences live in
/// SharedPreferences via ThemeManager.
void main() {
  tearDown(() {
    resetThemeManager();
    I18nService().changeLanguage('en');
  });

  /// Pumps a bounded number of frames instead of pumpAndSettle: this
  /// tree never settles in the test environment (see
  /// settings_reset_files_deletion_test.dart).
  Future<void> pumpFrames(WidgetTester tester, {int frames = 20}) async {
    for (var i = 0; i < frames; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }
  }

  testWidgets('reset keeps the stored theme and font scale', (tester) async {
    // The storage keys are ThemeManager's private constants
    // ('theme_preference' / 'font_scale'); the literals keep the test at
    // the storage boundary the contract lives at.
    SharedPreferences.setMockInitialValues({});

    setupLightTokens();
    I18nService().changeLanguage('en');

    final api = MockCurrentUserApi();
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

    // Seed the preferences through ThemeManager's own persistence path
    // (setupLightTokens writes its defaults asynchronously, so a direct
    // mock seeding would be clobbered) and let the writes land.
    ThemeManager().setTheme('dark');
    ThemeManager().setFontSize(80.0);
    await pumpFrames(tester);

    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('theme_preference'), 'dark');
    expect(prefs.getDouble('font_scale'), 80.0);

    final resetTile = find.byKey(const Key('settings_reset_data_button'));
    await tester.ensureVisible(resetTile);
    await pumpFrames(tester);
    await tester.tap(resetTile);
    await pumpFrames(tester);
    await tester.tap(find.byKey(const Key('settings_reset_confirm_button')));
    await pumpFrames(tester);

    // The reset must actually have run: a broken confirm wiring (the reset
    // call never fires) would leave the storage untouched and the survival
    // assertions below green for the wrong reason.
    expect(api.resetCalls, 1);

    final prefsAfterReset = await SharedPreferences.getInstance();
    expect(prefsAfterReset.getString('theme_preference'), 'dark');
    expect(prefsAfterReset.getDouble('font_scale'), 80.0);

    await tester.pumpWidget(const SizedBox.shrink());
    await pumpFrames(tester);
  });
}
