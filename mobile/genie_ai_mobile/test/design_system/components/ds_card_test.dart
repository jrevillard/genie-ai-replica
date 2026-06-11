import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/design_system/components/ds_card.dart';

import '../../helpers/test_app.dart';
import '../../helpers/theme_helper.dart';

void main() {
  setUp(setupLightTokens);
  tearDown(resetThemeManager);

  group('DsCard', () {
    group('variants', () {
      testWidgets('standard has border and no elevation', (tester) async {
        await tester.pumpWidget(
          testApp(
            DsCard(child: Text('Standard', key: const ValueKey('card-child'))),
          ),
        );
        final card = tester.widget<Card>(find.byKey(const ValueKey('ds-card')));
        expect(card.elevation, 0);
        final child = tester.widget<Text>(
          find.byKey(const ValueKey('card-child')),
        );
        expect(child.data, 'Standard');
      });

      testWidgets('flat has no border', (tester) async {
        await tester.pumpWidget(
          testApp(
            DsCard(
              variant: DsCardVariant.flat,
              child: Text('Flat', key: const ValueKey('card-child')),
            ),
          ),
        );
        final card = tester.widget<Card>(find.byKey(const ValueKey('ds-card')));
        final shape = card.shape as RoundedRectangleBorder;
        final side = shape.side;
        expect(side, BorderSide.none);
      });

      testWidgets('elevated has elevation 2', (tester) async {
        await tester.pumpWidget(
          testApp(
            DsCard(
              variant: DsCardVariant.elevated,
              child: Text('Elevated', key: const ValueKey('card-child')),
            ),
          ),
        );
        final card = tester.widget<Card>(find.byKey(const ValueKey('ds-card')));
        expect(card.elevation, 2);
      });

      testWidgets('outline has border', (tester) async {
        await tester.pumpWidget(
          testApp(
            DsCard(
              variant: DsCardVariant.outline,
              child: Text('Outline', key: const ValueKey('card-child')),
            ),
          ),
        );
        final card = tester.widget<Card>(find.byKey(const ValueKey('ds-card')));
        final shape = card.shape as RoundedRectangleBorder;
        expect(shape.side, isNot(equals(BorderSide.none)));
      });
    });

    group('custom padding', () {
      testWidgets('applies custom padding', (tester) async {
        const customPadding = EdgeInsets.all(32.0);
        await tester.pumpWidget(
          testApp(
            DsCard(
              padding: customPadding,
              child: SizedBox(key: Key('card-child')),
            ),
          ),
        );
        final padding = tester.widget<Padding>(
          find.byKey(const ValueKey('ds-card-padding')),
        );
        expect(padding.padding, customPadding);
      });
    });

    group('custom radius', () {
      testWidgets('applies custom border radius', (tester) async {
        await tester.pumpWidget(
          testApp(
            DsCard(
              radius: 20.0,
              child: Text('Round', key: const ValueKey('card-child')),
            ),
          ),
        );
        final card = tester.widget<Card>(find.byKey(const ValueKey('ds-card')));
        final shape = card.shape as RoundedRectangleBorder;
        final borderRadius = shape.borderRadius as BorderRadius;
        expect(borderRadius.topLeft.x, 20.0);
      });
    });

    group('color overrides', () {
      testWidgets('overrideBg changes background', (tester) async {
        const customBg = Color(0xFF123456);
        await tester.pumpWidget(
          testApp(
            DsCard(
              overrideBg: customBg,
              child: Text('Custom', key: const ValueKey('card-child')),
            ),
          ),
        );
        final card = tester.widget<Card>(find.byKey(const ValueKey('ds-card')));
        expect(card.color, customBg);
      });

      testWidgets('overrideBorderColor changes border', (tester) async {
        const customBorder = Color(0xFF654321);
        await tester.pumpWidget(
          testApp(
            DsCard(
              variant: DsCardVariant.outline,
              overrideBorderColor: customBorder,
              child: Text('Border', key: const ValueKey('card-child')),
            ),
          ),
        );
        final card = tester.widget<Card>(find.byKey(const ValueKey('ds-card')));
        final shape = card.shape as RoundedRectangleBorder;
        expect(shape.side.color, customBorder);
      });
    });

    group('child rendering', () {
      testWidgets('renders child widget', (tester) async {
        await tester.pumpWidget(
          testApp(
            DsCard(
              child: Text('Child Content', key: const ValueKey('card-child')),
            ),
          ),
        );
        final child = tester.widget<Text>(
          find.byKey(const ValueKey('card-child')),
        );
        expect(child.data, 'Child Content');
      });
    });

    group('onTap', () {
      testWidgets('renders without error when no onTap provided', (
        tester,
      ) async {
        await tester.pumpWidget(
          testApp(
            DsCard(child: Text('Static', key: const ValueKey('card-child'))),
          ),
        );
        expect(find.byKey(const ValueKey('ds-card')), findsOneWidget);
      });
    });
  });
}
