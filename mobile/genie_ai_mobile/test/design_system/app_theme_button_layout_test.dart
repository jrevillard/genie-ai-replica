import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/design_system/components/ds_button.dart';
import 'package:genie_ai_mobile/design_system/theme/app_theme.dart';
import 'package:genie_ai_mobile/design_system/tokens/app_tokens.dart';

/// Regression for the 2026-11-20 emulator wedge (#1939 live verify): the app
/// theme set `minimumSize: Size(double.infinity, 48)` on the elevated and
/// text button themes. A Row lays out non-flex children with UNBOUNDED main
/// axis width; ButtonStyleButton enforces the style's minWidth into the
/// child's constraints, so the button received a TIGHT infinite width and
/// RenderPhysicalShape threw "BoxConstraints forces an infinite width"
/// during performLayout. Every later frame re-threw — the concept browser's
/// detail pane painted nothing and the app wedged. The infinity was
/// redundant where it worked (tight/stretch parents already force full
/// width) and fatal everywhere else, so it is finite now.
void main() {
  ThemeData theme() => AppTheme.build(
    AppTokens.fromConfig(config: const {}, isDark: false, fontScale: 1.0),
  );

  Widget harness(Widget child) => MaterialApp(
    theme: theme(),
    home: Scaffold(body: Row(children: [child])),
  );

  testWidgets('labeled DsButton inside a Row lays out under the app theme', (
    tester,
  ) async {
    await tester.pumpWidget(
      harness(
        DsButton(
          key: const ValueKey('okf-browser-back-to-list'),
          label: 'Back to list',
          variant: DsButtonVariant.ghost,
          small: true,
          onPressed: () {},
        ),
      ),
    );
    await tester.pump();

    expect(tester.takeException(), isNull);
    expect(find.byType(ElevatedButton), findsOneWidget);
  });

  testWidgets('TextButton inside a Row lays out under the app theme', (
    tester,
  ) async {
    await tester.pumpWidget(
      harness(
        TextButton(onPressed: () {}, child: const Text('In a row')),
      ),
    );
    await tester.pump();

    expect(tester.takeException(), isNull);
    expect(find.byType(TextButton), findsOneWidget);
  });

  testWidgets(
    // The theme's old `Size(double.infinity, 48)` minimum gave every button
    // in a BOUNDED context (a Column center, a stretch) full width for free
    // — and crashed Rows. The theme is finite now; the full-width idiom
    // lives in DsButton itself: fill bounded width, hug in a Row's
    // unbounded slot. This pins the visible behavior every pre-existing
    // screen relied on (the login card's Sign in, the settings rows).
    'DsButton fills its bounded width and hugs in a Row',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: theme(),
          home: Scaffold(
            body: Column(
              children: [
                DsButton(label: 'Save', onPressed: () {}),
                Row(
                  children: [
                    DsButton(label: 'Row button', onPressed: () {}),
                  ],
                ),
              ],
            ),
          ),
        ),
      );
      await tester.pump();

      final buttons = tester.widgetList<ElevatedButton>(
        find.byType(ElevatedButton),
      );
      expect(buttons, hasLength(2));
      final saveWidth = tester.getSize(find.byType(ElevatedButton).first).width;
      // Bounded column: full body width (the old theme behavior).
      expect(saveWidth, 800.0);
      // Unbounded Row slot: hug the label, no crash.
      final rowWidth = tester.getSize(find.byType(ElevatedButton).last).width;
      expect(rowWidth, lessThan(400.0));
    },
  );
}
