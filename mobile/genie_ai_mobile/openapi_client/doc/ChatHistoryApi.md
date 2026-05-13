# openapi.api.ChatHistoryApi

## Load the API package
```dart
import 'package:openapi/api.dart';
```

All URIs are relative to *https://localhost*

Method | HTTP request | Description
------------- | ------------- | -------------
[**apiChatConversationsConversationIdDelete**](ChatHistoryApi.md#apichatconversationsconversationiddelete) | **DELETE** /api/chat/conversations/{conversationId} | Delete conversation
[**apiChatConversationsConversationIdFolderGet**](ChatHistoryApi.md#apichatconversationsconversationidfolderget) | **GET** /api/chat/conversations/{conversationId}/folder | Get conversation's folder
[**apiChatConversationsConversationIdGet**](ChatHistoryApi.md#apichatconversationsconversationidget) | **GET** /api/chat/conversations/{conversationId} | Get conversation details
[**apiChatConversationsConversationIdMessagesGet**](ChatHistoryApi.md#apichatconversationsconversationidmessagesget) | **GET** /api/chat/conversations/{conversationId}/messages | Get conversation messages
[**apiChatConversationsConversationIdMessagesPost**](ChatHistoryApi.md#apichatconversationsconversationidmessagespost) | **POST** /api/chat/conversations/{conversationId}/messages | Add message to conversation
[**apiChatConversationsConversationIdMessagesReadPost**](ChatHistoryApi.md#apichatconversationsconversationidmessagesreadpost) | **POST** /api/chat/conversations/{conversationId}/messages/read | Mark messages as read
[**apiChatConversationsConversationIdMovePost**](ChatHistoryApi.md#apichatconversationsconversationidmovepost) | **POST** /api/chat/conversations/{conversationId}/move | Move conversation
[**apiChatConversationsConversationIdPatch**](ChatHistoryApi.md#apichatconversationsconversationidpatch) | **PATCH** /api/chat/conversations/{conversationId} | Update conversation
[**apiChatConversationsGet**](ChatHistoryApi.md#apichatconversationsget) | **GET** /api/chat/conversations | Get user conversations
[**apiChatConversationsPost**](ChatHistoryApi.md#apichatconversationspost) | **POST** /api/chat/conversations | Create a new conversation
[**apiChatFoldersFolderIdConversationsConversationIdDelete**](ChatHistoryApi.md#apichatfoldersfolderidconversationsconversationiddelete) | **DELETE** /api/chat/folders/{folderId}/conversations/{conversationId} | Remove conversation from folder
[**apiChatFoldersFolderIdConversationsConversationIdPost**](ChatHistoryApi.md#apichatfoldersfolderidconversationsconversationidpost) | **POST** /api/chat/folders/{folderId}/conversations/{conversationId} | Add conversation to folder
[**apiChatFoldersFolderIdDelete**](ChatHistoryApi.md#apichatfoldersfolderiddelete) | **DELETE** /api/chat/folders/{folderId} | Delete folder
[**apiChatFoldersFolderIdGet**](ChatHistoryApi.md#apichatfoldersfolderidget) | **GET** /api/chat/folders/{folderId} | Get folder details
[**apiChatFoldersFolderIdPatch**](ChatHistoryApi.md#apichatfoldersfolderidpatch) | **PATCH** /api/chat/folders/{folderId} | Update folder
[**apiChatFoldersFolderIdPathGet**](ChatHistoryApi.md#apichatfoldersfolderidpathget) | **GET** /api/chat/folders/{folderId}/path | Get folder path
[**apiChatFoldersGet**](ChatHistoryApi.md#apichatfoldersget) | **GET** /api/chat/folders | Get user folders
[**apiChatFoldersPost**](ChatHistoryApi.md#apichatfolderspost) | **POST** /api/chat/folders | Create a new folder
[**apiChatFoldersReorderPost**](ChatHistoryApi.md#apichatfoldersreorderpost) | **POST** /api/chat/folders/reorder | Reorder folders
[**apiChatFoldersSearchGet**](ChatHistoryApi.md#apichatfolderssearchget) | **GET** /api/chat/folders/search | Search folders
[**apiChatMessagesMessageIdQueryGet**](ChatHistoryApi.md#apichatmessagesmessageidqueryget) | **GET** /api/chat/messages/{messageId}/query | Get originating query for a message
[**apiChatQueryQueryIdConversationPost**](ChatHistoryApi.md#apichatqueryqueryidconversationpost) | **POST** /api/chat/query/{queryId}/conversation | Create conversation from query
[**apiChatQueryQueryIdMessagesGet**](ChatHistoryApi.md#apichatqueryqueryidmessagesget) | **GET** /api/chat/query/{queryId}/messages | Get messages for a query
[**apiChatRecentGet**](ChatHistoryApi.md#apichatrecentget) | **GET** /api/chat/recent | Get recent conversations
[**apiChatSearchGet**](ChatHistoryApi.md#apichatsearchget) | **GET** /api/chat/search | Search conversations
[**apiChatStatsGet**](ChatHistoryApi.md#apichatstatsget) | **GET** /api/chat/stats | Get conversation statistics


# **apiChatConversationsConversationIdDelete**
> apiChatConversationsConversationIdDelete(conversationId)

Delete conversation

Deletes a conversation and all associated messages

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = ChatHistoryApi();
final conversationId = conversationId_example; // String | ID of the conversation to delete

try {
    api_instance.apiChatConversationsConversationIdDelete(conversationId);
} catch (e) {
    print('Exception when calling ChatHistoryApi->apiChatConversationsConversationIdDelete: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **conversationId** | **String**| ID of the conversation to delete | 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiChatConversationsConversationIdFolderGet**
> apiChatConversationsConversationIdFolderGet(conversationId)

Get conversation's folder

Finds which folder a conversation belongs to

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = ChatHistoryApi();
final conversationId = conversationId_example; // String | ID of the conversation

try {
    api_instance.apiChatConversationsConversationIdFolderGet(conversationId);
} catch (e) {
    print('Exception when calling ChatHistoryApi->apiChatConversationsConversationIdFolderGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **conversationId** | **String**| ID of the conversation | 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiChatConversationsConversationIdGet**
> apiChatConversationsConversationIdGet(conversationId)

Get conversation details

Retrieves a specific conversation including its messages

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = ChatHistoryApi();
final conversationId = conversationId_example; // String | ID of the conversation to retrieve

try {
    api_instance.apiChatConversationsConversationIdGet(conversationId);
} catch (e) {
    print('Exception when calling ChatHistoryApi->apiChatConversationsConversationIdGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **conversationId** | **String**| ID of the conversation to retrieve | 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiChatConversationsConversationIdMessagesGet**
> apiChatConversationsConversationIdMessagesGet(conversationId, limit, offset, newestFirst)

Get conversation messages

Retrieves messages for a specific conversation with pagination

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = ChatHistoryApi();
final conversationId = conversationId_example; // String | ID of the conversation
final limit = 56; // int | Maximum number of messages to return
final offset = 56; // int | Number of records to skip for pagination
final newestFirst = true; // bool | Sort messages with newest first

try {
    api_instance.apiChatConversationsConversationIdMessagesGet(conversationId, limit, offset, newestFirst);
} catch (e) {
    print('Exception when calling ChatHistoryApi->apiChatConversationsConversationIdMessagesGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **conversationId** | **String**| ID of the conversation | 
 **limit** | **int**| Maximum number of messages to return | [optional] [default to 50]
 **offset** | **int**| Number of records to skip for pagination | [optional] [default to 0]
 **newestFirst** | **bool**| Sort messages with newest first | [optional] [default to false]

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiChatConversationsConversationIdMessagesPost**
> apiChatConversationsConversationIdMessagesPost(conversationId, apiChatConversationsConversationIdMessagesPostRequest)

Add message to conversation

Adds a new message to a conversation

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = ChatHistoryApi();
final conversationId = conversationId_example; // String | ID of the conversation
final apiChatConversationsConversationIdMessagesPostRequest = ApiChatConversationsConversationIdMessagesPostRequest(); // ApiChatConversationsConversationIdMessagesPostRequest | 

try {
    api_instance.apiChatConversationsConversationIdMessagesPost(conversationId, apiChatConversationsConversationIdMessagesPostRequest);
} catch (e) {
    print('Exception when calling ChatHistoryApi->apiChatConversationsConversationIdMessagesPost: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **conversationId** | **String**| ID of the conversation | 
 **apiChatConversationsConversationIdMessagesPostRequest** | [**ApiChatConversationsConversationIdMessagesPostRequest**](ApiChatConversationsConversationIdMessagesPostRequest.md)|  | 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiChatConversationsConversationIdMessagesReadPost**
> apiChatConversationsConversationIdMessagesReadPost(conversationId, apiChatConversationsConversationIdMessagesReadPostRequest)

Mark messages as read

Marks all or specific messages in a conversation as read

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = ChatHistoryApi();
final conversationId = conversationId_example; // String | ID of the conversation
final apiChatConversationsConversationIdMessagesReadPostRequest = ApiChatConversationsConversationIdMessagesReadPostRequest(); // ApiChatConversationsConversationIdMessagesReadPostRequest | 

try {
    api_instance.apiChatConversationsConversationIdMessagesReadPost(conversationId, apiChatConversationsConversationIdMessagesReadPostRequest);
} catch (e) {
    print('Exception when calling ChatHistoryApi->apiChatConversationsConversationIdMessagesReadPost: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **conversationId** | **String**| ID of the conversation | 
 **apiChatConversationsConversationIdMessagesReadPostRequest** | [**ApiChatConversationsConversationIdMessagesReadPostRequest**](ApiChatConversationsConversationIdMessagesReadPostRequest.md)|  | [optional] 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiChatConversationsConversationIdMovePost**
> apiChatConversationsConversationIdMovePost(conversationId, apiChatConversationsConversationIdMovePostRequest)

Move conversation

Moves a conversation from one folder to another

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = ChatHistoryApi();
final conversationId = conversationId_example; // String | ID of the conversation to move
final apiChatConversationsConversationIdMovePostRequest = ApiChatConversationsConversationIdMovePostRequest(); // ApiChatConversationsConversationIdMovePostRequest | 

try {
    api_instance.apiChatConversationsConversationIdMovePost(conversationId, apiChatConversationsConversationIdMovePostRequest);
} catch (e) {
    print('Exception when calling ChatHistoryApi->apiChatConversationsConversationIdMovePost: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **conversationId** | **String**| ID of the conversation to move | 
 **apiChatConversationsConversationIdMovePostRequest** | [**ApiChatConversationsConversationIdMovePostRequest**](ApiChatConversationsConversationIdMovePostRequest.md)|  | 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiChatConversationsConversationIdPatch**
> apiChatConversationsConversationIdPatch(conversationId, apiChatConversationsConversationIdPatchRequest)

Update conversation

Updates conversation properties like title, starred status, etc.

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = ChatHistoryApi();
final conversationId = conversationId_example; // String | ID of the conversation to update
final apiChatConversationsConversationIdPatchRequest = ApiChatConversationsConversationIdPatchRequest(); // ApiChatConversationsConversationIdPatchRequest | 

try {
    api_instance.apiChatConversationsConversationIdPatch(conversationId, apiChatConversationsConversationIdPatchRequest);
} catch (e) {
    print('Exception when calling ChatHistoryApi->apiChatConversationsConversationIdPatch: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **conversationId** | **String**| ID of the conversation to update | 
 **apiChatConversationsConversationIdPatchRequest** | [**ApiChatConversationsConversationIdPatchRequest**](ApiChatConversationsConversationIdPatchRequest.md)|  | 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiChatConversationsGet**
> apiChatConversationsGet(limit, offset, includeArchived, filterStarred, searchTerm)

Get user conversations

Retrieves all conversations for the authenticated user with pagination and filtering options

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = ChatHistoryApi();
final limit = 56; // int | Maximum number of conversations to return
final offset = 56; // int | Number of records to skip for pagination
final includeArchived = true; // bool | Whether to include archived conversations
final filterStarred = true; // bool | Filter to show only starred conversations
final searchTerm = searchTerm_example; // String | Text to search for in conversation titles or messages

try {
    api_instance.apiChatConversationsGet(limit, offset, includeArchived, filterStarred, searchTerm);
} catch (e) {
    print('Exception when calling ChatHistoryApi->apiChatConversationsGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **limit** | **int**| Maximum number of conversations to return | [optional] [default to 20]
 **offset** | **int**| Number of records to skip for pagination | [optional] [default to 0]
 **includeArchived** | **bool**| Whether to include archived conversations | [optional] [default to false]
 **filterStarred** | **bool**| Filter to show only starred conversations | [optional] [default to false]
 **searchTerm** | **String**| Text to search for in conversation titles or messages | [optional] 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiChatConversationsPost**
> apiChatConversationsPost(apiChatConversationsPostRequest)

Create a new conversation

Creates a new chat conversation

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = ChatHistoryApi();
final apiChatConversationsPostRequest = ApiChatConversationsPostRequest(); // ApiChatConversationsPostRequest | 

try {
    api_instance.apiChatConversationsPost(apiChatConversationsPostRequest);
} catch (e) {
    print('Exception when calling ChatHistoryApi->apiChatConversationsPost: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **apiChatConversationsPostRequest** | [**ApiChatConversationsPostRequest**](ApiChatConversationsPostRequest.md)|  | 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiChatFoldersFolderIdConversationsConversationIdDelete**
> apiChatFoldersFolderIdConversationsConversationIdDelete(folderId, conversationId)

Remove conversation from folder

Removes a conversation from a folder

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = ChatHistoryApi();
final folderId = folderId_example; // String | ID of the folder
final conversationId = conversationId_example; // String | ID of the conversation to remove

try {
    api_instance.apiChatFoldersFolderIdConversationsConversationIdDelete(folderId, conversationId);
} catch (e) {
    print('Exception when calling ChatHistoryApi->apiChatFoldersFolderIdConversationsConversationIdDelete: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **folderId** | **String**| ID of the folder | 
 **conversationId** | **String**| ID of the conversation to remove | 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiChatFoldersFolderIdConversationsConversationIdPost**
> apiChatFoldersFolderIdConversationsConversationIdPost(folderId, conversationId)

Add conversation to folder

Adds a conversation to a folder

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = ChatHistoryApi();
final folderId = folderId_example; // String | ID of the folder
final conversationId = conversationId_example; // String | ID of the conversation to add

try {
    api_instance.apiChatFoldersFolderIdConversationsConversationIdPost(folderId, conversationId);
} catch (e) {
    print('Exception when calling ChatHistoryApi->apiChatFoldersFolderIdConversationsConversationIdPost: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **folderId** | **String**| ID of the folder | 
 **conversationId** | **String**| ID of the conversation to add | 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiChatFoldersFolderIdDelete**
> apiChatFoldersFolderIdDelete(folderId, deleteContents)

Delete folder

Deletes a folder and optionally its contents

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = ChatHistoryApi();
final folderId = folderId_example; // String | ID of the folder to delete
final deleteContents = true; // bool | Whether to delete contained conversations and subfolders

try {
    api_instance.apiChatFoldersFolderIdDelete(folderId, deleteContents);
} catch (e) {
    print('Exception when calling ChatHistoryApi->apiChatFoldersFolderIdDelete: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **folderId** | **String**| ID of the folder to delete | 
 **deleteContents** | **bool**| Whether to delete contained conversations and subfolders | [optional] [default to false]

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiChatFoldersFolderIdGet**
> apiChatFoldersFolderIdGet(folderId)

Get folder details

Retrieves a specific folder including its conversations

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = ChatHistoryApi();
final folderId = folderId_example; // String | ID of the folder to retrieve

try {
    api_instance.apiChatFoldersFolderIdGet(folderId);
} catch (e) {
    print('Exception when calling ChatHistoryApi->apiChatFoldersFolderIdGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **folderId** | **String**| ID of the folder to retrieve | 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiChatFoldersFolderIdPatch**
> apiChatFoldersFolderIdPatch(folderId, apiChatFoldersFolderIdPatchRequest)

Update folder

Updates folder properties

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = ChatHistoryApi();
final folderId = folderId_example; // String | ID of the folder to update
final apiChatFoldersFolderIdPatchRequest = ApiChatFoldersFolderIdPatchRequest(); // ApiChatFoldersFolderIdPatchRequest | 

try {
    api_instance.apiChatFoldersFolderIdPatch(folderId, apiChatFoldersFolderIdPatchRequest);
} catch (e) {
    print('Exception when calling ChatHistoryApi->apiChatFoldersFolderIdPatch: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **folderId** | **String**| ID of the folder to update | 
 **apiChatFoldersFolderIdPatchRequest** | [**ApiChatFoldersFolderIdPatchRequest**](ApiChatFoldersFolderIdPatchRequest.md)|  | 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiChatFoldersFolderIdPathGet**
> apiChatFoldersFolderIdPathGet(folderId)

Get folder path

Retrieves the folder path (breadcrumbs)

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = ChatHistoryApi();
final folderId = folderId_example; // String | ID of the folder

try {
    api_instance.apiChatFoldersFolderIdPathGet(folderId);
} catch (e) {
    print('Exception when calling ChatHistoryApi->apiChatFoldersFolderIdPathGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **folderId** | **String**| ID of the folder | 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiChatFoldersGet**
> apiChatFoldersGet(includeArchived, parentFolderId)

Get user folders

Retrieves all folders for the authenticated user

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = ChatHistoryApi();
final includeArchived = true; // bool | Whether to include archived folders
final parentFolderId = parentFolderId_example; // String | ID of parent folder to get subfolders (omit for root folders)

try {
    api_instance.apiChatFoldersGet(includeArchived, parentFolderId);
} catch (e) {
    print('Exception when calling ChatHistoryApi->apiChatFoldersGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **includeArchived** | **bool**| Whether to include archived folders | [optional] [default to false]
 **parentFolderId** | **String**| ID of parent folder to get subfolders (omit for root folders) | [optional] 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiChatFoldersPost**
> apiChatFoldersPost(apiChatFoldersPostRequest)

Create a new folder

Creates a new folder for organizing conversations

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = ChatHistoryApi();
final apiChatFoldersPostRequest = ApiChatFoldersPostRequest(); // ApiChatFoldersPostRequest | 

try {
    api_instance.apiChatFoldersPost(apiChatFoldersPostRequest);
} catch (e) {
    print('Exception when calling ChatHistoryApi->apiChatFoldersPost: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **apiChatFoldersPostRequest** | [**ApiChatFoldersPostRequest**](ApiChatFoldersPostRequest.md)|  | 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiChatFoldersReorderPost**
> apiChatFoldersReorderPost(apiChatFoldersReorderPostRequest)

Reorder folders

Updates the order of folders at the same level

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = ChatHistoryApi();
final apiChatFoldersReorderPostRequest = ApiChatFoldersReorderPostRequest(); // ApiChatFoldersReorderPostRequest | 

try {
    api_instance.apiChatFoldersReorderPost(apiChatFoldersReorderPostRequest);
} catch (e) {
    print('Exception when calling ChatHistoryApi->apiChatFoldersReorderPost: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **apiChatFoldersReorderPostRequest** | [**ApiChatFoldersReorderPostRequest**](ApiChatFoldersReorderPostRequest.md)|  | 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiChatFoldersSearchGet**
> apiChatFoldersSearchGet(q, includeArchived)

Search folders

Searches for folders by name or description

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = ChatHistoryApi();
final q = q_example; // String | Search term
final includeArchived = true; // bool | Whether to include archived folders

try {
    api_instance.apiChatFoldersSearchGet(q, includeArchived);
} catch (e) {
    print('Exception when calling ChatHistoryApi->apiChatFoldersSearchGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **q** | **String**| Search term | 
 **includeArchived** | **bool**| Whether to include archived folders | [optional] [default to false]

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiChatMessagesMessageIdQueryGet**
> apiChatMessagesMessageIdQueryGet(messageId)

Get originating query for a message

Retrieves the query that led to a specific message

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = ChatHistoryApi();
final messageId = messageId_example; // String | ID of the message

try {
    api_instance.apiChatMessagesMessageIdQueryGet(messageId);
} catch (e) {
    print('Exception when calling ChatHistoryApi->apiChatMessagesMessageIdQueryGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **messageId** | **String**| ID of the message | 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiChatQueryQueryIdConversationPost**
> apiChatQueryQueryIdConversationPost(queryId, apiChatQueryQueryIdConversationPostRequest)

Create conversation from query

Creates a new conversation based on an existing query

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = ChatHistoryApi();
final queryId = queryId_example; // String | ID of the query
final apiChatQueryQueryIdConversationPostRequest = ApiChatQueryQueryIdConversationPostRequest(); // ApiChatQueryQueryIdConversationPostRequest | 

try {
    api_instance.apiChatQueryQueryIdConversationPost(queryId, apiChatQueryQueryIdConversationPostRequest);
} catch (e) {
    print('Exception when calling ChatHistoryApi->apiChatQueryQueryIdConversationPost: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **queryId** | **String**| ID of the query | 
 **apiChatQueryQueryIdConversationPostRequest** | [**ApiChatQueryQueryIdConversationPostRequest**](ApiChatQueryQueryIdConversationPostRequest.md)|  | [optional] 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiChatQueryQueryIdMessagesGet**
> apiChatQueryQueryIdMessagesGet(queryId)

Get messages for a query

Retrieves all messages related to a specific query

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = ChatHistoryApi();
final queryId = queryId_example; // String | ID of the query

try {
    api_instance.apiChatQueryQueryIdMessagesGet(queryId);
} catch (e) {
    print('Exception when calling ChatHistoryApi->apiChatQueryQueryIdMessagesGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **queryId** | **String**| ID of the query | 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiChatRecentGet**
> apiChatRecentGet(limit)

Get recent conversations

Retrieves recent conversations for the user

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = ChatHistoryApi();
final limit = 56; // int | Maximum number of conversations to return

try {
    api_instance.apiChatRecentGet(limit);
} catch (e) {
    print('Exception when calling ChatHistoryApi->apiChatRecentGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **limit** | **int**| Maximum number of conversations to return | [optional] [default to 5]

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiChatSearchGet**
> apiChatSearchGet(q, limit, offset, includeArchived)

Search conversations

Searches for conversations containing specific text

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = ChatHistoryApi();
final q = q_example; // String | Search term
final limit = 56; // int | Maximum number of results to return
final offset = 56; // int | Number of results to skip for pagination
final includeArchived = true; // bool | Whether to include archived conversations

try {
    api_instance.apiChatSearchGet(q, limit, offset, includeArchived);
} catch (e) {
    print('Exception when calling ChatHistoryApi->apiChatSearchGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **q** | **String**| Search term | 
 **limit** | **int**| Maximum number of results to return | [optional] [default to 20]
 **offset** | **int**| Number of results to skip for pagination | [optional] [default to 0]
 **includeArchived** | **bool**| Whether to include archived conversations | [optional] [default to false]

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiChatStatsGet**
> apiChatStatsGet()

Get conversation statistics

Retrieves statistics about the user's conversations

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = ChatHistoryApi();

try {
    api_instance.apiChatStatsGet();
} catch (e) {
    print('Exception when calling ChatHistoryApi->apiChatStatsGet: $e\n');
}
```

### Parameters
This endpoint does not need any parameter.

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

