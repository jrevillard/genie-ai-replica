import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
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
            DsModal(title: 'T', content: Text('B'), size: DsModalSize.sm),
          ),
        );
        final boxes = tester.widgetList<ConstrainedBox>(
          find.byType(ConstrainedBox),
        );
        final maxWidths = boxes
            .map((b) => (b.constraints as BoxConstraints).maxWidth)
            .where((w) => w == 360.0)
            .toList();
        expect(maxWidths, isNotEmpty);
      });

      testWidgets('md sets maxWidth 480', (tester) async {
        await tester.pumpWidget(
          testApp(
            DsModal(title: 'T', content: Text('B'), size: DsModalSize.md),
          ),
        );
        final boxes = tester.widgetList<ConstrainedBox>(
          find.byType(ConstrainedBox),
        );
        expect(
          boxes.any((b) => (b.constraints as BoxConstraints).maxWidth == 480.0),
          isTrue,
        );
      });

      testWidgets('lg sets maxWidth 640', (tester) async {
        await tester.pumpWidget(
          testApp(
            DsModal(title: 'T', content: Text('B'), size: DsModalSize.lg),
          ),
        );
        final boxes = tester.widgetList<ConstrainedBox>(
          find.byType(ConstrainedBox),
        );
        expect(
          boxes.any((b) => (b.constraints as BoxConstraints).maxWidth == 640.0),
          isTrue,
        );
      });

      testWidgets('xl sets maxWidth 800', (tester) async {
        await tester.pumpWidget(
          testApp(
            DsModal(title: 'T', content: Text('B'), size: DsModalSize.xl),
          ),
        );
        final boxes = tester.widgetList<ConstrainedBox>(
          find.byType(ConstrainedBox),
        );
        expect(
          boxes.any((b) => (b.constraints as BoxConstraints).maxWidth == 800.0),
          isTrue,
        );
      });
    });

    group('title rendering', () {
      testWidgets('displays title text', (tester) async {
        await tester.pumpWidget(
          testApp(DsModal(title: 'My Title', content: Text('Body'))),
        );
        expect(find.text('My Title'), findsOneWidget);
      });
    });

    group('content rendering', () {
      testWidgets('renders content widget in scrollable', (tester) async {
        await tester.pumpWidget(
          testApp(
            DsModal(
              title: 'Test',
              content: Text('Scrollable Content'),
            ),
          ),
        );
        expect(find.byType(SingleChildScrollView), findsOneWidget);
        expect(find.text('Scrollable Content'), findsOneWidget);
      });
    });

    group('actions', () {
      testWidgets('renders actions in footer', (tester) async {
        await tester.pumpWidget(
          testApp(
            DsModal(
              title: 'Test',
              content: Text('Body'),
              actions: [
                Text('OK'),
                Text('Cancel'),
              ],
            ),
          ),
        );
        expect(find.text('OK'), findsOneWidget);
        expect(find.text('Cancel'), findsOneWidget);
      });

      testWidgets('no actions omits footer', (tester) async {
        await tester.pumpWidget(
          testApp(
            DsModal(title: 'Test', content: Text('Body')),
          ),
        );
        // Should have exactly one Divider (between title and content),
        // not two (which would appear if actions section was rendered).
        expect(find.byType(Divider), findsOneWidget);
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
                  child: Text('Open'),
                ),
              ),
            ),
          ),
        );

        await tester.tap(find.text('Open'));
        await tester.pumpAndSettle();

        expect(find.text('Dialog Title'), findsOneWidget);
        expect(find.text('Dialog Content'), findsOneWidget);
      });
    });
  });
}
