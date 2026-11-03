import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../helpers/chatbot_harness.dart';

// The Quick Help overlay's grid is a LAZY viewport: a sliver grid builds
// the tiles the viewport (plus its cache extent) needs, not all of them.
// The shrinkWrap grid it replaced materialized EVERY tile on EVERY
// overlay frame — a deployment that configures dozens of cards paid the
// full build at typing, streaming and font-scale frames.
//
// The assertion is a frame count, not a feeling: with more cards than
// the viewport can show, fewer than half may exist in the tree after the
// mount, and scrolling must materialize the far end.
void main() {
  // 120 healthy scoped cards: far more than the phone-sized viewport
  // (360×740) shows at once, all healthy under the tree fixture.
  final cards = <Map<String, dynamic>>[
    for (var i = 0; i < 120; i++)
      {
        'id': 'card-$i',
        'title': {'en': 'Card $i'},
        'category': '2',
        'serviceLabels': ['Births'],
      },
  ];

  final tree = quickHelpTreeFixture();

  late Uint8List config;
  setUpAll(() async {
    config = await chatbotConfigBytesWithButtons(cards);
  });

  setUp(resetChatbotTestState);
  tearDown(resetChatbotTestState);

  int builtTiles(WidgetTester tester) {
    var built = 0;
    for (var i = 0; i < cards.length; i++) {
      if (find.text('Card $i').evaluate().isNotEmpty) built++;
    }
    return built;
  }

  testWidgets(
    'the overlay grid builds fewer tiles than it owns, and scrolling builds the far end',
    (tester) async {
      usePhoneSurface(tester);
      mockChatbotConfigAsset(tester, config);
      await pumpChatBot(tester, QuickHelpTreeMockClient(tree));

      // The grid rendered: the first card is up.
      expect(find.text('Card 0'), findsOneWidget);
      // LAZY: fewer than half the cards exist in the tree after the
      // mount. An eager build puts all 120 here.
      final built = builtTiles(tester);
      expect(built, lessThan(cards.length ~/ 2));

      // The far end builds when the user scrolls to it.
      await tester.drag(find.byType(Scrollable).first, const Offset(0, -20000));
      await tester.pumpAndSettle();
      expect(find.text('Card 119'), findsOneWidget);
    },
  );
}
