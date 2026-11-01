# openapi.model.ConversationStats

## Load the model package
```dart
import 'package:openapi/api.dart';
```

## Properties
Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**totalConversations** | **int** | Total number of conversations | [optional] 
**totalMessages** | **int** | Number of messages | [optional] 
**avgMessagesPerConversation** | **num** | Average number of messages per conversation | [optional] 
**starredCount** | **int** | Number of starred conversations | [optional] 
**archivedCount** | **int** | Number of archived conversations | [optional] 
**conversationsByCategory** | [**List<ConversationStatsConversationsByCategoryInner>**](ConversationStatsConversationsByCategoryInner.md) |  | [optional] [default to const []]
**messagesByType** | [**ConversationStatsMessagesByType**](ConversationStatsMessagesByType.md) |  | [optional] 

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


