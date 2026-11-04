# openapi.model.ApiMeResetDataPost200Response

## Load the model package
```dart
import 'package:openapi/api.dart';
```

## Properties
Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**success** | **bool** |  | [optional] 
**message** | **String** |  | [optional] 
**userKey** | **String** |  | [optional] 
**fieldsPreserved** | **int** | Informational count of preserved fields (system-managed identity/audit fields plus client preferences) carried over from the stored document (excludes the updated-at bump). | [optional] 
**filesDeletionFailed** | **bool** | True when the uploaded files could not be removed after the reset committed — files may remain on disk. | [optional] 

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


