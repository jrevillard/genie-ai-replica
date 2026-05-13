# openapi.api.ServicesApi

## Load the API package
```dart
import 'package:openapi/api.dart';
```

All URIs are relative to *https://localhost*

Method | HTTP request | Description
------------- | ------------- | -------------
[**apiServicesCategoriesCategoryIdGet**](ServicesApi.md#apiservicescategoriescategoryidget) | **GET** /api/services/categories/{categoryId} | Get category with services
[**apiServicesCategoriesGet**](ServicesApi.md#apiservicescategoriesget) | **GET** /api/services/categories | Get all categories with services
[**apiServicesSearchGet**](ServicesApi.md#apiservicessearchget) | **GET** /api/services/search | Search categories and services


# **apiServicesCategoriesCategoryIdGet**
> ApiServicesCategoriesGet200ResponseInner apiServicesCategoriesCategoryIdGet(categoryId, locale)

Get category with services

Retrieves a specific service category with its associated services

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = ServicesApi();
final categoryId = categoryId_example; // String | Category ID
final locale = locale_example; // String | Language locale for category and service names

try {
    final result = api_instance.apiServicesCategoriesCategoryIdGet(categoryId, locale);
    print(result);
} catch (e) {
    print('Exception when calling ServicesApi->apiServicesCategoriesCategoryIdGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **categoryId** | **String**| Category ID | 
 **locale** | **String**| Language locale for category and service names | [optional] [default to 'en']

### Return type

[**ApiServicesCategoriesGet200ResponseInner**](ApiServicesCategoriesGet200ResponseInner.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiServicesCategoriesGet**
> List<ApiServicesCategoriesGet200ResponseInner> apiServicesCategoriesGet(locale)

Get all categories with services

Retrieves all service categories with their associated services

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = ServicesApi();
final locale = locale_example; // String | Language locale for category and service names

try {
    final result = api_instance.apiServicesCategoriesGet(locale);
    print(result);
} catch (e) {
    print('Exception when calling ServicesApi->apiServicesCategoriesGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **locale** | **String**| Language locale for category and service names | [optional] [default to 'en']

### Return type

[**List<ApiServicesCategoriesGet200ResponseInner>**](ApiServicesCategoriesGet200ResponseInner.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiServicesSearchGet**
> ApiServicesSearchGet200Response apiServicesSearchGet(query, locale)

Search categories and services

Searches for categories and services based on a query string

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = ServicesApi();
final query = query_example; // String | Search query
final locale = locale_example; // String | Language locale for search results

try {
    final result = api_instance.apiServicesSearchGet(query, locale);
    print(result);
} catch (e) {
    print('Exception when calling ServicesApi->apiServicesSearchGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **query** | **String**| Search query | 
 **locale** | **String**| Language locale for search results | [optional] [default to 'en']

### Return type

[**ApiServicesSearchGet200Response**](ApiServicesSearchGet200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

