# openapi.api.QueriesApi

## Load the API package
```dart
import 'package:openapi/api.dart';
```

All URIs are relative to *https://localhost*

Method | HTTP request | Description
------------- | ------------- | -------------
[**apiQueriesGet**](QueriesApi.md#apiqueriesget) | **GET** /api/queries | Search queries
[**apiQueriesPost**](QueriesApi.md#apiqueriespost) | **POST** /api/queries | Create a new query
[**apiQueriesQueryIdAnsweredPatch**](QueriesApi.md#apiqueriesqueryidansweredpatch) | **PATCH** /api/queries/{queryId}/answered | Mark query as answered
[**apiQueriesQueryIdConversationPost**](QueriesApi.md#apiqueriesqueryidconversationpost) | **POST** /api/queries/{queryId}/conversation | Create conversation from query
[**apiQueriesQueryIdConversationsGet**](QueriesApi.md#apiqueriesqueryidconversationsget) | **GET** /api/queries/{queryId}/conversations | Get conversations for a query
[**apiQueriesQueryIdFeedbackPost**](QueriesApi.md#apiqueriesqueryidfeedbackpost) | **POST** /api/queries/{queryId}/feedback | Add feedback to a query
[**apiQueriesQueryIdGet**](QueriesApi.md#apiqueriesqueryidget) | **GET** /api/queries/{queryId} | Get query by ID
[**apiQueriesQueryIdLinkMessageIdPost**](QueriesApi.md#apiqueriesqueryidlinkmessageidpost) | **POST** /api/queries/{queryId}/link/{messageId} | Link query to message
[**apiQueriesQueryIdResponsetimePatch**](QueriesApi.md#apiqueriesqueryidresponsetimepatch) | **PATCH** /api/queries/{queryId}/responsetime | Update query response time


# **apiQueriesGet**
> ApiQueriesGet200Response apiQueriesGet(limit, offset, sessionId, text, categoryId, serviceId, isAnswered, startDate, endDate)

Search queries

Searches queries based on various criteria with pagination

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = QueriesApi();
final limit = 56; // int | Number of queries per page
final offset = 56; // int | Offset for pagination
final sessionId = sessionId_example; // String | Filter by session ID
final text = text_example; // String | Filter by text content
final categoryId = categoryId_example; // String | Filter by category ID
final serviceId = serviceId_example; // String | Filter by service ID
final isAnswered = true; // bool | Filter by answered status
final startDate = 2013-10-20T19:20:30+01:00; // DateTime | Filter by start date
final endDate = 2013-10-20T19:20:30+01:00; // DateTime | Filter by end date

try {
    final result = api_instance.apiQueriesGet(limit, offset, sessionId, text, categoryId, serviceId, isAnswered, startDate, endDate);
    print(result);
} catch (e) {
    print('Exception when calling QueriesApi->apiQueriesGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **limit** | **int**| Number of queries per page | [optional] [default to 20]
 **offset** | **int**| Offset for pagination | [optional] [default to 0]
 **sessionId** | **String**| Filter by session ID | [optional] 
 **text** | **String**| Filter by text content | [optional] 
 **categoryId** | **String**| Filter by category ID | [optional] 
 **serviceId** | **String**| Filter by service ID | [optional] 
 **isAnswered** | **bool**| Filter by answered status | [optional] 
 **startDate** | **DateTime**| Filter by start date | [optional] 
 **endDate** | **DateTime**| Filter by end date | [optional] 

### Return type

[**ApiQueriesGet200Response**](ApiQueriesGet200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiQueriesPost**
> ApiQueriesGet200ResponseQueriesInner apiQueriesPost(apiQueriesPostRequest)

Create a new query

Creates a new query and records it in analytics. Supports single-message or full conversation modes.

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = QueriesApi();
final apiQueriesPostRequest = ApiQueriesPostRequest(); // ApiQueriesPostRequest | 

try {
    final result = api_instance.apiQueriesPost(apiQueriesPostRequest);
    print(result);
} catch (e) {
    print('Exception when calling QueriesApi->apiQueriesPost: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **apiQueriesPostRequest** | [**ApiQueriesPostRequest**](ApiQueriesPostRequest.md)|  | 

### Return type

[**ApiQueriesGet200ResponseQueriesInner**](ApiQueriesGet200ResponseQueriesInner.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiQueriesQueryIdAnsweredPatch**
> ApiQueriesQueryIdAnsweredPatch200Response apiQueriesQueryIdAnsweredPatch(queryId, apiQueriesQueryIdResponsetimePatchRequest)

Mark query as answered

Marks a query as answered and updates response time

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = QueriesApi();
final queryId = queryId_example; // String | ID of the query to update.
final apiQueriesQueryIdResponsetimePatchRequest = ApiQueriesQueryIdResponsetimePatchRequest(); // ApiQueriesQueryIdResponsetimePatchRequest | 

try {
    final result = api_instance.apiQueriesQueryIdAnsweredPatch(queryId, apiQueriesQueryIdResponsetimePatchRequest);
    print(result);
} catch (e) {
    print('Exception when calling QueriesApi->apiQueriesQueryIdAnsweredPatch: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **queryId** | **String**| ID of the query to update. | 
 **apiQueriesQueryIdResponsetimePatchRequest** | [**ApiQueriesQueryIdResponsetimePatchRequest**](ApiQueriesQueryIdResponsetimePatchRequest.md)|  | 

### Return type

[**ApiQueriesQueryIdAnsweredPatch200Response**](ApiQueriesQueryIdAnsweredPatch200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiQueriesQueryIdConversationPost**
> ApiQueriesQueryIdConversationPost201Response apiQueriesQueryIdConversationPost(queryId, apiChatQueryQueryIdConversationPostRequest)

Create conversation from query

Creates a new conversation based on an existing query

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = QueriesApi();
final queryId = queryId_example; // String | Query ID
final apiChatQueryQueryIdConversationPostRequest = ApiChatQueryQueryIdConversationPostRequest(); // ApiChatQueryQueryIdConversationPostRequest | 

try {
    final result = api_instance.apiQueriesQueryIdConversationPost(queryId, apiChatQueryQueryIdConversationPostRequest);
    print(result);
} catch (e) {
    print('Exception when calling QueriesApi->apiQueriesQueryIdConversationPost: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **queryId** | **String**| Query ID | 
 **apiChatQueryQueryIdConversationPostRequest** | [**ApiChatQueryQueryIdConversationPostRequest**](ApiChatQueryQueryIdConversationPostRequest.md)|  | [optional] 

### Return type

[**ApiQueriesQueryIdConversationPost201Response**](ApiQueriesQueryIdConversationPost201Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiQueriesQueryIdConversationsGet**
> List<Object> apiQueriesQueryIdConversationsGet(queryId)

Get conversations for a query

Retrieves all conversations associated with a specific query

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = QueriesApi();
final queryId = queryId_example; // String | Query ID

try {
    final result = api_instance.apiQueriesQueryIdConversationsGet(queryId);
    print(result);
} catch (e) {
    print('Exception when calling QueriesApi->apiQueriesQueryIdConversationsGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **queryId** | **String**| Query ID | 

### Return type

**List<Object>**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiQueriesQueryIdFeedbackPost**
> ApiQueriesQueryIdFeedbackPost200Response apiQueriesQueryIdFeedbackPost(queryId, apiQueriesQueryIdFeedbackPostRequest)

Add feedback to a query

Adds user feedback to a query and records it in analytics

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = QueriesApi();
final queryId = queryId_example; // String | Query ID
final apiQueriesQueryIdFeedbackPostRequest = ApiQueriesQueryIdFeedbackPostRequest(); // ApiQueriesQueryIdFeedbackPostRequest | 

try {
    final result = api_instance.apiQueriesQueryIdFeedbackPost(queryId, apiQueriesQueryIdFeedbackPostRequest);
    print(result);
} catch (e) {
    print('Exception when calling QueriesApi->apiQueriesQueryIdFeedbackPost: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **queryId** | **String**| Query ID | 
 **apiQueriesQueryIdFeedbackPostRequest** | [**ApiQueriesQueryIdFeedbackPostRequest**](ApiQueriesQueryIdFeedbackPostRequest.md)|  | 

### Return type

[**ApiQueriesQueryIdFeedbackPost200Response**](ApiQueriesQueryIdFeedbackPost200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiQueriesQueryIdGet**
> ApiQueriesGet200ResponseQueriesInner apiQueriesQueryIdGet(queryId)

Get query by ID

Retrieves a query by its unique identifier

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = QueriesApi();
final queryId = queryId_example; // String | Query ID

try {
    final result = api_instance.apiQueriesQueryIdGet(queryId);
    print(result);
} catch (e) {
    print('Exception when calling QueriesApi->apiQueriesQueryIdGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **queryId** | **String**| Query ID | 

### Return type

[**ApiQueriesGet200ResponseQueriesInner**](ApiQueriesGet200ResponseQueriesInner.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiQueriesQueryIdLinkMessageIdPost**
> Object apiQueriesQueryIdLinkMessageIdPost(queryId, messageId, apiQueriesQueryIdLinkMessageIdPostRequest)

Link query to message

Creates a link between a query and an existing message

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = QueriesApi();
final queryId = queryId_example; // String | Query ID
final messageId = messageId_example; // String | Message ID
final apiQueriesQueryIdLinkMessageIdPostRequest = ApiQueriesQueryIdLinkMessageIdPostRequest(); // ApiQueriesQueryIdLinkMessageIdPostRequest | 

try {
    final result = api_instance.apiQueriesQueryIdLinkMessageIdPost(queryId, messageId, apiQueriesQueryIdLinkMessageIdPostRequest);
    print(result);
} catch (e) {
    print('Exception when calling QueriesApi->apiQueriesQueryIdLinkMessageIdPost: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **queryId** | **String**| Query ID | 
 **messageId** | **String**| Message ID | 
 **apiQueriesQueryIdLinkMessageIdPostRequest** | [**ApiQueriesQueryIdLinkMessageIdPostRequest**](ApiQueriesQueryIdLinkMessageIdPostRequest.md)|  | [optional] 

### Return type

**Object**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiQueriesQueryIdResponsetimePatch**
> ApiQueriesQueryIdResponsetimePatch200Response apiQueriesQueryIdResponsetimePatch(queryId, apiQueriesQueryIdResponsetimePatchRequest)

Update query response time

Updates the response time of a specific query.

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = QueriesApi();
final queryId = queryId_example; // String | ID of the query to update.
final apiQueriesQueryIdResponsetimePatchRequest = ApiQueriesQueryIdResponsetimePatchRequest(); // ApiQueriesQueryIdResponsetimePatchRequest | 

try {
    final result = api_instance.apiQueriesQueryIdResponsetimePatch(queryId, apiQueriesQueryIdResponsetimePatchRequest);
    print(result);
} catch (e) {
    print('Exception when calling QueriesApi->apiQueriesQueryIdResponsetimePatch: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **queryId** | **String**| ID of the query to update. | 
 **apiQueriesQueryIdResponsetimePatchRequest** | [**ApiQueriesQueryIdResponsetimePatchRequest**](ApiQueriesQueryIdResponsetimePatchRequest.md)|  | 

### Return type

[**ApiQueriesQueryIdResponsetimePatch200Response**](ApiQueriesQueryIdResponsetimePatch200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

