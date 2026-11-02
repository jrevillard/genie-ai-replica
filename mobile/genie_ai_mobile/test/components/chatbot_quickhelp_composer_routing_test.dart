import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../helpers/chatbot_harness.dart';

// The composer-placed Quick Help entry never becomes a mobile tile. The
// web routes `placement: "composer"` entries into its welcome composer
// and its `tileButtons` filter keeps them out of the grid; the mobile
// has NO composer surface, so the parse drops the entry — the grid
// renders the remaining tiles, never a duplicated just-chat card.
void main() {
  // The shape every web product config ships: the just-chat entry
  // declares `placement: "composer"`, the category-less card.
  final composerCard = <String, dynamic>{
    'id': 'just-chat',
    'title': {'en': 'Just Chat'},
    'placement': 'composer',
  };

  final tileCard = <String, dynamic>{
    'id': 'births-id',
    'title': {'en': 'Births Card'},
    'category': '2',
    'serviceLabels': ['Births'],
  };

  final tileCard2 = <String, dynamic>{
    'id': 'births-2-id',
    'title': {'en': 'Births Card 2'},
    'category': '2',
    'serviceLabels': ['Births'],
  };

  final tree = quickHelpTreeFixture();

  late Uint8List config;
  setUpAll(() async {
    config = await chatbotConfigBytesWithButtons([
      composerCard,
      tileCard,
      tileCard2,
    ]);
  });

  setUp(resetChatbotTestState);
  tearDown(resetChatbotTestState);

  testWidgets('the composer-placed card is absent from the tile grid', (
    tester,
  ) async {
    usePhoneSurface(tester);
    mockChatbotConfigAsset(tester, config);
    await pumpChatBot(tester, QuickHelpTreeMockClient(tree));

    // The two tile cards made the grid.
    expect(
      find.ancestor(
        of: find.text('Births Card'),
        matching: find.byType(GridView),
      ),
      findsOneWidget,
    );
    expect(
      find.ancestor(
        of: find.text('Births Card 2'),
        matching: find.byType(GridView),
      ),
      findsOneWidget,
    );

    // The composer-placed card is nowhere: no tile, no composer
    // surface, no leftover text.
    expect(find.text('Just Chat'), findsNothing);
  });
}
