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
        final button = tester.widget<ElevatedButton>(
          find.byKey(const ValueKey('ds-button')),
        );
        expect(button, isNotNull);
        final label = tester.widget<Text>(
          find.byKey(const ValueKey('ds-button-label')),
        );
        expect(label.data, 'Primary');
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
        final label = tester.widget<Text>(
          find.byKey(const ValueKey('ds-button-label')),
        );
        expect(label.data, 'Secondary');
        final button = tester.widget<ElevatedButton>(
          find.byKey(const ValueKey('ds-button')),
        );
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
        final label = tester.widget<Text>(
          find.byKey(const ValueKey('ds-button-label')),
        );
        expect(label.data, 'Ghost');
        final button = tester.widget<ElevatedButton>(
          find.byKey(const ValueKey('ds-button')),
        );
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
        final label = tester.widget<Text>(
          find.byKey(const ValueKey('ds-button-label')),
        );
        expect(label.data, 'Danger');
        final tokens = ThemeManager().tokens;
        final button = tester.widget<ElevatedButton>(
          find.byKey(const ValueKey('ds-button')),
        );
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
        final sizedBox = tester.widget<SizedBox>(
          find.byKey(const ValueKey('ds-button-sizer')),
        );
        expect(sizedBox.height, 48);
      });

      testWidgets('small height is 36', (tester) async {
        await tester.pumpWidget(
          testApp(DsButton(label: 'Test', small: true, onPressed: () {})),
        );
        final sizedBox = tester.widget<SizedBox>(
          find.byKey(const ValueKey('ds-button-sizer')),
        );
        expect(sizedBox.height, 36);
      });
    });

    group('disabled state', () {
      testWidgets('onPressed is null when disabled', (tester) async {
        var pressed = false;
        await tester.pumpWidget(
          testApp(DsButton(label: 'Test', disabled: true, onPressed: () => pressed = true)),
        );
        await tester.tap(find.byKey(const ValueKey('ds-button')));
        expect(pressed, isFalse);
      });
    });

    group('icon-only mode', () {
      testWidgets('renders IconButton', (tester) async {
        await tester.pumpWidget(
          testApp(DsButton(icon: Icons.add, iconOnly: true, onPressed: () {})),
        );
        final iconButton = tester.widget<IconButton>(
          find.byKey(const ValueKey('ds-button')),
        );
        expect(iconButton, isNotNull);
        final icon = tester.widget<Icon>(
          find.byKey(const ValueKey('ds-button-icon')),
        );
        expect(icon.icon, Icons.add);
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
        await tester.tap(find.byKey(const ValueKey('ds-button')));
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
        final icon = tester.widget<Icon>(
          find.byKey(const ValueKey('ds-button-icon')),
        );
        expect(icon.icon, Icons.save);
        final label = tester.widget<Text>(
          find.byKey(const ValueKey('ds-button-label')),
        );
        expect(label.data, 'Save');
      });
    });

    group('label-only', () {
      testWidgets('renders Text widget', (tester) async {
        await tester.pumpWidget(
          testApp(DsButton(label: 'Click Me', onPressed: () {})),
        );
        final label = tester.widget<Text>(
          find.byKey(const ValueKey('ds-button-label')),
        );
        expect(label.data, 'Click Me');
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
        final button = tester.widget<ElevatedButton>(
          find.byKey(const ValueKey('ds-button')),
        );
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
        final button = tester.widget<ElevatedButton>(
          find.byKey(const ValueKey('ds-button')),
        );
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
        await tester.tap(find.byKey(const ValueKey('ds-button')));
        expect(pressed, isTrue);
      });
    });

    group('edge cases', () {
      testWidgets('no label, no icon renders ElevatedButton with empty text', (tester) async {
        await tester.pumpWidget(testApp(DsButton()));
        final button = tester.widget<ElevatedButton>(
          find.byKey(const ValueKey('ds-button')),
        );
        expect(button, isNotNull);
        final label = tester.widget<Text>(
          find.byKey(const ValueKey('ds-button-label')),
        );
        expect(label.data, '');
      });
    });
  });
}
