import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';

import '../helpers/chatbot_harness.dart';

// The LAYOUT of the Quick Help failure presentation (issue #1224). The
// grid tile's height is the delegate's childAspectRatio (default 3.5 —
// a wide, short tile): a broken card's diagnosis caption gets a box
// smaller than one textXs line at the shipped default layout, and the
// text is hard-clipped mid-glyph — the ellipsis of the clamp can never
// render. The icon+title row above it is a non-flex child, so at an
// extreme accessibility font scale it alone can outgrow the fixed tile
// and the build throws a RenderFlex overflow.
//
// These tests assert STRUCTURE and RESOLVED GEOMETRY on a phone-sized
// surface (360×740 logical — the shipped 2-column default gives a
// ~159×45 tile): the diagnosis must leave the fixed-aspect grid (its
// row's height follows its text), and the healthy tile must survive a
// font scale no user-set value exceeds. The rendered pixels in both
// themes are verified by a human on a device — the mobile Visual
// Fidelity rule; no widget harness asserts them here.
void main() {
  // The healthy cards: id'd scoped cards whose titles resolve under
  // every scenario's locale. DISTINCT ids — the load dedupes on the
  // id, so two same-id cards are one card.
  final healthyCard = <String, dynamic>{
    'id': 'births-id',
    'title': {'en': 'Births Card'},
    'category': '2',
    'serviceLabels': ['Births'],
  };

  final healthyCard2 = <String, dynamic>{
    'id': 'births-2-id',
    'title': {'en': 'Births Card'},
    'category': '2',
    'serviceLabels': ['Births'],
  };

  // The hand-edited-config defect: a card whose title is EMPTY in the
  // loaded language — the card is broken (quickHelpCardBroken) while
  // its neighbours are healthy.
  final emptyTitleCard = <String, dynamic>{
    'id': 'broken-id',
    'title': {'en': ''},
    'category': '2',
    'serviceLabels': ['Births'],
  };

  final tree = quickHelpTreeFixture();

  late Uint8List mixedConfig;
  late Uint8List pairConfig;
  late Uint8List singleConfig;

  setUpAll(() async {
    mixedConfig = await chatbotConfigBytesWithButtons([
      healthyCard,
      emptyTitleCard,
    ]);
    pairConfig = await chatbotConfigBytesWithButtons([
      healthyCard,
      healthyCard2,
    ]);
    singleConfig = await chatbotConfigBytesWithButtons([healthyCard]);
  });

  // The harness state is BOTH the mount's initialization (a fresh
  // singleton has no tokens) and the previous test's teardown.
  setUp(resetChatbotTestState);
  tearDown(resetChatbotTestState);

  /// The phone-sized surface: at the desktop-sized default the tiles
  /// are wide enough to hide the defect the issue reports.
  testWidgets(
    'a broken card leaves the grid and presents its diagnosis with real height',
    (tester) async {
      usePhoneSurface(tester);
      mockChatbotConfigAsset(tester, mixedConfig);
      await pumpChatBot(tester, QuickHelpTreeMockClient(tree));

      // The title-missing card is broken: its caption names the config
      // defect. The healthy card is not broken and carries no caption.
      final caption = find.textContaining('no title in this language');
      expect(caption, findsOneWidget);

      // The diagnosis is NOT a fixed-aspect grid tile: the caption
      // lives outside the sliver grid, whose cells cannot grow with it.
      expect(
        find.ancestor(of: caption, matching: find.byType(SliverGrid)),
        findsNothing,
      );

      // Real vertical room: at least ONE full textXs line (11.2 * 1.0,
      // line height above the glyph box) — the box the old grid cell
      // gave the caption was smaller than that, clipping mid-glyph.
      expect(tester.getSize(caption).height, greaterThanOrEqualTo(14.0));

      // The whole diagnosis, not a capped prefix: the row's height
      // follows the text, so the caption carries NO maxLines — and it
      // renders in the danger token, the card's failure colour.
      final captionWidget = caption.evaluate().single.widget as Text;
      expect(captionWidget.maxLines, isNull);
      expect(captionWidget.style?.color, ThemeManager().tokens.danger);

      // The healthy card stayed a grid tile.
      expect(
        find.ancestor(
          of: find.text('Births Card'),
          matching: find.byType(SliverGrid),
        ),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'when the hierarchy is out, every card is broken and no diagnosis sits in the grid',
    (tester) async {
      usePhoneSurface(tester);
      mockChatbotConfigAsset(tester, pairConfig);
      // A tree the fetch refuses: every scope is unverifiable, every
      // card broken.
      await pumpChatBot(
        tester,
        QuickHelpTreeMockClient(tree, categoriesStatus: 500),
      );

      final caption = find.textContaining('hierarchy could not be loaded');
      expect(caption, findsNWidgets(2));
      expect(
        find.ancestor(of: caption, matching: find.byType(SliverGrid)),
        findsNothing,
      );
      // The grid still exists for the healthy case, but hosts no card:
      // a card the outage broke is not a fixed-aspect tile anymore. An
      // EMPTY sliver grid paints nothing — the default finders treat it
      // as offstage — so this half must include the invisible slivers.
      expect(find.byType(SliverGrid, skipOffstage: false), findsOneWidget);
      expect(
        find.descendant(
          of: find.byType(SliverGrid, skipOffstage: false),
          matching: find.text('Births Card'),
        ),
        findsNothing,
      );
    },
  );

  testWidgets(
    'the diagnosis keeps one full line at a raised accessibility font scale',
    (tester) async {
      usePhoneSurface(tester);
      // fontScale = fontSize / 50 → 100 renders text at 2.0×.
      ThemeManager().setFontSize(100.0);
      mockChatbotConfigAsset(tester, pairConfig);
      await pumpChatBot(
        tester,
        QuickHelpTreeMockClient(tree, categoriesStatus: 500),
      );

      final caption = find.textContaining('hierarchy could not be loaded');
      expect(caption, findsNWidgets(2));
      // One textXs line at 2.0× (11.2 * 2.0): the row's height follows
      // the scaled text instead of clipping it. The HEIGHT alone is the
      // claim — an ordering matcher over a whole Size has no meaning.
      for (final element in caption.evaluate()) {
        expect(element.size!.height, greaterThanOrEqualTo(22.0));
      }
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('the healthy tile survives an extreme accessibility font scale', (
    tester,
  ) async {
    usePhoneSurface(tester);
    // fontScale 3.0: the icon+title row alone outgrows the fixed
    // tile when it is not a flex child — the tile's build must not
    // throw a RenderFlex overflow.
    ThemeManager().setFontSize(150.0);
    mockChatbotConfigAsset(tester, singleConfig);
    await pumpChatBot(tester, QuickHelpTreeMockClient(tree));

    // The build survived: no overflow exception surfaced.
    expect(tester.takeException(), isNull);
    // The clamp is structural: the header is a FLEX child of the
    // tile's column, so the fixed tile bounds it instead of the row
    // forcing the column past the tile.
    expect(
      find.ancestor(
        of: find.text('Births Card'),
        matching: find.byType(Flexible),
      ),
      findsWidgets,
    );
  });
}
