import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:openapi/api.dart';

import '../providers/api_providers.dart';

/// Page size for the concept-tree index — the server's default (the route
/// clamps 1..500); Show-more pages at the loaded count.
const int conceptBrowserPageSize = 200;

/// Thin seam over the generated [OkfApi] for the concept browser: the two
/// citizen reads plus nothing else. The generated client is the only HTTP
/// idiom (the drift gate must keep seeing one client) — tests fake THIS
/// class, never the generated API.
class ConceptBrowserRepository {
  ConceptBrowserRepository(this._api);

  final OkfApi _api;

  Future<ConceptTreePage> fetchTreePage(
    String repoId, {
    required int offset,
  }) async {
    final page = await _api.apiOkfReposRepoIdConceptTreeGet(
      repoId,
      offset: offset,
      limit: conceptBrowserPageSize,
    );
    return page!;
  }

  Future<ConceptCard> fetchCard(String repoId, String conceptId) async {
    final card = await _api.apiOkfReposRepoIdConceptsConceptIdGet(
      repoId,
      conceptId,
    );
    return card!;
  }
}

final conceptBrowserRepositoryProvider = Provider<ConceptBrowserRepository>((
  ref,
) {
  return ConceptBrowserRepository(ref.watch(okfApiProvider));
});
