import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/components/shared/inline_modal.dart';

import '../../helpers/test_app.dart';
import '../../helpers/theme_helper.dart';

Widget _page({
  required bool visible,
  required bool dismissible,
  required VoidCallback onDismiss,
  required VoidCallback onHeaderTap,
  required VoidCallback onBehindTap,
}) {
  return testApp(
    Column(
      children: [
        // Simulates the nav bar: OUTSIDE the stack the modal lives in.
        ElevatedButton(
          key: const Key('header'),
          onPressed: onHeaderTap,
          child: const Text('header'),
        ),
        Expanded(
          child: Stack(
            children: [
              Center(
                child: ElevatedButton(
                  key: const Key('behind'),
                  onPressed: onBehindTap,
                  child: const Text('behind'),
                ),
              ),
              InlineModal(
                visible: visible,
                dismissible: dismissible,
                onDismiss: onDismiss,
                child: const SizedBox(
                  key: Key('modal-child'),
                  width: 120,
                  height: 60,
                ),
              ),
            ],
          ),
        ),
      ],
    ),
  );
}

void main() {
  setUp(setupLightTokens);
  tearDown(resetThemeManager);

  testWidgets('hidden renders nothing', (tester) async {
    await tester.pumpWidget(
      _page(
        visible: false,
        dismissible: true,
        onDismiss: () {},
        onHeaderTap: () {},
        onBehindTap: () {},
      ),
    );
    expect(find.byKey(const ValueKey('inline-modal-barrier')), findsNothing);
    expect(find.byKey(const Key('modal-child')), findsNothing);
  });

  testWidgets('scrim shields the area beneath but the header stays live', (
    tester,
  ) async {
    var behind = 0, header = 0, dismissed = 0;
    await tester.pumpWidget(
      _page(
        visible: true,
        dismissible: true,
        onDismiss: () => dismissed++,
        onHeaderTap: () => header++,
        onBehindTap: () => behind++,
      ),
    );
    expect(find.byKey(const Key('modal-child')), findsOneWidget);

    // A tap where the covered button sits hits the scrim (-> dismiss), not it.
    await tester.tapAt(tester.getTopLeft(find.byKey(const Key('behind'))));
    await tester.pump();
    expect(behind, 0);
    expect(dismissed, 1);

    // The header outside the stack is still reachable (brand -> dashboard).
    await tester.tap(find.byKey(const Key('header')));
    await tester.pump();
    expect(header, 1);
  });

  testWidgets('non-dismissible scrim ignores taps', (tester) async {
    var dismissed = 0;
    await tester.pumpWidget(
      _page(
        visible: true,
        dismissible: false,
        onDismiss: () => dismissed++,
        onHeaderTap: () {},
        onBehindTap: () {},
      ),
    );
    await tester.tapAt(const Offset(10, 300));
    await tester.pump();
    expect(dismissed, 0);
  });
}
