# openapi.api.AuthenticationApi

## Load the API package
```dart
import 'package:openapi/api.dart';
```

All URIs are relative to *https://localhost*

Method | HTTP request | Description
------------- | ------------- | -------------
[**apiAuthLogoutPost**](AuthenticationApi.md#apiauthlogoutpost) | **POST** /api/auth/logout | User logout


# **apiAuthLogoutPost**
> apiAuthLogoutPost()

User logout

Logout endpoint (Keycloak handles session invalidation server-side)

### Example
```dart
import 'package:openapi/api.dart';
final api_client = ApiClient(authentication: OAuth(accessToken: 'YOUR_ACCESS_TOKEN'));

final api_instance = AuthenticationApi(api_client);

try {
    api_instance.apiAuthLogoutPost();
} catch (e) {
    print('Exception when calling AuthenticationApi->apiAuthLogoutPost: $e\n');
}
```

### Parameters
This endpoint does not need any parameter.

### Return type

void (empty response body)

### Authorization

[KeycloakOAuth2](../README.md#KeycloakOAuth2)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

