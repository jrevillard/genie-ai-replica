# openapi.api.LoggerApi

## Load the API package
```dart
import 'package:openapi/api.dart';
```

All URIs are relative to *https://localhost*

Method | HTTP request | Description
------------- | ------------- | -------------
[**apiLoggerConfigurePost**](LoggerApi.md#apiloggerconfigurepost) | **POST** /api/logger/configure | Reconfigure logger settings
[**apiLoggerRolloverPost**](LoggerApi.md#apiloggerrolloverpost) | **POST** /api/logger/rollover | Trigger log rollover


# **apiLoggerConfigurePost**
> ApiLoggerConfigurePost200Response apiLoggerConfigurePost(apiLoggerConfigurePostRequest)

Reconfigure logger settings

Updates the application's logging configuration with new settings.

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = LoggerApi();
final apiLoggerConfigurePostRequest = ApiLoggerConfigurePostRequest(); // ApiLoggerConfigurePostRequest | 

try {
    final result = api_instance.apiLoggerConfigurePost(apiLoggerConfigurePostRequest);
    print(result);
} catch (e) {
    print('Exception when calling LoggerApi->apiLoggerConfigurePost: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **apiLoggerConfigurePostRequest** | [**ApiLoggerConfigurePostRequest**](ApiLoggerConfigurePostRequest.md)|  | 

### Return type

[**ApiLoggerConfigurePost200Response**](ApiLoggerConfigurePost200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiLoggerRolloverPost**
> ApiLoggerRolloverPost200Response apiLoggerRolloverPost()

Trigger log rollover

Forces an immediate log rotation regardless of current file sizes

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = LoggerApi();

try {
    final result = api_instance.apiLoggerRolloverPost();
    print(result);
} catch (e) {
    print('Exception when calling LoggerApi->apiLoggerRolloverPost: $e\n');
}
```

### Parameters
This endpoint does not need any parameter.

### Return type

[**ApiLoggerRolloverPost200Response**](ApiLoggerRolloverPost200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

