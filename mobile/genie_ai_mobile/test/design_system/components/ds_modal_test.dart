import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/design_system/components/ds_button.dart';
import 'package:genie_ai_mobile/design_system/components/ds_modal.dart';

import '../../helpers/test_app.dart';
import '../../helpers/theme_helper.dart';

void main() {
  setUp(setupLightTokens);
  tearDown(resetThemeManager);

  group('DsModal', () {
    group('sizes', () {
      testWidgets('sm sets maxWidth 360', (tester) async {
        await tester.pumpWidget(
          testApp(
            DsModal(
              title: 'T',
              content: Text('B', key: const ValueKey('modal-body')),
              size: DsModalSize.sm,
            ),
          ),
        );
        final constraint = tester.widget<ConstrainedBox>(
          find.byKey(const ValueKey('ds-modal-constraint')),
        );
        expect(constraint.constraints.maxWidth, 360.0);
      });

      testWidgets('md sets maxWidth 480', (tester) async {
        await tester.pumpWidget(
          testApp(
            DsModal(
              title: 'T',
              content: Text('B', key: const ValueKey('modal-body')),
              size: DsModalSize.md,
            ),
          ),
        );
        final constraint = tester.widget<ConstrainedBox>(
          find.byKey(const ValueKey('ds-modal-constraint')),
        );
        expect(constraint.constraints.maxWidth, 480.0);
      });

      testWidgets('lg sets maxWidth 640', (tester) async {
        await tester.pumpWidget(
          testApp(
            DsModal(
              title: 'T',
              content: Text('B', key: const ValueKey('modal-body')),
              size: DsModalSize.lg,
            ),
          ),
        );
        final constraint = tester.widget<ConstrainedBox>(
          find.byKey(const ValueKey('ds-modal-constraint')),
        );
        expect(constraint.constraints.maxWidth, 640.0);
      });

      testWidgets('xl sets maxWidth 800', (tester) async {
        await tester.pumpWidget(
          testApp(
            DsModal(
              title: 'T',
              content: Text('B', key: const ValueKey('modal-body')),
              size: DsModalSize.xl,
            ),
          ),
        );
        final constraint = tester.widget<ConstrainedBox>(
          find.byKey(const ValueKey('ds-modal-constraint')),
        );
        expect(constraint.constraints.maxWidth, 800.0);
      });
    });

    group('title rendering', () {
      testWidgets('displays title text', (tester) async {
        await tester.pumpWidget(
          testApp(DsModal(title: 'My Title', content: Text('Body', key: const ValueKey('modal-body')))),
        );
        final title = tester.widget<Text>(
          find.byKey(const ValueKey('ds-modal-title')),
        );
        expect(title.data, 'My Title');
      });
    });

    group('content rendering', () {
      testWidgets('renders content widget in scrollable', (tester) async {
        await tester.pumpWidget(
          testApp(
            DsModal(
              title: 'Test',
              content: Text('Scrollable Content', key: const ValueKey('modal-body')),
            ),
          ),
        );
        expect(find.byKey(const ValueKey('ds-modal-content-scroll')), findsOneWidget);
        final body = tester.widget<Text>(
          find.byKey(const ValueKey('modal-body')),
        );
        expect(body.data, 'Scrollable Content');
      });
    });

    group('actions', () {
      testWidgets('renders actions in footer', (tester) async {
        await tester.pumpWidget(
          testApp(
            DsModal(
              title: 'Test',
              content: Text('Body', key: const ValueKey('modal-body')),
              actions: [
                Text('OK', key: const ValueKey('modal-action-ok')),
                Text('Cancel', key: const ValueKey('modal-action-cancel')),
              ],
            ),
          ),
        );
        final ok = tester.widget<Text>(
          find.byKey(const ValueKey('modal-action-ok')),
        );
        expect(ok.data, 'OK');
        final cancel = tester.widget<Text>(
          find.byKey(const ValueKey('modal-action-cancel')),
        );
        expect(cancel.data, 'Cancel');
      });

      testWidgets('no actions omits actions divider', (tester) async {
        await tester.pumpWidget(
          testApp(
            DsModal(title: 'Test', content: Text('Body', key: const ValueKey('modal-body'))),
          ),
        );
        // Should have the title divider but NOT the actions divider
        expect(find.byKey(const ValueKey('ds-modal-divider-title')), findsOneWidget);
        expect(find.byKey(const ValueKey('ds-modal-divider-actions')), findsNothing);
      });
    });

    group('DsModal.show()', () {
      testWidgets('displays dialog via showDialog', (tester) async {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: Builder(
                builder: (ctx) => TextButton(
                  onPressed: () => DsModal.show(
                    context: ctx,
                    title: 'Dialog Title',
                    content: Text('Dialog Content'),
                  ),
                  child: Text('Open', key: const ValueKey('trigger')),
                ),
              ),
            ),
          ),
        );

        await tester.tap(find.byKey(const ValueKey('trigger')));
        await tester.pumpAndSettle();

        final title = tester.widget<Text>(
          find.byKey(const ValueKey('ds-modal-title')),
        );
        expect(title.data, 'Dialog Title');
      });

      testWidgets('show() renders actions that fire callbacks', (tester) async {
        var actionFired = false;
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: Builder(
                builder: (ctx) => TextButton(
                  onPressed: () => DsModal.show(
                    context: ctx,
                    title: 'Confirm',
                    content: Text('Body'),
                    actions: [
                      DsButton(
                        key: const ValueKey('show-action'),
                        label: 'OK',
                        onPressed: () => actionFired = true,
                      ),
                    ],
                  ),
                  child: Text('Open', key: const ValueKey('trigger')),
                ),
              ),
            ),
          ),
        );

        await tester.tap(find.byKey(const ValueKey('trigger')));
        await tester.pumpAndSettle();

        await tester.tap(find.byKey(const ValueKey('show-action')));
        expect(actionFired, isTrue);
      });
    });
  });
}
