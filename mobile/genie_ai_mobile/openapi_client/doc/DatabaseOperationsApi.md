# openapi.api.DatabaseOperationsApi

## Load the API package
```dart
import 'package:openapi/api.dart';
```

All URIs are relative to *https://localhost*

Method | HTTP request | Description
------------- | ------------- | -------------
[**apiDatabaseBackupPost**](DatabaseOperationsApi.md#apidatabasebackuppost) | **POST** /api/database/backup | Backup Database
[**apiDatabaseOptimizePost**](DatabaseOperationsApi.md#apidatabaseoptimizepost) | **POST** /api/database/optimize | Optimize Database


# **apiDatabaseBackupPost**
> ApiDatabaseBackupPost200Response apiDatabaseBackupPost()

Backup Database

Creates a full backup of the database

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = DatabaseOperationsApi();

try {
    final result = api_instance.apiDatabaseBackupPost();
    print(result);
} catch (e) {
    print('Exception when calling DatabaseOperationsApi->apiDatabaseBackupPost: $e\n');
}
```

### Parameters
This endpoint does not need any parameter.

### Return type

[**ApiDatabaseBackupPost200Response**](ApiDatabaseBackupPost200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiDatabaseOptimizePost**
> ApiDatabaseOptimizePost200Response apiDatabaseOptimizePost()

Optimize Database

Performs database optimization including compacting collections

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = DatabaseOperationsApi();

try {
    final result = api_instance.apiDatabaseOptimizePost();
    print(result);
} catch (e) {
    print('Exception when calling DatabaseOperationsApi->apiDatabaseOptimizePost: $e\n');
}
```

### Parameters
This endpoint does not need any parameter.

### Return type

[**ApiDatabaseOptimizePost200Response**](ApiDatabaseOptimizePost200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

