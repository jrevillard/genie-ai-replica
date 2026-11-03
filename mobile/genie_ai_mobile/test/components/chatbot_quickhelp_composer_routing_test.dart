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

  // A broken composer entry: no title in the loaded language — the
  // parse keeps it, the partition makes it broken.
  final brokenComposerCard = <String, dynamic>{
    'id': 'broken-composer-id',
    'title': {'en': ''},
    'category': '2',
    'serviceLabels': ['Births'],
    'placement': 'composer',
  };

  // A composer-only entry whose declared scope the tree cannot
  // verify: broken by the RESOLVER (the title is present), the case
  // the gate's title check cannot see.
  final scopeBrokenComposerCard = <String, dynamic>{
    'id': 'scope-broken-composer-id',
    'title': {'en': 'Just Chat'},
    'category': '99',
    'serviceLabels': ['Gone'],
    'placement': 'composer',
  };

  late Uint8List config;
  late Uint8List composerOnlyConfig;
  late Uint8List brokenComposerOnlyConfig;
  late Uint8List scopeBrokenComposerOnlyConfig;
  late Uint8List brokenComposerConfig;
  setUpAll(() async {
    config = await chatbotConfigBytesWithButtons([
      composerCard,
      tileCard,
      tileCard2,
    ]);
    composerOnlyConfig = await chatbotConfigBytesWithButtons([composerCard]);
    brokenComposerOnlyConfig = await chatbotConfigBytesWithButtons([
      brokenComposerCard,
    ]);
    scopeBrokenComposerOnlyConfig = await chatbotConfigBytesWithButtons([
      scopeBrokenComposerCard,
    ]);
    brokenComposerConfig = await chatbotConfigBytesWithButtons([
      brokenComposerCard,
      tileCard,
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
        matching: find.byType(SliverGrid),
      ),
      findsOneWidget,
    );
    expect(
      find.ancestor(
        of: find.text('Births Card 2'),
        matching: find.byType(SliverGrid),
      ),
      findsOneWidget,
    );

    // The composer-placed card is nowhere: no tile, no composer
    // surface, no leftover text.
    expect(find.text('Just Chat'), findsNothing);
  });

  testWidgets(
    'a composer-only configuration mounts no overlay: no surface, no empty shell',
    (tester) async {
      usePhoneSurface(tester);
      mockChatbotConfigAsset(tester, composerOnlyConfig);
      await pumpChatBot(tester, QuickHelpTreeMockClient(tree));

      // Every entry targets the composer the platform lacks — the
      // overlay does not mount to render the heading above an empty
      // grid.
      expect(find.byType(SliverGrid), findsNothing);
      expect(find.text('Just Chat'), findsNothing);
    },
  );

  testWidgets(
    'a broken composer-only configuration still mounts the diagnosis row',
    (tester) async {
      usePhoneSurface(tester);
      mockChatbotConfigAsset(tester, brokenComposerOnlyConfig);
      await pumpChatBot(tester, QuickHelpTreeMockClient(tree));

      // No surface for the entry itself, but its config defect is a
      // VISIBLE failure: the title-missing gate mounts the overlay so
      // the diagnosis row has a channel.
      final caption = find.textContaining('no title in this language');
      expect(caption, findsOneWidget);
      expect(
        find.ancestor(of: caption, matching: find.byType(SliverGrid)),
        findsNothing,
      );
    },
  );

  testWidgets(
    'a scope-broken composer-only configuration mounts its diagnosis row',
    (tester) async {
      usePhoneSurface(tester);
      mockChatbotConfigAsset(tester, scopeBrokenComposerOnlyConfig);
      await pumpChatBot(tester, QuickHelpTreeMockClient(tree));

      // The declared category/labels left the tree: the resolver
      // verdict is broken, and the overlay mounts so the diagnosis row
      // has a channel — the gate reads the derived partition, not a
      // title heuristic.
      final caption = find.textContaining('category no longer exists');
      expect(caption, findsOneWidget);
      // The diagnosis row is not a grid tile (the empty grid widget
      // itself still mounts — the outage presentation's own shape).
      expect(
        find.ancestor(of: caption, matching: find.byType(SliverGrid)),
        findsNothing,
      );
    },
  );

  testWidgets(
    'a broken composer entry keeps its diagnosis row above the grid',
    (tester) async {
      usePhoneSurface(tester);
      mockChatbotConfigAsset(tester, brokenComposerConfig);
      await pumpChatBot(tester, QuickHelpTreeMockClient(tree));

      // The composer entry has no surface to occupy, but its config
      // defect is a VISIBLE failure: the caption renders outside the
      // grid, the healthy tile stays a grid tile.
      final caption = find.textContaining('no title in this language');
      expect(caption, findsOneWidget);
      expect(
        find.ancestor(of: caption, matching: find.byType(SliverGrid)),
        findsNothing,
      );
      expect(
        find.ancestor(
          of: find.text('Births Card'),
          matching: find.byType(SliverGrid),
        ),
        findsOneWidget,
      );
    },
  );
}
