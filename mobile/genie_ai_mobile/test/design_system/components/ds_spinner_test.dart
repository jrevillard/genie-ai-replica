import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/design_system/components/ds_spinner.dart';
import 'package:genie_ai_mobile/design_system/tokens/spacing.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';

import '../../helpers/test_app.dart';
import '../../helpers/theme_helper.dart';

void main() {
  setUp(setupLightTokens);
  tearDown(resetThemeManager);

  group('DsSpinner', () {
    group('dimensions', () {
      testWidgets('sm size uses DsSpacing.md (16)', (tester) async {
        await tester.pumpWidget(testApp(DsSpinner(size: DsSpinnerSize.sm)));
        final sizedBox = tester.widget<SizedBox>(
          find.byKey(const ValueKey('ds-spinner-sizer')),
        );
        expect(sizedBox.width, DsSpacing.md);
        expect(sizedBox.height, DsSpacing.md);
      });

      testWidgets('md size uses DsSpacing.lg (24)', (tester) async {
        await tester.pumpWidget(testApp(DsSpinner(size: DsSpinnerSize.md)));
        final sizedBox = tester.widget<SizedBox>(
          find.byKey(const ValueKey('ds-spinner-sizer')),
        );
        expect(sizedBox.width, DsSpacing.lg);
        expect(sizedBox.height, DsSpacing.lg);
      });

      testWidgets('lg size uses DsSpacing.xl + DsSpacing.sm (40)', (tester) async {
        await tester.pumpWidget(testApp(DsSpinner(size: DsSpinnerSize.lg)));
        final sizedBox = tester.widget<SizedBox>(
          find.byKey(const ValueKey('ds-spinner-sizer')),
        );
        expect(sizedBox.width, DsSpacing.xl + DsSpacing.sm);
        expect(sizedBox.height, DsSpacing.xl + DsSpacing.sm);
      });
    });

    group('color', () {
      testWidgets('defaults to tokens.accent', (tester) async {
        await tester.pumpWidget(testApp(DsSpinner()));
        final indicator = tester.widget<CircularProgressIndicator>(
          find.byKey(const ValueKey('ds-spinner')),
        );
        expect(indicator.color, ThemeManager().tokens.accent);
      });

      testWidgets('custom color override', (tester) async {
        const customColor = Color(0xFF123456);
        await tester.pumpWidget(
          testApp(DsSpinner(color: customColor)),
        );
        final indicator = tester.widget<CircularProgressIndicator>(
          find.byKey(const ValueKey('ds-spinner')),
        );
        expect(indicator.color, customColor);
      });
    });

    group('strokeWidth', () {
      testWidgets('custom strokeWidth override', (tester) async {
        await tester.pumpWidget(
          testApp(DsSpinner(strokeWidth: 5.0)),
        );
        final indicator = tester.widget<CircularProgressIndicator>(
          find.byKey(const ValueKey('ds-spinner')),
        );
        expect(indicator.strokeWidth, 5.0);
      });
    });

    group('renders CircularProgressIndicator', () {
      testWidgets('always renders a CircularProgressIndicator', (tester) async {
        await tester.pumpWidget(testApp(DsSpinner()));
        expect(find.byKey(const ValueKey('ds-spinner')), findsOneWidget);
      });
    });
  });
}
