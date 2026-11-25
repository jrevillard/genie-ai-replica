# openapi.api.AgricultureApi

## Load the API package
```dart
import 'package:openapi/api.dart';
```

All URIs are relative to *https://localhost*

Method | HTTP request | Description
------------- | ------------- | -------------
[**apiAgriCropHealthGet**](AgricultureApi.md#apiagricrophealthget) | **GET** /api/agri/crop-health | Crop health (NDVI) per El Salvador department
[**apiAgriHealthGet**](AgricultureApi.md#apiagrihealthget) | **GET** /api/agri/health | Per-source adapter health
[**apiAgriMarketPricesCategoryGet**](AgricultureApi.md#apiagrimarketpricescategoryget) | **GET** /api/agri/market-prices/{category} | Market price series for a commodity category
[**apiAgriNewsGet**](AgricultureApi.md#apiagrinewsget) | **GET** /api/agri/news | Recent agriculture news for the prediction dialogs
[**apiAgriPestAlertsGet**](AgricultureApi.md#apiagripestalertsget) | **GET** /api/agri/pest-alerts | Pest advisories, regional news and community sightings


# **apiAgriCropHealthGet**
> apiAgriCropHealthGet()

Crop health (NDVI) per El Salvador department

Dekadal NDVI with long-term-average baseline, trend and health bucket. Served from cache — never contacts upstream APIs on the request path.

### Example
```dart
import 'package:openapi/api.dart';
final api_client = ApiClient(authentication: OAuth(accessToken: 'YOUR_ACCESS_TOKEN'));

final api_instance = AgricultureApi(api_client);

try {
    api_instance.apiAgriCropHealthGet();
} catch (e) {
    print('Exception when calling AgricultureApi->apiAgriCropHealthGet: $e\n');
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

# **apiAgriHealthGet**
> apiAgriHealthGet()

Per-source adapter health

Last fetch result, age and latest data date for every enabled source adapter.

### Example
```dart
import 'package:openapi/api.dart';
final api_client = ApiClient(authentication: OAuth(accessToken: 'YOUR_ACCESS_TOKEN'));

final api_instance = AgricultureApi(api_client);

try {
    api_instance.apiAgriHealthGet();
} catch (e) {
    print('Exception when calling AgricultureApi->apiAgriHealthGet: $e\n');
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

# **apiAgriMarketPricesCategoryGet**
> apiAgriMarketPricesCategoryGet(category)

Market price series for a commodity category

Composite series with degradation order, CPI-estimated gap years (dashed in UI), regional-reference labels and structured caveats.

### Example
```dart
import 'package:openapi/api.dart';
final api_client = ApiClient(authentication: OAuth(accessToken: 'YOUR_ACCESS_TOKEN'));

final api_instance = AgricultureApi(api_client);
final category = category_example; // String | 

try {
    api_instance.apiAgriMarketPricesCategoryGet(category);
} catch (e) {
    print('Exception when calling AgricultureApi->apiAgriMarketPricesCategoryGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **category** | **String**|  | 

### Return type

void (empty response body)

### Authorization

[KeycloakOAuth2](../README.md#KeycloakOAuth2)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiAgriNewsGet**
> apiAgriNewsGet(scope, lang)

Recent agriculture news for the prediction dialogs

Headline picker feed. scope=global (GDELT, EN/ES) or local (MAG, Presidencia, CoLatino — ES). 48h window widened to 7d when quiet.

### Example
```dart
import 'package:openapi/api.dart';
final api_client = ApiClient(authentication: OAuth(accessToken: 'YOUR_ACCESS_TOKEN'));

final api_instance = AgricultureApi(api_client);
final scope = scope_example; // String | 
final lang = lang_example; // String | 

try {
    api_instance.apiAgriNewsGet(scope, lang);
} catch (e) {
    print('Exception when calling AgricultureApi->apiAgriNewsGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **scope** | **String**|  | [optional] [default to 'global']
 **lang** | **String**|  | [optional] [default to 'es']

### Return type

void (empty response body)

### Authorization

[KeycloakOAuth2](../README.md#KeycloakOAuth2)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiAgriPestAlertsGet**
> apiAgriPestAlertsGet()

Pest advisories, regional news and community sightings

Three honest sections — curated seasonal advisories, OIRSA regional plant-health news, iNaturalist community sightings (last 90 days).

### Example
```dart
import 'package:openapi/api.dart';
final api_client = ApiClient(authentication: OAuth(accessToken: 'YOUR_ACCESS_TOKEN'));

final api_instance = AgricultureApi(api_client);

try {
    api_instance.apiAgriPestAlertsGet();
} catch (e) {
    print('Exception when calling AgricultureApi->apiAgriPestAlertsGet: $e\n');
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

