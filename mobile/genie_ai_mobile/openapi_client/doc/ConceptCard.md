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
**links** | **List<String>** | Outgoing author links, as concept ids. | [optional] [default to const []]
**sources** | [**List<ConceptCardSource>**](ConceptCardSource.md) | CAP-4 originating-document identities. | [optional] [default to const []]

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


