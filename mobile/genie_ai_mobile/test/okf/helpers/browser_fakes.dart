import 'dart:async';

import 'package:genie_ai_mobile/okf/concept_browser_repository.dart';
import 'package:openapi/api.dart';

/// Manual fake over the repository seam (house pattern — no mocking
/// package): canned pages/cards, throwables per repo/concept, and a
/// completer arm so a test can hold a response open to prove the
/// stale-guard. Shared by the controller and screen widget tests.
class FakeConceptBrowserRepository implements ConceptBrowserRepository {
  final Map<String, ConceptTreePage> pagesByRepo = {};
  final Map<String, Map<String, ConceptCard>> cardsByRepo = {};
  final Map<String, Object> treeThrows = {};
  final Map<String, Object> cardThrows = {};
  final Map<String, Completer<ConceptTreePage>> heldTrees = {};
  int treeCalls = 0;
  int cardCalls = 0;

  Completer<ConceptTreePage> holdTree(String repoId) {
    final completer = Completer<ConceptTreePage>();
    heldTrees[repoId] = completer;
    return completer;
  }

  @override
  Future<ConceptTreePage> fetchTreePage(String repoId, {required int offset}) async {
    treeCalls++;
    final held = heldTrees[repoId];
    if (held != null) return held.future;
    final throwable = treeThrows[repoId];
    if (throwable != null) throw throwable;
    return pagesByRepo[repoId]!;
  }

  @override
  Future<ConceptCard> fetchCard(String repoId, String conceptId) async {
    cardCalls++;
    final throwable = cardThrows[conceptId];
    if (throwable != null) throw throwable;
    return cardsByRepo[repoId]![conceptId]!;
  }
}

ConceptTreePage page(int total, List<ConceptTreeRow> rows) =>
    ConceptTreePage(total: total, offset: 0, limit: conceptBrowserPageSize, concepts: rows);

ConceptTreeRow row(String id) =>
    ConceptTreeRow(conceptId: id, title: 'Title $id', isIndex: false, indexStatus: 'indexed');

ConceptCard card(String repoId, String id, {String? body, List<String>? links}) => ConceptCard(
      repoId: repoId,
      conceptId: id,
      title: 'Title $id',
      body: body ?? 'Body of $id',
      links: links ?? const [],
    );
