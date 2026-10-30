# openapi.model.QueryContext

## Load the model package
```dart
import 'package:openapi/api.dart';
```

## Properties
Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**categoryLabel** | **String** | The ENGLISH label of the category — the SSOT every filter label is spoken in (the hierarchy's own `nameEN`). It is forwarded to the retriever as is: a label that matches no chunk scopes the query to nothing. | [optional] 
**categoryLabels** | **List<String>** | The legacy PLURAL spelling of categoryLabel (the upstream OPEA field). Honoured like the singular when present; a bare string is read as ONE label. Clients of this API should send the singular. | [optional] [default to const []]
**serviceLabels** | **List<String>** | ENGLISH service labels. A bare string is also accepted and read as ONE label (never as a sequence of characters, never as an empty scope). | [optional] [default to const []]
**language** | **String** |  | [optional] [default to 'EN']

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


