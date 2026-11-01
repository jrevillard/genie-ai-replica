# openapi.model.CategoryTreeChildrenInner

## Load the model package
```dart
import 'package:openapi/api.dart';
```

## Properties
Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**key** | **String** | The service entity's stable key. Neither spelling of the name is unique inside a category, so identity that survives renames and locale switches keys on this. | [optional] 
**name** | **String** | Display name: the localized translation, or — on the PUBLIC tree — the ENGLISH one when the active locale has no translation. | [optional] 
**nameEN** | **String** | The ENGLISH name, the filter wire (SSOT): the English translation row, or the entity document's own `nameEN` for an entity with no English translation row. | [optional] 

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


