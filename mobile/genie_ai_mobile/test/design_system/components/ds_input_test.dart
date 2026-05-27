import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/design_system/components/ds_input.dart';

import '../../helpers/test_app.dart';
import '../../helpers/theme_helper.dart';

void main() {
  setUp(setupLightTokens);
  tearDown(resetThemeManager);

  group('DsInput', () {
    group('sizes', () {
      testWidgets('sm has height 36', (tester) async {
        await tester.pumpWidget(
          testApp(DsInput(size: DsInputSize.sm)),
        );
        final sizedBox = tester.widget<SizedBox>(find.byType(SizedBox).first);
        expect(sizedBox.height, 36);
      });

      testWidgets('md has height 44', (tester) async {
        await tester.pumpWidget(
          testApp(DsInput(size: DsInputSize.md)),
        );
        final sizedBox = tester.widget<SizedBox>(find.byType(SizedBox).first);
        expect(sizedBox.height, 44);
      });

      testWidgets('lg has height 52', (tester) async {
        await tester.pumpWidget(
          testApp(DsInput(size: DsInputSize.lg)),
        );
        final sizedBox = tester.widget<SizedBox>(find.byType(SizedBox).first);
        expect(sizedBox.height, 52);
      });
    });

    group('placeholder text', () {
      testWidgets('displays hint text', (tester) async {
        await tester.pumpWidget(
          testApp(DsInput(placeholder: 'Enter name')),
        );
        expect(find.text('Enter name'), findsOneWidget);
      });
    });

    group('enabled/disabled', () {
      testWidgets('enabled by default', (tester) async {
        await tester.pumpWidget(
          testApp(DsInput()),
        );
        final textField = tester.widget<TextField>(find.byType(TextField));
        expect(textField.enabled, isTrue);
      });

      testWidgets('disabled state', (tester) async {
        await tester.pumpWidget(
          testApp(DsInput(enabled: false)),
        );
        final textField = tester.widget<TextField>(find.byType(TextField));
        expect(textField.enabled, isFalse);
      });
    });

    group('obscureText', () {
      testWidgets('defaults to false', (tester) async {
        await tester.pumpWidget(
          testApp(DsInput()),
        );
        final textField = tester.widget<TextField>(find.byType(TextField));
        expect(textField.obscureText, isFalse);
      });

      testWidgets('obscure mode enabled', (tester) async {
        await tester.pumpWidget(
          testApp(DsInput(obscureText: true)),
        );
        final textField = tester.widget<TextField>(find.byType(TextField));
        expect(textField.obscureText, isTrue);
      });
    });

    group('multiline', () {
      testWidgets('multiline has unconstrained height', (tester) async {
        await tester.pumpWidget(
          testApp(DsInput(maxLines: 4)),
        );
        final sizedBox = tester.widget<SizedBox>(find.byType(SizedBox).first);
        expect(sizedBox.height, isNull);
      });
    });

    group('prefix icon', () {
      testWidgets('renders prefix icon', (tester) async {
        await tester.pumpWidget(
          testApp(DsInput(prefixIcon: Icons.search)),
        );
        expect(find.byIcon(Icons.search), findsOneWidget);
      });
    });

    group('suffix widget', () {
      testWidgets('renders suffix widget', (tester) async {
        await tester.pumpWidget(
          testApp(DsInput(suffix: Icon(Icons.clear))),
        );
        expect(find.byIcon(Icons.clear), findsOneWidget);
      });
    });

    group('onChanged callback', () {
      testWidgets('fires on text entry', (tester) async {
        var changed = false;
        await tester.pumpWidget(
          testApp(DsInput(onChanged: (_) => changed = true)),
        );
        await tester.enterText(find.byType(TextField), 'hello');
        expect(changed, isTrue);
      });
    });

    group('color overrides', () {
      testWidgets('overrideFillColor is applied', (tester) async {
        const customFill = Color(0xFF123456);
        await tester.pumpWidget(
          testApp(DsInput(overrideFillColor: customFill)),
        );
        final textField = tester.widget<TextField>(find.byType(TextField));
        expect(textField.decoration!.fillColor, customFill);
      });

      testWidgets('overrideBorderColor is applied to focused border', (tester) async {
        const customBorder = Color(0xFF654321);
        await tester.pumpWidget(
          testApp(DsInput(overrideBorderColor: customBorder)),
        );
        final textField = tester.widget<TextField>(find.byType(TextField));
        final focusedBorder =
            textField.decoration!.focusedBorder as OutlineInputBorder;
        expect(focusedBorder.borderSide.color, customBorder);
        expect(focusedBorder.borderSide.width, 2);
      });
    });
  });
}
