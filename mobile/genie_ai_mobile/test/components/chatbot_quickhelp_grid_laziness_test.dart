import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../helpers/chatbot_harness.dart';

// The Quick Help overlay is a LAZY viewport: the sliver grid builds the
// tiles, and the diagnosis rows are a builder sliver too — each builds
// only what the viewport (plus its cache extent) needs. The shrinkWrap
// grid they replaced materialized EVERY card on EVERY overlay frame — a
// deployment that configures dozens of cards paid the full build at
// typing, streaming and font-scale frames, and an OUTAGE breaks every
// card into a row, so the rows are lazy for the same reason.
//
// The assertion is a frame count, not a feeling: with more cards than
// the viewport can show, fewer than half may exist in the tree after the
// mount, and scrolling must materialize the far end.
void main() {
  // 120 scoped cards: far more than the phone-sized viewport (360×740)
  // shows at once. Healthy under the tree fixture (their labels are
  // Births); broken as a block under an outage (the fetch refuses).
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

  Future<void> dragOverlayToEnd(WidgetTester tester) async {
    await tester.drag(
      find
          .descendant(
            of: find.byType(CustomScrollView),
            matching: find.byType(Scrollable),
          )
          .first,
      const Offset(0, -20000),
    );
    await tester.pumpAndSettle();
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

      // The far end builds when the user scrolls to it — the OVERLAY's
      // scrollable: the message list's Scrollable sits under the Stack,
      // out of hit range behind the opaque overlay.
      await dragOverlayToEnd(tester);
      expect(find.text('Card 119'), findsOneWidget);
    },
  );

  testWidgets(
    'an outage builds fewer diagnosis rows than it owns, and scrolling builds the far end',
    (tester) async {
      usePhoneSurface(tester);
      mockChatbotConfigAsset(tester, config);
      // The fetch refuses: every scope-declaring card is broken, every
      // card becomes a diagnosis row above the empty grid.
      await pumpChatBot(
        tester,
        QuickHelpTreeMockClient(tree, categoriesStatus: 500),
      );

      final caption = find.textContaining('hierarchy could not be loaded');
      expect(caption, findsWidgets);
      // LAZY: fewer than half the rows exist in the tree after the
      // mount — an eager list builds all 120.
      final built = caption.evaluate().length;
      expect(built, lessThan(cards.length ~/ 2));
      expect(find.text('Card 0'), findsOneWidget);

      // The far rows build when the user scrolls to them — the first
      // row unmounts (the viewport only holds what it shows), the row
      // count stays at the visible window.
      await dragOverlayToEnd(tester);
      expect(find.text('Card 0'), findsNothing);
      expect(caption.evaluate().length, lessThan(cards.length ~/ 2));
    },
  );
}
