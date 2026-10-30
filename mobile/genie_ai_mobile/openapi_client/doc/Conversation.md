# openapi.model.Conversation

## Load the model package
```dart
import 'package:openapi/api.dart';
```

## Properties
Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**key** | **String** | Unique identifier | [optional] 
**userId** | **String** | ID of the user who owns the conversation | [optional] 
**title** | **String** | Conversation title | [optional] 
**categoryId** | **String** | ID of the service category | [optional] 
**lastMessage** | **String** | Preview of the last message | [optional] 
**created** | [**DateTime**](DateTime.md) | Creation timestamp | [optional] 
**updated** | [**DateTime**](DateTime.md) | Last update timestamp | [optional] 
**messageCount** | **int** | Number of messages in the conversation | [optional] 
**isStarred** | **bool** | Whether the conversation is starred | [optional] 
**isArchived** | **bool** | Whether the conversation is archived | [optional] 
**tags** | **List<String>** | Tags associated with the conversation | [optional] [default to const []]

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


