# openapi.api.AdminApi

## Load the API package
```dart
import 'package:openapi/api.dart';
```

All URIs are relative to *https://localhost*

Method | HTTP request | Description
------------- | ------------- | -------------
[**apiAdminDatabaseOperationsBackupPost**](AdminApi.md#apiadmindatabaseoperationsbackuppost) | **POST** /api/admin/database-operations/backup | Backup database
[**apiAdminDatabaseOperationsOptimizePost**](AdminApi.md#apiadmindatabaseoperationsoptimizepost) | **POST** /api/admin/database-operations/optimize | Optimize database
[**apiAdminDatabaseStatsGet**](AdminApi.md#apiadmindatabasestatsget) | **GET** /api/admin/database/stats | Get database statistics
[**apiAdminDiagnosticsPost**](AdminApi.md#apiadmindiagnosticspost) | **POST** /api/admin/diagnostics | Run system diagnostics
[**apiAdminLogsDebugYesterdayGet**](AdminApi.md#apiadminlogsdebugyesterdayget) | **GET** /api/admin/logs/debug-yesterday | Debug logs for yesterday to diagnose issues
[**apiAdminLogsGet**](AdminApi.md#apiadminlogsget) | **GET** /api/admin/logs | Get system logs
[**apiAdminLogsSearchGet**](AdminApi.md#apiadminlogssearchget) | **GET** /api/admin/logs/search | Search logs with filtering
[**apiAdminLogsSummaryGet**](AdminApi.md#apiadminlogssummaryget) | **GET** /api/admin/logs/summary | Get logs summary by type and service
[**apiAdminQueriesInspectGet**](AdminApi.md#apiadminqueriesinspectget) | **GET** /api/admin/queries/inspect | Get recent queries for admin inspection (Query Inspector)
[**apiAdminQueriesInspectQueryIdGet**](AdminApi.md#apiadminqueriesinspectqueryidget) | **GET** /api/admin/queries/inspect/{queryId} | Get full query details for admin inspection
[**apiAdminSecurityLastScanGet**](AdminApi.md#apiadminsecuritylastscanget) | **GET** /api/admin/security/last-scan | Retrieve the last security scan details
[**apiAdminSecurityMetricsGet**](AdminApi.md#apiadminsecuritymetricsget) | **GET** /api/admin/security-metrics | Get security metrics
[**apiAdminSecurityScanPost**](AdminApi.md#apiadminsecurityscanpost) | **POST** /api/admin/security-scan | Run security scan
[**apiAdminSystemHealthGet**](AdminApi.md#apiadminsystemhealthget) | **GET** /api/admin/system-health | Get system health metrics
[**apiAdminUserStatsGet**](AdminApi.md#apiadminuserstatsget) | **GET** /api/admin/user-stats | Get user statistics
[**apiAdminUsersSearchGet**](AdminApi.md#apiadminuserssearchget) | **GET** /api/admin/users/search | Search users with filtering


# **apiAdminDatabaseOperationsBackupPost**
> apiAdminDatabaseOperationsBackupPost()

Backup database

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = AdminApi();

try {
    api_instance.apiAdminDatabaseOperationsBackupPost();
} catch (e) {
    print('Exception when calling AdminApi->apiAdminDatabaseOperationsBackupPost: $e\n');
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

# **apiAdminDatabaseOperationsOptimizePost**
> apiAdminDatabaseOperationsOptimizePost()

Optimize database

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = AdminApi();

try {
    api_instance.apiAdminDatabaseOperationsOptimizePost();
} catch (e) {
    print('Exception when calling AdminApi->apiAdminDatabaseOperationsOptimizePost: $e\n');
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

# **apiAdminDatabaseStatsGet**
> apiAdminDatabaseStatsGet()

Get database statistics

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = AdminApi();

try {
    api_instance.apiAdminDatabaseStatsGet();
} catch (e) {
    print('Exception when calling AdminApi->apiAdminDatabaseStatsGet: $e\n');
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

# **apiAdminDiagnosticsPost**
> apiAdminDiagnosticsPost()

Run system diagnostics

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = AdminApi();

try {
    api_instance.apiAdminDiagnosticsPost();
} catch (e) {
    print('Exception when calling AdminApi->apiAdminDiagnosticsPost: $e\n');
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

# **apiAdminLogsDebugYesterdayGet**
> ApiAdminLogsDebugYesterdayGet200Response apiAdminLogsDebugYesterdayGet()

Debug logs for yesterday to diagnose issues

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = AdminApi();

try {
    final result = api_instance.apiAdminLogsDebugYesterdayGet();
    print(result);
} catch (e) {
    print('Exception when calling AdminApi->apiAdminLogsDebugYesterdayGet: $e\n');
}
```

### Parameters
This endpoint does not need any parameter.

### Return type

[**ApiAdminLogsDebugYesterdayGet200Response**](ApiAdminLogsDebugYesterdayGet200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiAdminLogsGet**
> ApiAdminLogsGet200Response apiAdminLogsGet(limit, level, service)

Get system logs

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = AdminApi();
final limit = 56; // int | Maximum number of logs to return
final level = level_example; // String | Filter logs by level. WARN/WARNING are synonyms (normalized to WARN before the VL query). The query is a single-value severity_text:<canonical> clause; ERROR matches only ERROR, FATAL only FATAL. Use /logs/summary for the sibling view.
final service = service_example; // String | Filter logs by service name

try {
    final result = api_instance.apiAdminLogsGet(limit, level, service);
    print(result);
} catch (e) {
    print('Exception when calling AdminApi->apiAdminLogsGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **limit** | **int**| Maximum number of logs to return | [optional] 
 **level** | **String**| Filter logs by level. WARN/WARNING are synonyms (normalized to WARN before the VL query). The query is a single-value severity_text:<canonical> clause; ERROR matches only ERROR, FATAL only FATAL. Use /logs/summary for the sibling view. | [optional] 
 **service** | **String**| Filter logs by service name | [optional] 

### Return type

[**ApiAdminLogsGet200Response**](ApiAdminLogsGet200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiAdminLogsSearchGet**
> ApiAdminLogsGet200Response apiAdminLogsSearchGet(term, level, service, dateRange, startDate, endDate)

Search logs with filtering

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = AdminApi();
final term = term_example; // String | Search term
final level = level_example; // String | Filter by log level. WARN/WARNING are synonyms (normalized to WARN before the VL query). The query is a single-value severity_text:<canonical> clause; ERROR matches only ERROR, FATAL only FATAL. Use /logs/summary for the sibling view. The VL query uses the unquoted severity_text:<level> form. getLogsInRange is the only endpoint that uses the quoted form — these endpoints differ in shape.
final service = service_example; // String | Filter by service name
final dateRange = dateRange_example; // String | Date range preset
final startDate = startDate_example; // String | Custom start date (YYYY-MM-DD)
final endDate = endDate_example; // String | Custom end date (YYYY-MM-DD)

try {
    final result = api_instance.apiAdminLogsSearchGet(term, level, service, dateRange, startDate, endDate);
    print(result);
} catch (e) {
    print('Exception when calling AdminApi->apiAdminLogsSearchGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **term** | **String**| Search term | [optional] 
 **level** | **String**| Filter by log level. WARN/WARNING are synonyms (normalized to WARN before the VL query). The query is a single-value severity_text:<canonical> clause; ERROR matches only ERROR, FATAL only FATAL. Use /logs/summary for the sibling view. The VL query uses the unquoted severity_text:<level> form. getLogsInRange is the only endpoint that uses the quoted form — these endpoints differ in shape. | [optional] 
 **service** | **String**| Filter by service name | [optional] 
 **dateRange** | **String**| Date range preset | [optional] 
 **startDate** | **String**| Custom start date (YYYY-MM-DD) | [optional] 
 **endDate** | **String**| Custom end date (YYYY-MM-DD) | [optional] 

### Return type

[**ApiAdminLogsGet200Response**](ApiAdminLogsGet200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiAdminLogsSummaryGet**
> ApiAdminLogsSummaryGet200Response apiAdminLogsSummaryGet(date, level)

Get logs summary by type and service

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = AdminApi();
final date = date_example; // String | Date for which to get logs (YYYY-MM-DD)
final level = level_example; // String | Filter by log level. WARNING normalizes to WARN and is accepted; the canonical bucket keys are ERROR / WARN. WARN and WARNING are synonyms; ERROR and FATAL are siblings. The VL query OR-joins the synonyms internally. Any value outside the allowlist is rejected with 400 invalid_filter.

try {
    final result = api_instance.apiAdminLogsSummaryGet(date, level);
    print(result);
} catch (e) {
    print('Exception when calling AdminApi->apiAdminLogsSummaryGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **date** | **String**| Date for which to get logs (YYYY-MM-DD) | [optional] 
 **level** | **String**| Filter by log level. WARNING normalizes to WARN and is accepted; the canonical bucket keys are ERROR / WARN. WARN and WARNING are synonyms; ERROR and FATAL are siblings. The VL query OR-joins the synonyms internally. Any value outside the allowlist is rejected with 400 invalid_filter. | [optional] 

### Return type

[**ApiAdminLogsSummaryGet200Response**](ApiAdminLogsSummaryGet200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiAdminQueriesInspectGet**
> apiAdminQueriesInspectGet(limit, offset, userId, searchText, startDate, endDate, minConfidence, maxConfidence)

Get recent queries for admin inspection (Query Inspector)

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = AdminApi();
final limit = 56; // int | Maximum number of queries to return (default 50)
final offset = 56; // int | Offset for pagination
final userId = userId_example; // String | Filter by user ID
final searchText = searchText_example; // String | Search in query text
final startDate = startDate_example; // String | Filter from date (ISO string)
final endDate = endDate_example; // String | Filter to date (ISO string)
final minConfidence = 8.14; // num | Minimum confidence score (0-1)
final maxConfidence = 8.14; // num | Maximum confidence score (0-1)

try {
    api_instance.apiAdminQueriesInspectGet(limit, offset, userId, searchText, startDate, endDate, minConfidence, maxConfidence);
} catch (e) {
    print('Exception when calling AdminApi->apiAdminQueriesInspectGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **limit** | **int**| Maximum number of queries to return (default 50) | [optional] 
 **offset** | **int**| Offset for pagination | [optional] 
 **userId** | **String**| Filter by user ID | [optional] 
 **searchText** | **String**| Search in query text | [optional] 
 **startDate** | **String**| Filter from date (ISO string) | [optional] 
 **endDate** | **String**| Filter to date (ISO string) | [optional] 
 **minConfidence** | **num**| Minimum confidence score (0-1) | [optional] 
 **maxConfidence** | **num**| Maximum confidence score (0-1) | [optional] 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiAdminQueriesInspectQueryIdGet**
> apiAdminQueriesInspectQueryIdGet(queryId)

Get full query details for admin inspection

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = AdminApi();
final queryId = queryId_example; // String | The query ID to inspect

try {
    api_instance.apiAdminQueriesInspectQueryIdGet(queryId);
} catch (e) {
    print('Exception when calling AdminApi->apiAdminQueriesInspectQueryIdGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **queryId** | **String**| The query ID to inspect | 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiAdminSecurityLastScanGet**
> ApiAdminSecurityLastScanGet200Response apiAdminSecurityLastScanGet()

Retrieve the last security scan details

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = AdminApi();

try {
    final result = api_instance.apiAdminSecurityLastScanGet();
    print(result);
} catch (e) {
    print('Exception when calling AdminApi->apiAdminSecurityLastScanGet: $e\n');
}
```

### Parameters
This endpoint does not need any parameter.

### Return type

[**ApiAdminSecurityLastScanGet200Response**](ApiAdminSecurityLastScanGet200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiAdminSecurityMetricsGet**
> ApiAdminSecurityMetricsGet200Response apiAdminSecurityMetricsGet()

Get security metrics

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = AdminApi();

try {
    final result = api_instance.apiAdminSecurityMetricsGet();
    print(result);
} catch (e) {
    print('Exception when calling AdminApi->apiAdminSecurityMetricsGet: $e\n');
}
```

### Parameters
This endpoint does not need any parameter.

### Return type

[**ApiAdminSecurityMetricsGet200Response**](ApiAdminSecurityMetricsGet200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiAdminSecurityScanPost**
> ApiAdminSecurityScanPost200Response apiAdminSecurityScanPost()

Run security scan

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = AdminApi();

try {
    final result = api_instance.apiAdminSecurityScanPost();
    print(result);
} catch (e) {
    print('Exception when calling AdminApi->apiAdminSecurityScanPost: $e\n');
}
```

### Parameters
This endpoint does not need any parameter.

### Return type

[**ApiAdminSecurityScanPost200Response**](ApiAdminSecurityScanPost200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiAdminSystemHealthGet**
> ApiAdminSystemHealthGet200Response apiAdminSystemHealthGet()

Get system health metrics

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = AdminApi();

try {
    final result = api_instance.apiAdminSystemHealthGet();
    print(result);
} catch (e) {
    print('Exception when calling AdminApi->apiAdminSystemHealthGet: $e\n');
}
```

### Parameters
This endpoint does not need any parameter.

### Return type

[**ApiAdminSystemHealthGet200Response**](ApiAdminSystemHealthGet200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiAdminUserStatsGet**
> apiAdminUserStatsGet()

Get user statistics

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = AdminApi();

try {
    api_instance.apiAdminUserStatsGet();
} catch (e) {
    print('Exception when calling AdminApi->apiAdminUserStatsGet: $e\n');
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

# **apiAdminUsersSearchGet**
> apiAdminUsersSearchGet(term, field, limit, offset)

Search users with filtering

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = AdminApi();
final term = term_example; // String | Search term
final field = field_example; // String | Field to search (all, name, email, role, exactEmail — matches the full email literally)
final limit = 56; // int | Maximum number of users to return
final offset = 56; // int | Offset for pagination

try {
    api_instance.apiAdminUsersSearchGet(term, field, limit, offset);
} catch (e) {
    print('Exception when calling AdminApi->apiAdminUsersSearchGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **term** | **String**| Search term | [optional] 
 **field** | **String**| Field to search (all, name, email, role, exactEmail — matches the full email literally) | [optional] 
 **limit** | **int**| Maximum number of users to return | [optional] 
 **offset** | **int**| Offset for pagination | [optional] 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

