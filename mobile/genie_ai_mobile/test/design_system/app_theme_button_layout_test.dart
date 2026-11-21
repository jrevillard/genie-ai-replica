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
}
