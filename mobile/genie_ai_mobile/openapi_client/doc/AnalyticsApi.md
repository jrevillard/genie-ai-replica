# openapi.api.AnalyticsApi

## Load the API package
```dart
import 'package:openapi/api.dart';
```

All URIs are relative to *https://localhost*

Method | HTTP request | Description
------------- | ------------- | -------------
[**apiAnalyticsDashboardGet**](AnalyticsApi.md#apianalyticsdashboardget) | **GET** /api/analytics/dashboard | Get dashboard analytics
[**apiAnalyticsEventsGet**](AnalyticsApi.md#apianalyticseventsget) | **GET** /api/analytics/events | Get events records
[**apiAnalyticsEventsPost**](AnalyticsApi.md#apianalyticseventspost) | **POST** /api/analytics/events | Track an event
[**apiAnalyticsGet**](AnalyticsApi.md#apianalyticsget) | **GET** /api/analytics | Get general analytics
[**apiAnalyticsMetricMetricGet**](AnalyticsApi.md#apianalyticsmetricmetricget) | **GET** /api/analytics/metric/{metric} | Get specific metric data
[**apiAnalyticsRecordsGet**](AnalyticsApi.md#apianalyticsrecordsget) | **GET** /api/analytics/records | Get analytics records
[**apiAnalyticsSatisfactionGaugeGet**](AnalyticsApi.md#apianalyticssatisfactiongaugeget) | **GET** /api/analytics/satisfaction/gauge | Get satisfaction gauge data
[**apiAnalyticsSatisfactionHeatmapGet**](AnalyticsApi.md#apianalyticssatisfactionheatmapget) | **GET** /api/analytics/satisfaction/heatmap | Get satisfaction heatmap data
[**apiAnalyticsTimeseriesMetricTypeGet**](AnalyticsApi.md#apianalyticstimeseriesmetrictypeget) | **GET** /api/analytics/timeseries/{metricType} | Get time series data


# **apiAnalyticsDashboardGet**
> ApiAnalyticsDashboardGet200Response apiAnalyticsDashboardGet(startDate, endDate, locale)

Get dashboard analytics

Retrieves analytics data for the dashboard within a date range

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = AnalyticsApi();
final startDate = 2013-10-20; // DateTime | Start date (YYYY-MM-DD)
final endDate = 2013-10-20T19:20:30+01:00; // DateTime | End date (ISO format)
final locale = locale_example; // String | Language locale for category names (e.g. en, fr, sw, ar, id, es, etc.)

try {
    final result = api_instance.apiAnalyticsDashboardGet(startDate, endDate, locale);
    print(result);
} catch (e) {
    print('Exception when calling AnalyticsApi->apiAnalyticsDashboardGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **startDate** | **DateTime**| Start date (YYYY-MM-DD) | [optional] 
 **endDate** | **DateTime**| End date (ISO format) | [optional] 
 **locale** | **String**| Language locale for category names (e.g. en, fr, sw, ar, id, es, etc.) | [optional] [default to 'en']

### Return type

[**ApiAnalyticsDashboardGet200Response**](ApiAnalyticsDashboardGet200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiAnalyticsEventsGet**
> List<Event> apiAnalyticsEventsGet(limit, offset)

Get events records

Retrieves event records with pagination

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = AnalyticsApi();
final limit = 56; // int | Maximum number of results to return
final offset = 56; // int | Number of results to skip for pagination

try {
    final result = api_instance.apiAnalyticsEventsGet(limit, offset);
    print(result);
} catch (e) {
    print('Exception when calling AnalyticsApi->apiAnalyticsEventsGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **limit** | **int**| Maximum number of results to return | [optional] [default to 20]
 **offset** | **int**| Number of results to skip for pagination | [optional] [default to 0]

### Return type

[**List<Event>**](Event.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiAnalyticsEventsPost**
> Event apiAnalyticsEventsPost(apiAnalyticsEventsPostRequest)

Track an event

Records a user event for analytics

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = AnalyticsApi();
final apiAnalyticsEventsPostRequest = ApiAnalyticsEventsPostRequest(); // ApiAnalyticsEventsPostRequest | 

try {
    final result = api_instance.apiAnalyticsEventsPost(apiAnalyticsEventsPostRequest);
    print(result);
} catch (e) {
    print('Exception when calling AnalyticsApi->apiAnalyticsEventsPost: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **apiAnalyticsEventsPostRequest** | [**ApiAnalyticsEventsPostRequest**](ApiAnalyticsEventsPostRequest.md)|  | 

### Return type

[**Event**](Event.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiAnalyticsGet**
> ApiAnalyticsGet200Response apiAnalyticsGet(startDate, endDate, filters, locale)

Get general analytics

Retrieves general analytics data with optional filters and date range

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = AnalyticsApi();
final startDate = 2013-10-20T19:20:30+01:00; // DateTime | Start date (ISO format)
final endDate = 2013-10-20T19:20:30+01:00; // DateTime | End date (ISO format)
final filters = filters_example; // String | JSON string of filter criteria
final locale = locale_example; // String | Language locale for category names (e.g. en, fr, sw, ar, id, es, etc.)

try {
    final result = api_instance.apiAnalyticsGet(startDate, endDate, filters, locale);
    print(result);
} catch (e) {
    print('Exception when calling AnalyticsApi->apiAnalyticsGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **startDate** | **DateTime**| Start date (ISO format) | [optional] 
 **endDate** | **DateTime**| End date (ISO format) | [optional] 
 **filters** | **String**| JSON string of filter criteria | [optional] 
 **locale** | **String**| Language locale for category names (e.g. en, fr, sw, ar, id, es, etc.) | [optional] [default to 'en']

### Return type

[**ApiAnalyticsGet200Response**](ApiAnalyticsGet200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiAnalyticsMetricMetricGet**
> ApiAnalyticsMetricMetricGet200Response apiAnalyticsMetricMetricGet(metric, startDate, endDate)

Get specific metric data

Retrieves data for a specific analytics metric

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = AnalyticsApi();
final metric = metric_example; // String | Metric name
final startDate = 2013-10-20T19:20:30+01:00; // DateTime | Start date (ISO format)
final endDate = 2013-10-20T19:20:30+01:00; // DateTime | End date (ISO format)

try {
    final result = api_instance.apiAnalyticsMetricMetricGet(metric, startDate, endDate);
    print(result);
} catch (e) {
    print('Exception when calling AnalyticsApi->apiAnalyticsMetricMetricGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **metric** | **String**| Metric name | 
 **startDate** | **DateTime**| Start date (ISO format) | 
 **endDate** | **DateTime**| End date (ISO format) | 

### Return type

[**ApiAnalyticsMetricMetricGet200Response**](ApiAnalyticsMetricMetricGet200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiAnalyticsRecordsGet**
> List<Analytics> apiAnalyticsRecordsGet(limit, offset)

Get analytics records

Retrieves analytics records with pagination

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = AnalyticsApi();
final limit = 56; // int | Maximum number of results to return
final offset = 56; // int | Number of results to skip for pagination

try {
    final result = api_instance.apiAnalyticsRecordsGet(limit, offset);
    print(result);
} catch (e) {
    print('Exception when calling AnalyticsApi->apiAnalyticsRecordsGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **limit** | **int**| Maximum number of results to return | [optional] [default to 20]
 **offset** | **int**| Number of results to skip for pagination | [optional] [default to 0]

### Return type

[**List<Analytics>**](Analytics.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiAnalyticsSatisfactionGaugeGet**
> ApiAnalyticsSatisfactionGaugeGet200Response apiAnalyticsSatisfactionGaugeGet(startDate, endDate, locale)

Get satisfaction gauge data

Retrieves satisfaction percentage data for the gauge visualization

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = AnalyticsApi();
final startDate = 2013-10-20T19:20:30+01:00; // DateTime | Start date (ISO format)
final endDate = 2013-10-20T19:20:30+01:00; // DateTime | End date (ISO format)
final locale = locale_example; // String | Language locale (e.g. en, fr, sw, ar, id, es, etc.)

try {
    final result = api_instance.apiAnalyticsSatisfactionGaugeGet(startDate, endDate, locale);
    print(result);
} catch (e) {
    print('Exception when calling AnalyticsApi->apiAnalyticsSatisfactionGaugeGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **startDate** | **DateTime**| Start date (ISO format) | [optional] 
 **endDate** | **DateTime**| End date (ISO format) | [optional] 
 **locale** | **String**| Language locale (e.g. en, fr, sw, ar, id, es, etc.) | [optional] [default to 'en']

### Return type

[**ApiAnalyticsSatisfactionGaugeGet200Response**](ApiAnalyticsSatisfactionGaugeGet200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiAnalyticsSatisfactionHeatmapGet**
> List<ApiAnalyticsSatisfactionHeatmapGet200ResponseInner> apiAnalyticsSatisfactionHeatmapGet(startDate, endDate, locale)

Get satisfaction heatmap data

Retrieves satisfaction percentage data by knowledge area over time

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = AnalyticsApi();
final startDate = 2013-10-20T19:20:30+01:00; // DateTime | Start date (ISO format)
final endDate = 2013-10-20T19:20:30+01:00; // DateTime | End date (ISO format)
final locale = locale_example; // String | Language locale (e.g. en, fr, sw, ar, id, es, etc.)

try {
    final result = api_instance.apiAnalyticsSatisfactionHeatmapGet(startDate, endDate, locale);
    print(result);
} catch (e) {
    print('Exception when calling AnalyticsApi->apiAnalyticsSatisfactionHeatmapGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **startDate** | **DateTime**| Start date (ISO format) | [optional] 
 **endDate** | **DateTime**| End date (ISO format) | [optional] 
 **locale** | **String**| Language locale (e.g. en, fr, sw, ar, id, es, etc.) | [optional] [default to 'en']

### Return type

[**List<ApiAnalyticsSatisfactionHeatmapGet200ResponseInner>**](ApiAnalyticsSatisfactionHeatmapGet200ResponseInner.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiAnalyticsTimeseriesMetricTypeGet**
> List<ApiAnalyticsTimeseriesMetricTypeGet200ResponseInner> apiAnalyticsTimeseriesMetricTypeGet(metricType, interval, startDate, endDate)

Get time series data

Retrieves time series data for a specific metric, interval, and date range

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = AnalyticsApi();
final metricType = metricType_example; // String | Metric type name (e.g., queries, users)
final interval = interval_example; // String | Time interval for grouping
final startDate = 2013-10-20T19:20:30+01:00; // DateTime | Start date (ISO format)
final endDate = 2013-10-20T19:20:30+01:00; // DateTime | End date (ISO format)

try {
    final result = api_instance.apiAnalyticsTimeseriesMetricTypeGet(metricType, interval, startDate, endDate);
    print(result);
} catch (e) {
    print('Exception when calling AnalyticsApi->apiAnalyticsTimeseriesMetricTypeGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **metricType** | **String**| Metric type name (e.g., queries, users) | 
 **interval** | **String**| Time interval for grouping | [optional] [default to 'daily']
 **startDate** | **DateTime**| Start date (ISO format) | [optional] 
 **endDate** | **DateTime**| End date (ISO format) | [optional] 

### Return type

[**List<ApiAnalyticsTimeseriesMetricTypeGet200ResponseInner>**](ApiAnalyticsTimeseriesMetricTypeGet200ResponseInner.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

