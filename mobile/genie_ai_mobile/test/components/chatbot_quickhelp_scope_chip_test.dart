import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../helpers/chatbot_harness.dart';

// The Quick Help scope chip (resolution D1a): pressing a Quick Help card
// makes the scope VISIBLE in the context bar — the bar cannot render for
// sidebar selections only — and REMOVABLE: its close control clears the
// Quick Help half of the scope. The filter itself stays persistent
// across typed follow-ups (parity with the web's selectedContextItems),
// so visibility is what keeps the persistent state honest.
void main() {
  final tileCard = <String, dynamic>{
    'id': 'births-id',
    'title': {'en': 'Births Card'},
    'category': '2',
    'serviceLabels': ['Births'],
  };

  final tree = quickHelpTreeFixture();

  late Uint8List config;
  setUpAll(() async {
    config = await chatbotConfigBytesWithButtons([tileCard]);
  });

  setUp(resetChatbotTestState);
  tearDown(resetChatbotTestState);

  testWidgets(
    'a Quick Help press shows the scope in the context bar, and the close control clears it',
    (tester) async {
      usePhoneSurface(tester);
      mockChatbotConfigAsset(tester, config);
      await pumpChatBot(tester, QuickHelpTreeMockClient(tree));

      // No selection yet: no context bar.
      expect(find.textContaining('Context:'), findsNothing);

      // The card declares a scope and carries no hidden prompt: the
      // press installs the scope WITHOUT auto-sending.
      await tester.tap(find.text('Births Card'));
      await tester.pumpAndSettle();

      // The scope is VISIBLE: the bar carries the card's title — the
      // same name the web's chip shows — and the close control.
      expect(find.textContaining('Births Card'), findsOneWidget);
      expect(find.byIcon(Icons.close), findsOneWidget);

      // The close control removes the scope: bar and title go.
      await tester.tap(find.byIcon(Icons.close));
      await tester.pumpAndSettle();

      expect(find.textContaining('Births Card'), findsNothing);
    },
  );
}
