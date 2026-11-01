# openapi.model.Message

## Load the model package
```dart
import 'package:openapi/api.dart';
```

## Properties
Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**key** | **String** | Unique identifier | [optional] 
**conversationId** | **String** | ID of the parent conversation | [optional] 
**userId** | **String** | ID of the user who sent or received the message | [optional] 
**content** | **String** | Message content | [optional] 
**timestamp** | [**DateTime**](DateTime.md) | Message timestamp | [optional] 
**sender** | **String** | Sender type (user or assistant) | [optional] 
**queryId** | **String** | Optional ID of a related query (for assistant messages) | [optional] 
**readStatus** | **bool** | Whether the message has been read | [optional] 
**metadata** | **Object** | Additional message metadata | [optional] 

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


