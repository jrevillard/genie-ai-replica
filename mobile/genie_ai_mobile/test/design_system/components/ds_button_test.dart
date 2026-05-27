import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/design_system/components/ds_button.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';

import '../../helpers/test_app.dart';
import '../../helpers/theme_helper.dart';

void main() {
  setUp(setupLightTokens);
  tearDown(resetThemeManager);

  group('DsButton', () {
    group('variants', () {
      testWidgets('primary renders ElevatedButton', (tester) async {
        await tester.pumpWidget(
          testApp(DsButton(label: 'Primary', onPressed: () {})),
        );
        expect(find.byType(ElevatedButton), findsOneWidget);
        expect(find.text('Primary'), findsOneWidget);
      });

      testWidgets('secondary renders with border', (tester) async {
        await tester.pumpWidget(
          testApp(
            DsButton(
              label: 'Secondary',
              variant: DsButtonVariant.secondary,
              onPressed: () {},
            ),
          ),
        );
        expect(find.text('Secondary'), findsOneWidget);
        final button = tester.widget<ElevatedButton>(find.byType(ElevatedButton));
        final shape = button.style!.shape?.resolve({});
        expect(shape, isA<RoundedRectangleBorder>());
      });

      testWidgets('ghost renders with transparent bg', (tester) async {
        await tester.pumpWidget(
          testApp(
            DsButton(
              label: 'Ghost',
              variant: DsButtonVariant.ghost,
              onPressed: () {},
            ),
          ),
        );
        expect(find.text('Ghost'), findsOneWidget);
        final button = tester.widget<ElevatedButton>(find.byType(ElevatedButton));
        final bg =
            button.style!.backgroundColor?.resolve({});
        expect(bg, Colors.transparent);
      });

      testWidgets('danger renders with danger color', (tester) async {
        await tester.pumpWidget(
          testApp(
            DsButton(
              label: 'Danger',
              variant: DsButtonVariant.danger,
              onPressed: () {},
            ),
          ),
        );
        expect(find.text('Danger'), findsOneWidget);
        final tokens = ThemeManager().tokens;
        final button = tester.widget<ElevatedButton>(find.byType(ElevatedButton));
        final bg =
            button.style!.backgroundColor?.resolve({});
        expect(bg, tokens.danger);
      });
    });

    group('sizes', () {
      testWidgets('default height is 48', (tester) async {
        await tester.pumpWidget(
          testApp(DsButton(label: 'Test', onPressed: () {})),
        );
        final sizedBox = tester.widget<SizedBox>(find.byType(SizedBox).first);
        expect(sizedBox.height, 48);
      });

      testWidgets('small height is 36', (tester) async {
        await tester.pumpWidget(
          testApp(DsButton(label: 'Test', small: true, onPressed: () {})),
        );
        final sizedBox = tester.widget<SizedBox>(find.byType(SizedBox).first);
        expect(sizedBox.height, 36);
      });
    });

    group('disabled state', () {
      testWidgets('onPressed is null when disabled', (tester) async {
        var pressed = false;
        await tester.pumpWidget(
          testApp(DsButton(label: 'Test', disabled: true, onPressed: () => pressed = true)),
        );
        await tester.tap(find.text('Test'));
        expect(pressed, isFalse);
      });
    });

    group('icon-only mode', () {
      testWidgets('renders IconButton', (tester) async {
        await tester.pumpWidget(
          testApp(DsButton(icon: Icons.add, iconOnly: true, onPressed: () {})),
        );
        expect(find.byType(IconButton), findsOneWidget);
        expect(find.byIcon(Icons.add), findsOneWidget);
      });

      testWidgets('icon-only disabled has null callback', (tester) async {
        var pressed = false;
        await tester.pumpWidget(
          testApp(
            DsButton(
              icon: Icons.add,
              iconOnly: true,
              disabled: true,
              onPressed: () => pressed = true,
            ),
          ),
        );
        await tester.tap(find.byIcon(Icons.add));
        expect(pressed, isFalse);
      });
    });

    group('icon + label', () {
      testWidgets('renders Row with Icon and Text', (tester) async {
        await tester.pumpWidget(
          testApp(
            DsButton(
              icon: Icons.save,
              label: 'Save',
              onPressed: () {},
            ),
          ),
        );
        expect(find.byIcon(Icons.save), findsOneWidget);
        expect(find.text('Save'), findsOneWidget);
      });
    });

    group('label-only', () {
      testWidgets('renders Text widget', (tester) async {
        await tester.pumpWidget(
          testApp(DsButton(label: 'Click Me', onPressed: () {})),
        );
        expect(find.text('Click Me'), findsOneWidget);
      });
    });

    group('color overrides', () {
      testWidgets('overrideBg applies custom background', (tester) async {
        const customBg = Color(0xFF123456);
        await tester.pumpWidget(
          testApp(
            DsButton(
              label: 'Custom',
              overrideBg: customBg,
              onPressed: () {},
            ),
          ),
        );
        final button = tester.widget<ElevatedButton>(find.byType(ElevatedButton));
        final bg =
            button.style!.backgroundColor?.resolve({});
        expect(bg, customBg);
      });

      testWidgets('overrideFg applies custom foreground', (tester) async {
        const customFg = Color(0xFF654321);
        await tester.pumpWidget(
          testApp(
            DsButton(
              label: 'Custom',
              overrideFg: customFg,
              onPressed: () {},
            ),
          ),
        );
        final button = tester.widget<ElevatedButton>(find.byType(ElevatedButton));
        final fg =
            button.style!.foregroundColor?.resolve({});
        expect(fg, customFg);
      });
    });

    group('onPressed callback', () {
      testWidgets('fires on tap', (tester) async {
        var pressed = false;
        await tester.pumpWidget(
          testApp(DsButton(label: 'Tap', onPressed: () => pressed = true)),
        );
        await tester.tap(find.text('Tap'));
        expect(pressed, isTrue);
      });
    });

    group('edge cases', () {
      testWidgets('no label, no icon renders ElevatedButton with empty Text', (tester) async {
        await tester.pumpWidget(testApp(DsButton()));
        expect(find.byType(ElevatedButton), findsOneWidget);
      });
    });
  });
}
