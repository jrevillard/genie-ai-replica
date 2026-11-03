import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';

import '../helpers/chatbot_harness.dart';

// The overlay's memoized split must re-partition when the button list
// is replaced: a locale switch re-resolves the config and the overlay's
// cards must speak the NEW language's resolved titles. The memo key
// carries the button list's IDENTITY, so the reload re-runs the walk; a
// key that dropped it would freeze the cached button maps and the
// overlay would keep speaking the language the user left.
void main() {
  final ghostCard = <String, dynamic>{
    'id': 'ghost-id',
    'title': {'en': 'Ghost EN', 'es': 'Ghost ES'},
    'category': '2',
    'serviceLabels': ['Births'],
  };

  final tree = quickHelpTreeFixture();

  late Uint8List config;
  setUpAll(() async {
    config = await chatbotConfigBytesWithButtons([ghostCard]);
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
}
