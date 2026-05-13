# openapi.api.CurrentUserApi

## Load the API package
```dart
import 'package:openapi/api.dart';
```

All URIs are relative to *https://localhost*

Method | HTTP request | Description
------------- | ------------- | -------------
[**apiMeContextGet**](CurrentUserApi.md#apimecontextget) | **GET** /api/me/context | Get user context for AI enrichment
[**apiMeDeletePost**](CurrentUserApi.md#apimedeletepost) | **POST** /api/me/delete | Delete user account (GDPR right to erasure)
[**apiMeGet**](CurrentUserApi.md#apimeget) | **GET** /api/me | Get current user profile
[**apiMePut**](CurrentUserApi.md#apimeput) | **PUT** /api/me | Update current user profile
[**apiMeResetDataPost**](CurrentUserApi.md#apimeresetdatapost) | **POST** /api/me/reset-data | Reset user profile data


# **apiMeContextGet**
> apiMeContextGet()

Get user context for AI enrichment

Returns a sanitized subset of user data for OPEA AI context enrichment. User is resolved from the JWT.

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = CurrentUserApi();

try {
    api_instance.apiMeContextGet();
} catch (e) {
    print('Exception when calling CurrentUserApi->apiMeContextGet: $e\n');
}
```

### Parameters
This endpoint does not need any parameter.

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiMeDeletePost**
> apiMeDeletePost()

Delete user account (GDPR right to erasure)

Deletes the user from Keycloak and erases all PII from ArangoDB (soft-delete with nullification). This action is irreversible.

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = CurrentUserApi();

try {
    api_instance.apiMeDeletePost();
} catch (e) {
    print('Exception when calling CurrentUserApi->apiMeDeletePost: $e\n');
}
```

### Parameters
This endpoint does not need any parameter.

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiMeGet**
> apiMeGet()

Get current user profile

Returns the full profile of the authenticated user. User is resolved from the JWT — no ID parameter needed.

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = CurrentUserApi();

try {
    api_instance.apiMeGet();
} catch (e) {
    print('Exception when calling CurrentUserApi->apiMeGet: $e\n');
}
```

### Parameters
This endpoint does not need any parameter.

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiMePut**
> apiMePut(data, files)

Update current user profile

Self-service profile update. JIT fields (email, name) forwarded to Keycloak Account API, custom fields saved to ArangoDB.

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = CurrentUserApi();
final data = data_example; // String | JSON string containing user profile data
final files = [/path/to/file.txt]; // List<MultipartFile> | Files to upload (optional)

try {
    api_instance.apiMePut(data, files);
} catch (e) {
    print('Exception when calling CurrentUserApi->apiMePut: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **data** | **String**| JSON string containing user profile data | [optional] 
 **files** | [**List<MultipartFile>**](MultipartFile.md)| Files to upload (optional) | [optional] 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: multipart/form-data, application/json
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiMeResetDataPost**
> apiMeResetDataPost()

Reset user profile data

Resets the authenticated user's profile data while preserving essential account information (credentials, email, creation date). JIT-provisioned fields (name, roles) are restored on next login.

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = CurrentUserApi();

try {
    api_instance.apiMeResetDataPost();
} catch (e) {
    print('Exception when calling CurrentUserApi->apiMeResetDataPost: $e\n');
}
```

### Parameters
This endpoint does not need any parameter.

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

