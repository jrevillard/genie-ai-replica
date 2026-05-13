# openapi.api.ServiceCategoriesApi

## Load the API package
```dart
import 'package:openapi/api.dart';
```

All URIs are relative to *https://localhost*

Method | HTTP request | Description
------------- | ------------- | -------------
[**apiServiceCategoriesCategoriesCategoryIdGet**](ServiceCategoriesApi.md#apiservicecategoriescategoriescategoryidget) | **GET** /api/service-categories/categories/{categoryId} | Get category with services
[**apiServiceCategoriesCategoriesDetailedGet**](ServiceCategoriesApi.md#apiservicecategoriescategoriesdetailedget) | **GET** /api/service-categories/categories/detailed | Get all categories with detailed services for admin
[**apiServiceCategoriesCategoriesGet**](ServiceCategoriesApi.md#apiservicecategoriescategoriesget) | **GET** /api/service-categories/categories | Get all categories with services
[**apiServiceCategoriesCategoryIdDelete**](ServiceCategoriesApi.md#apiservicecategoriescategoryiddelete) | **DELETE** /api/service-categories/{categoryId} | Delete a category
[**apiServiceCategoriesCategoryIdPut**](ServiceCategoriesApi.md#apiservicecategoriescategoryidput) | **PUT** /api/service-categories/{categoryId} | Update an existing category
[**apiServiceCategoriesCategoryIdServicesPost**](ServiceCategoriesApi.md#apiservicecategoriescategoryidservicespost) | **POST** /api/service-categories/{categoryId}/services | Create a new service for a category
[**apiServiceCategoriesCategoryIdTranslationsGet**](ServiceCategoriesApi.md#apiservicecategoriescategoryidtranslationsget) | **GET** /api/service-categories/{categoryId}/translations | Get all translations for a category
[**apiServiceCategoriesInitPost**](ServiceCategoriesApi.md#apiservicecategoriesinitpost) | **POST** /api/service-categories/init | Initialize default categories
[**apiServiceCategoriesPost**](ServiceCategoriesApi.md#apiservicecategoriespost) | **POST** /api/service-categories | Create a new category
[**apiServiceCategoriesSearchGet**](ServiceCategoriesApi.md#apiservicecategoriessearchget) | **GET** /api/service-categories/search | Search categories and services
[**apiServiceCategoriesServicesServiceIdDelete**](ServiceCategoriesApi.md#apiservicecategoriesservicesserviceiddelete) | **DELETE** /api/service-categories/services/{serviceId} | Delete a service
[**apiServiceCategoriesServicesServiceIdPut**](ServiceCategoriesApi.md#apiservicecategoriesservicesserviceidput) | **PUT** /api/service-categories/services/{serviceId} | Update an existing service
[**apiServiceCategoriesServicesServiceIdTranslationsGet**](ServiceCategoriesApi.md#apiservicecategoriesservicesserviceidtranslationsget) | **GET** /api/service-categories/services/{serviceId}/translations | Get all translations for a service


# **apiServiceCategoriesCategoriesCategoryIdGet**
> ApiServiceCategoriesCategoriesGet200ResponseInner apiServiceCategoriesCategoriesCategoryIdGet(categoryId, locale)

Get category with services

Retrieves a specific service category with its associated services

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = ServiceCategoriesApi();
final categoryId = categoryId_example; // String | Category key
final locale = locale_example; // String | Language locale for category and service names

try {
    final result = api_instance.apiServiceCategoriesCategoriesCategoryIdGet(categoryId, locale);
    print(result);
} catch (e) {
    print('Exception when calling ServiceCategoriesApi->apiServiceCategoriesCategoriesCategoryIdGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **categoryId** | **String**| Category key | 
 **locale** | **String**| Language locale for category and service names | [optional] [default to 'en']

### Return type

[**ApiServiceCategoriesCategoriesGet200ResponseInner**](ApiServiceCategoriesCategoriesGet200ResponseInner.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiServiceCategoriesCategoriesDetailedGet**
> apiServiceCategoriesCategoriesDetailedGet(locale)

Get all categories with detailed services for admin

Retrieves all categories with their associated services as objects (including keys)

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = ServiceCategoriesApi();
final locale = locale_example; // String | Language locale for category and service names

try {
    api_instance.apiServiceCategoriesCategoriesDetailedGet(locale);
} catch (e) {
    print('Exception when calling ServiceCategoriesApi->apiServiceCategoriesCategoriesDetailedGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **locale** | **String**| Language locale for category and service names | [optional] [default to 'en']

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiServiceCategoriesCategoriesGet**
> List<ApiServiceCategoriesCategoriesGet200ResponseInner> apiServiceCategoriesCategoriesGet(locale)

Get all categories with services

Retrieves all service categories with their associated services

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = ServiceCategoriesApi();
final locale = locale_example; // String | Language locale for category and service names

try {
    final result = api_instance.apiServiceCategoriesCategoriesGet(locale);
    print(result);
} catch (e) {
    print('Exception when calling ServiceCategoriesApi->apiServiceCategoriesCategoriesGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **locale** | **String**| Language locale for category and service names | [optional] [default to 'en']

### Return type

[**List<ApiServiceCategoriesCategoriesGet200ResponseInner>**](ApiServiceCategoriesCategoriesGet200ResponseInner.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiServiceCategoriesCategoryIdDelete**
> apiServiceCategoriesCategoryIdDelete(categoryId)

Delete a category

Deletes a service category and its associated services

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = ServiceCategoriesApi();
final categoryId = categoryId_example; // String | Category key

try {
    api_instance.apiServiceCategoriesCategoryIdDelete(categoryId);
} catch (e) {
    print('Exception when calling ServiceCategoriesApi->apiServiceCategoriesCategoryIdDelete: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **categoryId** | **String**| Category key | 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiServiceCategoriesCategoryIdPut**
> apiServiceCategoriesCategoryIdPut(categoryId, apiServiceCategoriesPostRequest)

Update an existing category

Updates a category's name and translations

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = ServiceCategoriesApi();
final categoryId = categoryId_example; // String | The key of the category to update
final apiServiceCategoriesPostRequest = ApiServiceCategoriesPostRequest(); // ApiServiceCategoriesPostRequest | 

try {
    api_instance.apiServiceCategoriesCategoryIdPut(categoryId, apiServiceCategoriesPostRequest);
} catch (e) {
    print('Exception when calling ServiceCategoriesApi->apiServiceCategoriesCategoryIdPut: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **categoryId** | **String**| The key of the category to update | 
 **apiServiceCategoriesPostRequest** | [**ApiServiceCategoriesPostRequest**](ApiServiceCategoriesPostRequest.md)|  | 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiServiceCategoriesCategoryIdServicesPost**
> apiServiceCategoriesCategoryIdServicesPost(categoryId, apiServiceCategoriesPostRequest)

Create a new service for a category

Creates a new service with translations under a specific category

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = ServiceCategoriesApi();
final categoryId = categoryId_example; // String | The key of the parent category
final apiServiceCategoriesPostRequest = ApiServiceCategoriesPostRequest(); // ApiServiceCategoriesPostRequest | 

try {
    api_instance.apiServiceCategoriesCategoryIdServicesPost(categoryId, apiServiceCategoriesPostRequest);
} catch (e) {
    print('Exception when calling ServiceCategoriesApi->apiServiceCategoriesCategoryIdServicesPost: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **categoryId** | **String**| The key of the parent category | 
 **apiServiceCategoriesPostRequest** | [**ApiServiceCategoriesPostRequest**](ApiServiceCategoriesPostRequest.md)|  | 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiServiceCategoriesCategoryIdTranslationsGet**
> List<ApiServiceCategoriesCategoryIdTranslationsGet200ResponseInner> apiServiceCategoriesCategoryIdTranslationsGet(categoryId)

Get all translations for a category

Retrieves all available translations for a specific service category

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = ServiceCategoriesApi();
final categoryId = categoryId_example; // String | The key of the category

try {
    final result = api_instance.apiServiceCategoriesCategoryIdTranslationsGet(categoryId);
    print(result);
} catch (e) {
    print('Exception when calling ServiceCategoriesApi->apiServiceCategoriesCategoryIdTranslationsGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **categoryId** | **String**| The key of the category | 

### Return type

[**List<ApiServiceCategoriesCategoryIdTranslationsGet200ResponseInner>**](ApiServiceCategoriesCategoryIdTranslationsGet200ResponseInner.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiServiceCategoriesInitPost**
> ApiServiceCategoriesInitPost200Response apiServiceCategoriesInitPost()

Initialize default categories

Initializes the system with default categories and services

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = ServiceCategoriesApi();

try {
    final result = api_instance.apiServiceCategoriesInitPost();
    print(result);
} catch (e) {
    print('Exception when calling ServiceCategoriesApi->apiServiceCategoriesInitPost: $e\n');
}
```

### Parameters
This endpoint does not need any parameter.

### Return type

[**ApiServiceCategoriesInitPost200Response**](ApiServiceCategoriesInitPost200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiServiceCategoriesPost**
> apiServiceCategoriesPost(apiServiceCategoriesPostRequest)

Create a new category

Creates a new service category with translations

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = ServiceCategoriesApi();
final apiServiceCategoriesPostRequest = ApiServiceCategoriesPostRequest(); // ApiServiceCategoriesPostRequest | 

try {
    api_instance.apiServiceCategoriesPost(apiServiceCategoriesPostRequest);
} catch (e) {
    print('Exception when calling ServiceCategoriesApi->apiServiceCategoriesPost: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **apiServiceCategoriesPostRequest** | [**ApiServiceCategoriesPostRequest**](ApiServiceCategoriesPostRequest.md)|  | 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiServiceCategoriesSearchGet**
> ApiServiceCategoriesSearchGet200Response apiServiceCategoriesSearchGet(query, locale)

Search categories and services

Searches for categories and services based on a query string

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = ServiceCategoriesApi();
final query = query_example; // String | Search query
final locale = locale_example; // String | Language locale for search results

try {
    final result = api_instance.apiServiceCategoriesSearchGet(query, locale);
    print(result);
} catch (e) {
    print('Exception when calling ServiceCategoriesApi->apiServiceCategoriesSearchGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **query** | **String**| Search query | 
 **locale** | **String**| Language locale for search results | [optional] [default to 'en']

### Return type

[**ApiServiceCategoriesSearchGet200Response**](ApiServiceCategoriesSearchGet200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiServiceCategoriesServicesServiceIdDelete**
> apiServiceCategoriesServicesServiceIdDelete(serviceId)

Delete a service

Deletes a service and its associated translations

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = ServiceCategoriesApi();
final serviceId = serviceId_example; // String | The key of the service to delete

try {
    api_instance.apiServiceCategoriesServicesServiceIdDelete(serviceId);
} catch (e) {
    print('Exception when calling ServiceCategoriesApi->apiServiceCategoriesServicesServiceIdDelete: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **serviceId** | **String**| The key of the service to delete | 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiServiceCategoriesServicesServiceIdPut**
> apiServiceCategoriesServicesServiceIdPut(serviceId, apiServiceCategoriesPostRequest)

Update an existing service

Updates a service's name and its associated translations

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = ServiceCategoriesApi();
final serviceId = serviceId_example; // String | The key of the service to update
final apiServiceCategoriesPostRequest = ApiServiceCategoriesPostRequest(); // ApiServiceCategoriesPostRequest | 

try {
    api_instance.apiServiceCategoriesServicesServiceIdPut(serviceId, apiServiceCategoriesPostRequest);
} catch (e) {
    print('Exception when calling ServiceCategoriesApi->apiServiceCategoriesServicesServiceIdPut: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **serviceId** | **String**| The key of the service to update | 
 **apiServiceCategoriesPostRequest** | [**ApiServiceCategoriesPostRequest**](ApiServiceCategoriesPostRequest.md)|  | 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiServiceCategoriesServicesServiceIdTranslationsGet**
> apiServiceCategoriesServicesServiceIdTranslationsGet(serviceId)

Get all translations for a service

Retrieves all available translations for a specific service

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = ServiceCategoriesApi();
final serviceId = serviceId_example; // String | The key of the service

try {
    api_instance.apiServiceCategoriesServicesServiceIdTranslationsGet(serviceId);
} catch (e) {
    print('Exception when calling ServiceCategoriesApi->apiServiceCategoriesServicesServiceIdTranslationsGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **serviceId** | **String**| The key of the service | 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

