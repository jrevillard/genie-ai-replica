//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

import 'package:openapi/api.dart';
import 'package:test/test.dart';


/// tests for OkfApi
void main() {
  // final instance = OkfApi();

  group('tests for OkfApi', () {
    // Resolve the serving repository holding a concept
    //
    // Saved-conversation restore resolver (#1817): one concept_id in, the caller-visible serving repository out — repo_id plus bundle_version carry the CAP-1 identity a pre-CAP-1 persisted citation row lost. Restricted or non-serving twin repositories are skipped, not returned; a concept_id no visible serving repo holds answers 404 CONCEPT_NOT_FOUND (foreign and fenced indistinguishable, anti-enumeration). Serves while OKF_SCOPE_MODE is open even without an okf scope (allowScopelessWhenOpen); closed mode keeps the read-scope gate.
    //
    //Future<ResolveRepoResponse> apiOkfConceptsResolveRepoGet(String conceptId) async
    test('test apiOkfConceptsResolveRepoGet', () async {
      // TODO
    });

    // Browse the repository's paginated concept-tree index
    //
    // W9 serving read: every concept of the repository as a paginated index for the citizen's browser. The page size defaults to 200 and clamps to 1..500; offset clamps to >= 0; an out-of-range offset yields an empty page with total still true. Serves while OKF_SCOPE_MODE is open even without an okf scope (allowScopelessWhenOpen); closed mode keeps the read-scope gate. The per-repo fence and publication gate apply inside: a restricted or non-serving repo answers 404 REPO_NOT_FOUND — foreign and fenced are indistinguishable (anti-enumeration).
    //
    //Future<ConceptTreePage> apiOkfReposRepoIdConceptTreeGet(String repoId, { int offset, int limit }) async
    test('test apiOkfReposRepoIdConceptTreeGet', () async {
      // TODO
    });

    // Fetch a concept's citizen card
    //
    // CAP-2 serving read: the concept document a chat citation grounded on — the body as markdown, author links and CAP-4 origin sources (an origin the document repository answers 404 for is stamped missing: true). Serves while OKF_SCOPE_MODE is open even without an okf scope (allowScopelessWhenOpen); closed mode keeps the read-scope gate. The per-repo fence and publication gate apply inside: a restricted or non-serving repo answers 404 REPO_NOT_FOUND — foreign and fenced are indistinguishable (anti-enumeration). The steward variant (full meta row plus max_doc_chars) exists server-side; citizen callers receive the ConceptCard projection only.
    //
    //Future<ConceptCard> apiOkfReposRepoIdConceptsConceptIdGet(String repoId, String conceptId) async
    test('test apiOkfReposRepoIdConceptsConceptIdGet', () async {
      // TODO
    });

  });
}
