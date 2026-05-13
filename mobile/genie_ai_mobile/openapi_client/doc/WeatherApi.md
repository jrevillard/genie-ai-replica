# openapi.api.WeatherApi

## Load the API package
```dart
import 'package:openapi/api.dart';
```

All URIs are relative to *https://localhost*

Method | HTTP request | Description
------------- | ------------- | -------------
[**apiWeatherPost**](WeatherApi.md#apiweatherpost) | **POST** /api/weather | Get weather data for a location


# **apiWeatherPost**
> ApiWeatherPost200Response apiWeatherPost(apiWeatherPostRequest)

Get weather data for a location

Fetches current weather and forecast for the specified location. Defaults to server location if no coordinates provided.

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = WeatherApi();
final apiWeatherPostRequest = ApiWeatherPostRequest(); // ApiWeatherPostRequest | 

try {
    final result = api_instance.apiWeatherPost(apiWeatherPostRequest);
    print(result);
} catch (e) {
    print('Exception when calling WeatherApi->apiWeatherPost: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **apiWeatherPostRequest** | [**ApiWeatherPostRequest**](ApiWeatherPostRequest.md)|  | 

### Return type

[**ApiWeatherPost200Response**](ApiWeatherPost200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

