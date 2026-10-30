# openapi.model.ApiAdminSecurityLastScanGet200Response

## Load the model package
```dart
import 'package:openapi/api.dart';
```

## Properties
Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**scanTime** | [**DateTime**](DateTime.md) |  | [optional] 
**lastScan** | **String** | Cold-start sentinel (\"Never\") returned by getLastScanDetails when no scan has been saved yet; null after the first successful run. | [optional] 
**vulnerabilities** | [**ApiAdminSecurityScanPost200ResponseDataVulnerabilities**](ApiAdminSecurityScanPost200ResponseDataVulnerabilities.md) |  | [optional] 
**vulnerabilityDetails** | **Object** | Categorised vulnerability buckets: {critical, medium, low} arrays. | [optional] 
**patternMatches** | **List<Object>** |  | [optional] [default to const []]
**patternMatchCount** | **int** |  | [optional] 
**failedLoginDetails** | **List<Object>** |  | [optional] [default to const []]
**suspiciousDetails** | **List<Object>** |  | [optional] [default to const []]
**status** | **String** |  | [optional] 
**skipped** | **bool** |  | [optional] 
**reason** | **String** |  | [optional] 
**message** | **String** | Human-readable scan summary (only present after a run; cold-start default omits it). | [optional] 

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


