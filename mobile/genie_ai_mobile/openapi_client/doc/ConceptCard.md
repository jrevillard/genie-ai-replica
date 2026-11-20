# openapi.model.ConceptCard

## Load the model package
```dart
import 'package:openapi/api.dart';
```

## Properties
Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**repoId** | **String** |  | 
**conceptId** | **String** |  | 
**graphName** | **String** |  | [optional] 
**bundleVersion** | **String** |  | [optional] 
**title** | **String** |  | 
**labels** | **List<String>** |  | [optional] [default to const []]
**summary** | **String** |  | [optional] 
**body** | **String** | The concept document body — markdown, never raw HTML. | [optional] 
**links** | [**List<ConceptCardLink>**](ConceptCardLink.md) | Outgoing author links as SERVED — the meta row's field copied verbatim, so rows carry the author-link OBJECT shape ({to_concept_id, label}; legacy rows may carry {target, label} with a .md path). NOT a bare-string array: the 2026-11-19 mobile crash was exactly this lie (the generated Dart client cast the object row to String and threw mid-render). | [optional] [default to const []]
**sources** | [**List<ConceptCardSource>**](ConceptCardSource.md) | CAP-4 originating-document identities. | [optional] [default to const []]

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


