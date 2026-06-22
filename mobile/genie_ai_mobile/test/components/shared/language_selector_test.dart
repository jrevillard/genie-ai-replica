import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/components/shared/language_selector.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';

import '../../helpers/test_app.dart';
import '../../helpers/theme_helper.dart';

void main() {
  setUp(() {
    setupLightTokens();
    I18nService().changeLanguage('en');
  });
  tearDown(() {
    resetThemeManager();
    I18nService().changeLanguage('en');
  });

  group('LanguageSelector', () {
    group('dropdown rendering', () {
      testWidgets('renders with current locale selected', (tester) async {
        await tester.pumpWidget(testApp(LanguageSelector()));
        await tester.pumpAndSettle();
        expect(find.byKey(const ValueKey('language-selector')), findsOneWidget);
      });

      testWidgets('all supported languages appear as items', (tester) async {
        await tester.pumpWidget(testApp(LanguageSelector()));
        await tester.pumpAndSettle();
        final dropdown = tester.widget<DropdownButton<String>>(
          find.byKey(const ValueKey('language-selector')),
        );
        final i18n = I18nService();
        expect(dropdown.items!.length, i18n.supportedLanguages.length);
      });
    });

    group('language change callback', () {
      testWidgets('onChanged fires on selection', (tester) async {
        var changed = false;
        await tester.pumpWidget(
          testApp(LanguageSelector(onChanged: (_) => changed = true)),
        );
        await tester.pumpAndSettle();

        // Tap the dropdown to open it
        await tester.tap(find.byKey(const ValueKey('language-selector')));
        await tester.pumpAndSettle();

        // Find and tap the Spanish item by key
        await tester.tap(find.byKey(const ValueKey('lang-item-es')));
        await tester.pumpAndSettle();

        expect(changed, isTrue);
      });
    });

    group('custom colors', () {
      testWidgets('custom textColor applied to icon', (tester) async {
        const customColor = Color(0xFF123456);
        await tester.pumpWidget(
          testApp(LanguageSelector(textColor: customColor)),
        );
        await tester.pumpAndSettle();
        final icon = tester.widget<Icon>(
          find.byKey(const ValueKey('language-selector-icon')),
        );
        expect(icon.color, customColor);
      });

      testWidgets('custom dropdownColor applied', (tester) async {
        const customBg = Color(0xFF654321);
        await tester.pumpWidget(
          testApp(LanguageSelector(dropdownColor: customBg)),
        );
        await tester.pumpAndSettle();
        final dropdown = tester.widget<DropdownButton<String>>(
          find.byKey(const ValueKey('language-selector')),
        );
        expect(dropdown.dropdownColor, customBg);
      });
    });
  });
}
