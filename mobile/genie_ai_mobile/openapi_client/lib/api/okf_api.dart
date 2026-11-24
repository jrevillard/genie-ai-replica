//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class OkfApi {
  OkfApi([ApiClient? apiClient]) : apiClient = apiClient ?? defaultApiClient;

  final ApiClient apiClient;

  /// Resolve the serving repository holding a concept
  ///
  /// Saved-conversation restore resolver (#1817): one concept_id in, the caller-visible serving repository out — repo_id plus bundle_version carry the CAP-1 identity a pre-CAP-1 persisted citation row lost. Restricted or non-serving twin repositories are skipped, not returned; a concept_id no visible serving repo holds answers 404 CONCEPT_NOT_FOUND (foreign and fenced indistinguishable, anti-enumeration). Serves while OKF_SCOPE_MODE is open even without an okf scope (allowScopelessWhenOpen); closed mode keeps the read-scope gate.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] conceptId (required):
  ///   The concept id to resolve.
  Future<Response> apiOkfConceptsResolveRepoGetWithHttpInfo(String conceptId,) async {
    // ignore: prefer_const_declarations
    final path = r'/api/okf/concepts/resolve-repo';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

      queryParams.addAll(_queryParams('', 'concept_id', conceptId));

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      path,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
    );
  }

  /// Resolve the serving repository holding a concept
  ///
  /// Saved-conversation restore resolver (#1817): one concept_id in, the caller-visible serving repository out — repo_id plus bundle_version carry the CAP-1 identity a pre-CAP-1 persisted citation row lost. Restricted or non-serving twin repositories are skipped, not returned; a concept_id no visible serving repo holds answers 404 CONCEPT_NOT_FOUND (foreign and fenced indistinguishable, anti-enumeration). Serves while OKF_SCOPE_MODE is open even without an okf scope (allowScopelessWhenOpen); closed mode keeps the read-scope gate.
  ///
  /// Parameters:
  ///
  /// * [String] conceptId (required):
  ///   The concept id to resolve.
  Future<ResolveRepoResponse?> apiOkfConceptsResolveRepoGet(String conceptId,) async {
    final response = await apiOkfConceptsResolveRepoGetWithHttpInfo(conceptId,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'ResolveRepoResponse',) as ResolveRepoResponse;
    
    }
    return null;
  }

  /// Browse the repository's paginated concept-tree index
  ///
  /// W9 serving read: every concept of the repository as a paginated index for the citizen's browser. The page size defaults to 200 and clamps to 1..500; offset clamps to >= 0; an out-of-range offset yields an empty page with total still true. Serves while OKF_SCOPE_MODE is open even without an okf scope (allowScopelessWhenOpen); closed mode keeps the read-scope gate. The per-repo fence and publication gate apply inside: a restricted or non-serving repo answers 404 REPO_NOT_FOUND — foreign and fenced are indistinguishable (anti-enumeration).
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] repoId (required):
  ///   Repository id.
  ///
  /// * [int] offset:
  ///   Page start (0-based).
  ///
  /// * [int] limit:
  ///   Page size (clamped to 1..500).
  Future<Response> apiOkfReposRepoIdConceptTreeGetWithHttpInfo(String repoId, { int? offset, int? limit, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/okf/repos/{repo_id}/concept-tree'
      .replaceAll('{repo_id}', repoId);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    if (offset != null) {
      queryParams.addAll(_queryParams('', 'offset', offset));
    }
    if (limit != null) {
      queryParams.addAll(_queryParams('', 'limit', limit));
    }

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      path,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
    );
  }

  /// Browse the repository's paginated concept-tree index
  ///
  /// W9 serving read: every concept of the repository as a paginated index for the citizen's browser. The page size defaults to 200 and clamps to 1..500; offset clamps to >= 0; an out-of-range offset yields an empty page with total still true. Serves while OKF_SCOPE_MODE is open even without an okf scope (allowScopelessWhenOpen); closed mode keeps the read-scope gate. The per-repo fence and publication gate apply inside: a restricted or non-serving repo answers 404 REPO_NOT_FOUND — foreign and fenced are indistinguishable (anti-enumeration).
  ///
  /// Parameters:
  ///
  /// * [String] repoId (required):
  ///   Repository id.
  ///
  /// * [int] offset:
  ///   Page start (0-based).
  ///
  /// * [int] limit:
  ///   Page size (clamped to 1..500).
  Future<ConceptTreePage?> apiOkfReposRepoIdConceptTreeGet(String repoId, { int? offset, int? limit, }) async {
    final response = await apiOkfReposRepoIdConceptTreeGetWithHttpInfo(repoId,  offset: offset, limit: limit, );
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'ConceptTreePage',) as ConceptTreePage;
    
    }
    return null;
  }

  /// Fetch a concept's citizen card
  ///
  /// CAP-2 serving read: the concept document a chat citation grounded on — the body as markdown, author links and CAP-4 origin sources (an origin the document repository answers 404 for is stamped missing: true). Serves while OKF_SCOPE_MODE is open even without an okf scope (allowScopelessWhenOpen); closed mode keeps the read-scope gate. The per-repo fence and publication gate apply inside: a restricted or non-serving repo answers 404 REPO_NOT_FOUND — foreign and fenced are indistinguishable (anti-enumeration). The steward variant (full meta row plus max_doc_chars) exists server-side; citizen callers receive the ConceptCard projection only.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] repoId (required):
  ///   Repository id.
  ///
  /// * [String] conceptId (required):
  ///   Concept id.
  Future<Response> apiOkfReposRepoIdConceptsConceptIdGetWithHttpInfo(String repoId, String conceptId,) async {
    // ignore: prefer_const_declarations
    final path = r'/api/okf/repos/{repo_id}/concepts/{concept_id}'
      .replaceAll('{repo_id}', repoId)
      .replaceAll('{concept_id}', conceptId);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      path,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
    );
  }

  /// Fetch a concept's citizen card
  ///
  /// CAP-2 serving read: the concept document a chat citation grounded on — the body as markdown, author links and CAP-4 origin sources (an origin the document repository answers 404 for is stamped missing: true). Serves while OKF_SCOPE_MODE is open even without an okf scope (allowScopelessWhenOpen); closed mode keeps the read-scope gate. The per-repo fence and publication gate apply inside: a restricted or non-serving repo answers 404 REPO_NOT_FOUND — foreign and fenced are indistinguishable (anti-enumeration). The steward variant (full meta row plus max_doc_chars) exists server-side; citizen callers receive the ConceptCard projection only.
  ///
  /// Parameters:
  ///
  /// * [String] repoId (required):
  ///   Repository id.
  ///
  /// * [String] conceptId (required):
  ///   Concept id.
  Future<ConceptCard?> apiOkfReposRepoIdConceptsConceptIdGet(String repoId, String conceptId,) async {
    final response = await apiOkfReposRepoIdConceptsConceptIdGetWithHttpInfo(repoId, conceptId,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'ConceptCard',) as ConceptCard;
    
    }
    return null;
  }
}
