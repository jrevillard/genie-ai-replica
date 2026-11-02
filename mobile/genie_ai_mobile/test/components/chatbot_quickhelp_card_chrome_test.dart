import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/design_system/components/ds_card.dart';
import 'package:genie_ai_mobile/design_system/tokens/radii.dart';
import 'package:genie_ai_mobile/design_system/tokens/spacing.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';
import 'package:http/http.dart' as http;

import '../helpers/chatbot_harness.dart';

// The Quick Help card's CHROME, as the design system rules ask it to
// resolve: the shell is the DS primitive (DsCard, variant standard —
// the surface, border side and radius are the primitive's defaults,
// not a hand-rolled Container), the padding and the header gap are the
// card scale's NAMED constants (the DS spacing scale has no 12), and
// the grid's spacing is the DsSpacing token the delegate and the
// column bound share. Every assertion reads the RESOLVED value off the
// rendered tree — the mobile Visual Fidelity rule.
void main() {
  final card = <String, dynamic>{
    'id': 'births-id',
    'title': {'en': 'Births Card'},
    'category': '2',
    'serviceLabels': ['Births'],
  };

  final tree = quickHelpTreeFixture();

  late Uint8List config;
  setUpAll(() async {
    config = await chatbotConfigBytesWithButtons([card]);
  });

  setUp(resetChatbotTestState);
  tearDown(resetChatbotTestState);

  void usePhoneSurface(WidgetTester tester) {
    tester.view.physicalSize = const Size(360, 740);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
  }

  testWidgets(
    "the tile chrome is a DsCard with the card scale's named constants",
    (tester) async {
      usePhoneSurface(tester);
      mockChatbotConfigAsset(tester, config);
      await pumpChatBot(tester, _TreeMockClient(tree));

      final tokens = ThemeManager().tokens;
      final tile = find.ancestor(
        of: find.text('Births Card'),
        matching: find.byType(InkWell),
      );

      // The shell is the DS primitive, carrying its standard variant's
      // defaults: surface background, borderLight side, DsRadii.lg
      // corners.
      final shell = tester.widget<DsCard>(
        find.descendant(of: tile, matching: find.byType(DsCard)),
      );
      expect(shell.variant, DsCardVariant.standard);
      expect(shell.overrideBg, tokens.surface);
      expect(shell.overrideBorderColor, tokens.borderLight);

      final shape =
          tester
                  .widget<Card>(
                    find.descendant(of: tile, matching: find.byType(Card)),
                  )
                  .shape!
              as RoundedRectangleBorder;
      expect(shape.borderRadius, BorderRadius.circular(DsRadii.lg));
      expect(shape.side.color, tokens.borderLight);

      // The card scale's padding — the named constant's value, 12/8.
      final padding = tester.widget<Padding>(
        find.descendant(
          of: tile,
          matching: find.byKey(const ValueKey('ds-card-padding')),
        ),
      );
      expect(
        padding.padding,
        const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      );

      // The header's icon-to-title gap — the same off-scale 12.
      expect(
        find.descendant(
          of: tile,
          matching: find.byWidgetPredicate(
            (w) => w is SizedBox && w.width == 12,
          ),
        ),
        findsOneWidget,
      );

      // The grid's spacing is the token — the delegate's own main and
      // cross axis spacing are the ONE value the column bound divides
      // by.
      final delegate =
          tester.widget<GridView>(find.byType(GridView)).gridDelegate
              as SliverGridDelegateWithFixedCrossAxisCount;
      expect(delegate.mainAxisSpacing, DsSpacing.sm);
      expect(delegate.crossAxisSpacing, DsSpacing.sm);
    },
  );
}

class _TreeMockClient extends http.BaseClient {
  _TreeMockClient(this.tree);

  final List<dynamic> tree;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final path = request.url.path;
    if (path.contains('/api/service-categories/categories')) {
      return httpResponseJson(tree, 200);
    }
    return httpResponseJson(<String, dynamic>{}, 404);
  }
}
