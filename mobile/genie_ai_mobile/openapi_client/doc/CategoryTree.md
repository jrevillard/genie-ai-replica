# openapi.model.CategoryTree

## Load the model package
```dart
import 'package:openapi/api.dart';
```

## Properties
Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**catKey** | **String** |  | [optional] 
**catCode** | **String** |  | [optional] 
**name** | **String** | The name the UI displays: the localized translation, or — on the PUBLIC tree — the ENGLISH one when the active locale has no translation. | [optional] 
**nameEN** | **String** | The ENGLISH name — the SSOT every filter label is spoken in. Clients put THIS value on the query wire; the localized `name` is display-only. It is the English translation row, or the entity document's own `nameEN` for an entity with no English translation row. | [optional] 
**children** | [**List<CategoryTreeChildrenInner>**](CategoryTreeChildrenInner.md) | The category's services, display + wire spellings. | [optional] [default to const []]

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


