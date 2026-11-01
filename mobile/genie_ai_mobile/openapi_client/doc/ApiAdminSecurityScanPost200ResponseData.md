# openapi.model.ApiAdminSecurityScanPost200ResponseData

## Load the model package
```dart
import 'package:openapi/api.dart';
```

## Properties
Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**scanTime** | [**DateTime**](DateTime.md) |  | [optional] 
**vulnerabilities** | [**ApiAdminSecurityScanPost200ResponseDataVulnerabilities**](ApiAdminSecurityScanPost200ResponseDataVulnerabilities.md) |  | [optional] 
**status** | **String** |  | [optional] 
**skipped** | **bool** |  | [optional] 
**reason** | **String** |  | [optional] 
**vulnerabilityDetails** | **Object** | Categorised vulnerability buckets: {critical, medium, low} arrays. | [optional] 
**patternMatches** | **List<Object>** | All pattern-match rows (signature hits + bare-phrase hits). | [optional] [default to const []]
**patternMatchCount** | **int** |  | [optional] 
**failedLoginDetails** | **List<Object>** |  | [optional] [default to const []]
**suspiciousDetails** | **List<Object>** |  | [optional] [default to const []]
**message** | **String** | Human-readable scan summary; distinguishes skipped vs completed. | [optional] 

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


