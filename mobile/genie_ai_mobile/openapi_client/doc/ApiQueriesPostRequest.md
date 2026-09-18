# openapi.model.ApiQueriesPostRequest

## Load the model package
```dart
import 'package:openapi/api.dart';
```

## Properties
Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**sessionId** | **String** | ID of the current session | 
**text** | **String** | The query text (required for single-message mode) | [optional] 
**messages** | [**List<ApiQueriesPostRequestMessagesInner>**](ApiQueriesPostRequestMessagesInner.md) | Full conversation history (required for conversation mode) | [optional] [default to const []]
**context** | [**ApiQueriesPostRequestContext**](ApiQueriesPostRequestContext.md) |  | [optional] 
**contextOption** | **String** | Query mode (defaults to env or single-message) | [optional] [default to 'single-message']
**categoryId** | **String** | Category ID for the query | [optional] 
**serviceId** | **String** | Service ID for the query | [optional] 
**timestamp** | [**DateTime**](DateTime.md) | Timestamp for the query (defaults to now) | [optional] 

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


