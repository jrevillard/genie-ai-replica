import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
import 'package:http/http.dart' as http;

import '../helpers/chatbot_harness.dart';

// The overlay's memoized split must re-partition when the inputs it
// reads move. Three arrivals exercise the three volatile keys:
//
// - a locale switch reloads the button list: the overlay's cards must
//   speak the NEW language's resolved titles — a key that dropped the
//   button list's identity would freeze the cached maps and keep
//   speaking the language the user left;
// - the hierarchy lands while the buttons are already loaded: the split
//   ran with the PENDING verdict (which says nothing about a button),
//   and the resolver's arrival re-runs the walk — a key that dropped the
//   resolver's identity would freeze the pending verdicts and render
//   cards the tree judges broken as healthy tiles forever;
// - the hierarchy FAILS while the buttons are already loaded: the
//   outage flag flips and every scope-declaring card becomes a VISIBLE
//   failure — a key that dropped the flag would keep the pending
//   verdicts and show healthy tiles through an outage.
void main() {
  // A card whose declared label the tree fixture does not carry: healthy
  // while the hierarchy is pending, broken once it arrives.
  final ghostCard = <String, dynamic>{
    'id': 'ghost-id',
    'title': {'en': 'Ghost EN', 'es': 'Ghost ES'},
    'category': '2',
    'serviceLabels': ['Births'],
  };

  // The same card declaring a label no tree carries: the arrival of the
  // hierarchy is what breaks it.
  final ghostLabelCard = <String, dynamic>{
    'id': 'ghost-label-id',
    'title': {'en': 'Ghost Label'},
    'category': '2',
    'serviceLabels': ['Ghost'],
  };

  final tree = quickHelpTreeFixture();

  late Uint8List config;
  late Uint8List ghostLabelConfig;
  setUpAll(() async {
    config = await chatbotConfigBytesWithButtons([ghostCard]);
    ghostLabelConfig = await chatbotConfigBytesWithButtons([ghostLabelCard]);
  });

  setUp(resetChatbotTestState);
  tearDown(resetChatbotTestState);

  testWidgets(
    'the split re-partitions when a locale switch reloads the buttons',
    (tester) async {
      usePhoneSurface(tester);
      mockChatbotConfigAsset(tester, config);
      await pumpChatBot(
        tester,
        QuickHelpTreeMockClient(tree),
        supportedLocales: const [Locale('en'), Locale('es')],
      );

      // Mounted under EN: the tile speaks the EN title.
      expect(
        find.ancestor(
          of: find.text('Ghost EN'),
          matching: find.byType(SliverGrid),
        ),
        findsOneWidget,
      );

      // The locale switch reloads the buttons in ES: the same card stays
      // a healthy tile — the scope verdicts are locale-independent — but
      // it must speak the ES title, so the split re-runs.
      I18nService().changeLanguage('es');
      await tester.pumpAndSettle();

      expect(
        find.ancestor(
          of: find.text('Ghost ES'),
          matching: find.byType(SliverGrid),
        ),
        findsOneWidget,
      );
      expect(find.text('Ghost EN'), findsNothing);
    },
  );

  testWidgets('the split re-partitions when the hierarchy arrives mid-mount', (
    tester,
  ) async {
    usePhoneSurface(tester);
    mockChatbotConfigAsset(tester, ghostLabelConfig);
    final mock = _DeferredTreeMockClient();
    // No settle: the tree is gated, and pumpAndSettle would never end.
    await pumpChatBot(tester, mock, settle: false);
    // The asset config settles within a few frames; the tree stays
    // gated. The overlay stays hidden until the tree settles
    // (_treeSettled), so there is nothing visible to assert yet — the
    // pending split is what a dropped resolver key would freeze.
    await tester.pump();
    await tester.pump();
    await tester.pump();

    // The hierarchy lands: the resolver's identity moves, the split
    // re-runs, the overlay mounts, and the ghost label's card presents
    // its diagnosis instead of a healthy tile.
    mock.completeTree(tree);
    await tester.pumpAndSettle();

    final caption = find.textContaining('no longer exists');
    expect(caption, findsOneWidget);
    expect(
      find.descendant(
        of: find.byType(SliverGrid),
        matching: find.text('Ghost Label'),
      ),
      findsNothing,
    );
  });

  testWidgets('the split re-partitions when the hierarchy fails mid-mount', (
    tester,
  ) async {
    usePhoneSurface(tester);
    mockChatbotConfigAsset(tester, ghostLabelConfig);
    final mock = _DeferredTreeMockClient();
    await pumpChatBot(tester, mock, settle: false);
    // Buttons loaded, hierarchy still gated: the pending split says
    // nothing about the card.
    await tester.pump();
    await tester.pump();
    await tester.pump();

    // The fetch REFUSES: the outage flag flips, and the outage — not a
    // configuration problem — is what the card must name.
    mock.completeTree(tree, 500);
    await tester.pumpAndSettle();

    final caption = find.textContaining('hierarchy could not be loaded');
    expect(caption, findsOneWidget);
    expect(
      find.descendant(
        of: find.byType(SliverGrid),
        matching: find.text('Ghost Label'),
      ),
      findsNothing,
    );
  });
}

/// The categories endpoint answers only when the test completes the
/// gate; every other path 404s.
class _DeferredTreeMockClient extends http.BaseClient {
  final Completer<http.StreamedResponse> _gate = Completer();

  void completeTree(List<dynamic> tree, [int status = 200]) {
    _gate.complete(httpResponseJson(tree, status));
  }

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final path = request.url.path;
    if (path.contains('/api/service-categories/categories')) {
      return _gate.future;
    }
    return httpResponseJson(<String, dynamic>{}, 404);
  }
}
