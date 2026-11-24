# openapi.api.OkfApi

## Load the API package
```dart
import 'package:openapi/api.dart';
```

All URIs are relative to *https://localhost*

Method | HTTP request | Description
------------- | ------------- | -------------
[**apiOkfConceptsResolveRepoGet**](OkfApi.md#apiokfconceptsresolverepoget) | **GET** /api/okf/concepts/resolve-repo | Resolve the serving repository holding a concept
[**apiOkfReposRepoIdConceptTreeGet**](OkfApi.md#apiokfreposrepoidconcepttreeget) | **GET** /api/okf/repos/{repo_id}/concept-tree | Browse the repository's paginated concept-tree index
[**apiOkfReposRepoIdConceptsConceptIdGet**](OkfApi.md#apiokfreposrepoidconceptsconceptidget) | **GET** /api/okf/repos/{repo_id}/concepts/{concept_id} | Fetch a concept's citizen card


# **apiOkfConceptsResolveRepoGet**
> ResolveRepoResponse apiOkfConceptsResolveRepoGet(conceptId)

Resolve the serving repository holding a concept

Saved-conversation restore resolver (#1817): one concept_id in, the caller-visible serving repository out — repo_id plus bundle_version carry the CAP-1 identity a pre-CAP-1 persisted citation row lost. Restricted or non-serving twin repositories are skipped, not returned; a concept_id no visible serving repo holds answers 404 CONCEPT_NOT_FOUND (foreign and fenced indistinguishable, anti-enumeration). Serves while OKF_SCOPE_MODE is open even without an okf scope (allowScopelessWhenOpen); closed mode keeps the read-scope gate.

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = OkfApi();
final conceptId = conceptId_example; // String | The concept id to resolve.

try {
    final result = api_instance.apiOkfConceptsResolveRepoGet(conceptId);
    print(result);
} catch (e) {
    print('Exception when calling OkfApi->apiOkfConceptsResolveRepoGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **conceptId** | **String**| The concept id to resolve. | 

### Return type

[**ResolveRepoResponse**](ResolveRepoResponse.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiOkfReposRepoIdConceptTreeGet**
> ConceptTreePage apiOkfReposRepoIdConceptTreeGet(repoId, offset, limit)

Browse the repository's paginated concept-tree index

W9 serving read: every concept of the repository as a paginated index for the citizen's browser. The page size defaults to 200 and clamps to 1..500; offset clamps to >= 0; an out-of-range offset yields an empty page with total still true. Serves while OKF_SCOPE_MODE is open even without an okf scope (allowScopelessWhenOpen); closed mode keeps the read-scope gate. The per-repo fence and publication gate apply inside: a restricted or non-serving repo answers 404 REPO_NOT_FOUND — foreign and fenced are indistinguishable (anti-enumeration).

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = OkfApi();
final repoId = repoId_example; // String | Repository id.
final offset = 56; // int | Page start (0-based).
final limit = 56; // int | Page size (clamped to 1..500).

try {
    final result = api_instance.apiOkfReposRepoIdConceptTreeGet(repoId, offset, limit);
    print(result);
} catch (e) {
    print('Exception when calling OkfApi->apiOkfReposRepoIdConceptTreeGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **repoId** | **String**| Repository id. | 
 **offset** | **int**| Page start (0-based). | [optional] [default to 0]
 **limit** | **int**| Page size (clamped to 1..500). | [optional] [default to 200]

### Return type

[**ConceptTreePage**](ConceptTreePage.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiOkfReposRepoIdConceptsConceptIdGet**
> ConceptCard apiOkfReposRepoIdConceptsConceptIdGet(repoId, conceptId)

Fetch a concept's citizen card

CAP-2 serving read: the concept document a chat citation grounded on — the body as markdown, author links and CAP-4 origin sources (an origin the document repository answers 404 for is stamped missing: true). Serves while OKF_SCOPE_MODE is open even without an okf scope (allowScopelessWhenOpen); closed mode keeps the read-scope gate. The per-repo fence and publication gate apply inside: a restricted or non-serving repo answers 404 REPO_NOT_FOUND — foreign and fenced are indistinguishable (anti-enumeration). The steward variant (full meta row plus max_doc_chars) exists server-side; citizen callers receive the ConceptCard projection only.

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = OkfApi();
final repoId = repoId_example; // String | Repository id.
final conceptId = conceptId_example; // String | Concept id.

try {
    final result = api_instance.apiOkfReposRepoIdConceptsConceptIdGet(repoId, conceptId);
    print(result);
} catch (e) {
    print('Exception when calling OkfApi->apiOkfReposRepoIdConceptsConceptIdGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **repoId** | **String**| Repository id. | 
 **conceptId** | **String**| Concept id. | 

### Return type

[**ConceptCard**](ConceptCard.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

