import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:openapi/api.dart';

import '../helpers/chatbot_harness.dart';

// The non-streaming fallback speaks the SAME scope as the streaming
// path: `_sendNonStreaming` used to build a bare `QueryContext(language)`
// — the Quick Help labels and the category label were silently dropped
// from the wire, so the fallback's question answered over the WHOLE
// corpus while the context bar promised a filtered one. The captured
// POST bodies here assert what actually goes out.
//
// The labels stay PERSISTENT (D1a): the second capture — sent after the
// chip's close control cleared the scope — asserts the clear reaches the
// wire as an empty filter, not that the labels were reset after a send.
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

  /// The queries POST bodies this scenario's mock captured, in order.
  List<Map<String, dynamic>> capturedBodies(List<String> bodies) =>
      bodies.map((b) => jsonDecode(b) as Map<String, dynamic>).toList();

  testWidgets(
    'the non-streaming send carries the Quick Help labels, and the chip clear empties the filter',
    (tester) async {
      usePhoneSurface(tester);
      mockChatbotConfigAsset(tester, config);
      final bodies = <String>[];
      final mock = _QueriesCapturingMockClient(tree, bodies);
      await pumpChatBot(
        tester,
        mock,
        queriesApi: QueriesApi(ApiClient()..client = mock),
      );

      // The scope card installs the filter without auto-sending.
      await tester.tap(find.text('Births Card'));
      await tester.pumpAndSettle();

      // A typed follow-up goes out non-streaming (no httpClient): the
      // wire carries the card's scope.
      await tester.enterText(find.byType(TextField).first, 'tomato question');
      await tester.tap(find.byIcon(Icons.send));
      await tester.pumpAndSettle();

      expect(bodies, hasLength(1));
      final first = capturedBodies(bodies).single;
      final context = first['context'] as Map<String, dynamic>;
      expect(context['serviceLabels'], ['Births']);
      expect(context['categoryLabel'], 'Civil Registry');
      // The query MODE parity too: a scoped payload is a
      // conversation-with-context-labels one, the same mode the
      // streaming path declares for the identical scope.
      expect(first['contextOption'], 'conversation-with-context-labels');

      // The chip's close control clears the scope; the NEXT typed
      // message goes out unfiltered — the clear reached the wire.
      await tester.tap(find.byIcon(Icons.close));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).first, 'follow-up');
      await tester.tap(find.byIcon(Icons.send));
      await tester.pumpAndSettle();

      expect(bodies, hasLength(2));
      final second = capturedBodies(bodies).last;
      final cleared = second['context'] as Map<String, dynamic>;
      expect(cleared['serviceLabels'], isEmpty);
      expect(cleared['categoryLabel'], anyOf(isNull, isEmpty));
      // The cleared scope is an unscoped query — the plain mode.
      expect(second['contextOption'], 'single-message');
    },
  );
}

/// The harness tree client extended with a CAPTURING queries endpoint:
/// every /api/queries POST body is recorded verbatim and answered with
/// one 201 query (the shape `_sendNonStreaming` reads); the tree route
/// and the 404 fallback stay in the harness's ONE copy.
class _QueriesCapturingMockClient extends QuickHelpTreeMockClient {
  _QueriesCapturingMockClient(super.tree, this.bodies);

  final List<String> bodies;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    if (request.url.path.endsWith('/api/queries')) {
      bodies.add(utf8.decode((request as http.Request).bodyBytes));
      return httpResponseJson(<String, dynamic>{
        'queryId': 'q-1',
        'response': 'Answer text',
        'metadata': <String, dynamic>{'sources': <dynamic>[]},
      }, 201);
    }
    return super.send(request);
  }
}
