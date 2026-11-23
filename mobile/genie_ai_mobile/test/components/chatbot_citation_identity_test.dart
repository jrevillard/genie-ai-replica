import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/components/chat/chatbot_component.dart';

import '../helpers/chatbot_harness.dart';

/// The identity the chat surface deduplicates the citation list by.
///
/// An OKF concept's identity is the (repository, concept) PAIR: okf-server
/// resolves a concept against every candidate repository, so the same
/// concept id can live in two of them and BOTH citations are real. The
/// merge keyed on the document id alone, so the second repository's
/// citation was dropped from the list before it could ever be opened —
/// and the open key that carries the repository never saw it.
void main() {
  final tree = quickHelpTreeFixture();

  late Uint8List configBytes;

  setUpAll(() async {
    configBytes = await chatbotConfigBytesWithButtons(<Map<String, dynamic>>[]);
  });

  setUp(resetChatbotTestState);
  tearDown(resetChatbotTestState);

  testWidgets('two repositories citing the same concept keep two cards', (
    tester,
  ) async {
    final chatKey = GlobalKey<ChatBotComponentState>();
    // The callback is called with the CURRENT list each time the chat
    // surface commits one; the last call is the restored list.
    List<dynamic> related = <dynamic>[];
    final mock = ChatbotMockClient(
      tree,
      conversationMessages: const [
        {
          'role': 'assistant',
          'content': 'The first answer.',
          'metadata': {
            'source_documents': [
              {
                'source': 'okf-concept',
                'document_id': 'hadith_nawawi_36',
                'concept_id': 'hadith_nawawi_36',
                'repo_id': 'repo-1',
                'document_name': 'repo-1 row',
              },
            ],
          },
        },
        {
          'role': 'assistant',
          'content': 'The second answer.',
          'metadata': {
            'source_documents': [
              {
                'source': 'okf-concept',
                'document_id': 'hadith_nawawi_36',
                'concept_id': 'hadith_nawawi_36',
                'repo_id': 'repo-2',
                'document_name': 'repo-2 row',
              },
            ],
          },
        },
      ],
    );
    mockChatbotConfigAsset(tester, configBytes);
    await pumpChatBot(
      tester,
      mock,
      chatKey: chatKey,
      onRelatedDocumentsUpdate: (rows) => related = rows,
    );

    await chatKey.currentState!.loadConversation('conv-1');
    await tester.pumpAndSettle();

    // Both citations reach the list the sidebar shows: the same concept
    // id in two repositories is TWO sources, not one.
    expect(related.length, 2);
    expect(related.map((row) => row['repo_id']).toSet(), {'repo-1', 'repo-2'});
  });

  testWidgets('a legacy document row keeps its own identity', (tester) async {
    final chatKey = GlobalKey<ChatBotComponentState>();
    List<dynamic> related = <dynamic>[];
    final mock = ChatbotMockClient(
      tree,
      conversationMessages: const [
        {
          'role': 'assistant',
          'content': 'The first answer.',
          'metadata': {
            'source_documents': [
              {'document_id': 'doc-1', 'document_name': 'Report.pdf'},
            ],
          },
        },
        {
          'role': 'assistant',
          'content': 'The second answer.',
          'metadata': {
            'source_documents': [
              {'document_id': 'doc-1', 'document_name': 'Report.pdf'},
            ],
          },
        },
      ],
    );
    mockChatbotConfigAsset(tester, configBytes);
    await pumpChatBot(
      tester,
      mock,
      chatKey: chatKey,
      onRelatedDocumentsUpdate: (rows) => related = rows,
    );

    await chatKey.currentState!.loadConversation('conv-1');
    await tester.pumpAndSettle();

    // The legacy path is untouched: the same document id is still ONE
    // citation, whatever the source type.
    expect(related.length, 1);
  });
}
