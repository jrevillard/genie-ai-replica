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
[**apiAdminLogsRolloverPost**](AdminApi.md#apiadminlogsrolloverpost) | **POST** /api/admin/logs/rollover | Trigger log rollover
[**apiAdminLogsSearchGet**](AdminApi.md#apiadminlogssearchget) | **GET** /api/admin/logs/search | Search logs with filtering
[**apiAdminLogsSummaryGet**](AdminApi.md#apiadminlogssummaryget) | **GET** /api/admin/logs/summary | Get logs summary by type and service
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
> apiAdminLogsDebugYesterdayGet()

Debug logs for yesterday to diagnose issues

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = AdminApi();

try {
    api_instance.apiAdminLogsDebugYesterdayGet();
} catch (e) {
    print('Exception when calling AdminApi->apiAdminLogsDebugYesterdayGet: $e\n');
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

# **apiAdminLogsGet**
> apiAdminLogsGet(limit, level, service)

Get system logs

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = AdminApi();
final limit = 56; // int | Maximum number of logs to return
final level = level_example; // String | Filter logs by level (INFO, WARNING, ERROR)
final service = service_example; // String | Filter logs by service name

try {
    api_instance.apiAdminLogsGet(limit, level, service);
} catch (e) {
    print('Exception when calling AdminApi->apiAdminLogsGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **limit** | **int**| Maximum number of logs to return | [optional] 
 **level** | **String**| Filter logs by level (INFO, WARNING, ERROR) | [optional] 
 **service** | **String**| Filter logs by service name | [optional] 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiAdminLogsRolloverPost**
> apiAdminLogsRolloverPost()

Trigger log rollover

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = AdminApi();

try {
    api_instance.apiAdminLogsRolloverPost();
} catch (e) {
    print('Exception when calling AdminApi->apiAdminLogsRolloverPost: $e\n');
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

# **apiAdminLogsSearchGet**
> apiAdminLogsSearchGet(term, level, service, dateRange, startDate, endDate)

Search logs with filtering

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = AdminApi();
final term = term_example; // String | Search term
final level = level_example; // String | Filter by log level
final service = service_example; // String | Filter by service name
final dateRange = dateRange_example; // String | Date range preset
final startDate = startDate_example; // String | Custom start date (YYYY-MM-DD)
final endDate = endDate_example; // String | Custom end date (YYYY-MM-DD)

try {
    api_instance.apiAdminLogsSearchGet(term, level, service, dateRange, startDate, endDate);
} catch (e) {
    print('Exception when calling AdminApi->apiAdminLogsSearchGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **term** | **String**| Search term | [optional] 
 **level** | **String**| Filter by log level | [optional] 
 **service** | **String**| Filter by service name | [optional] 
 **dateRange** | **String**| Date range preset | [optional] 
 **startDate** | **String**| Custom start date (YYYY-MM-DD) | [optional] 
 **endDate** | **String**| Custom end date (YYYY-MM-DD) | [optional] 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiAdminLogsSummaryGet**
> apiAdminLogsSummaryGet(date, level)

Get logs summary by type and service

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = AdminApi();
final date = date_example; // String | Date for which to get logs (YYYY-MM-DD)
final level = level_example; // String | Filter by log level

try {
    api_instance.apiAdminLogsSummaryGet(date, level);
} catch (e) {
    print('Exception when calling AdminApi->apiAdminLogsSummaryGet: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **date** | **String**| Date for which to get logs (YYYY-MM-DD) | [optional] 
 **level** | **String**| Filter by log level | [optional] 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiAdminSecurityLastScanGet**
> apiAdminSecurityLastScanGet()

Retrieve the last security scan details

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = AdminApi();

try {
    api_instance.apiAdminSecurityLastScanGet();
} catch (e) {
    print('Exception when calling AdminApi->apiAdminSecurityLastScanGet: $e\n');
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

# **apiAdminSecurityMetricsGet**
> apiAdminSecurityMetricsGet()

Get security metrics

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = AdminApi();

try {
    api_instance.apiAdminSecurityMetricsGet();
} catch (e) {
    print('Exception when calling AdminApi->apiAdminSecurityMetricsGet: $e\n');
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

# **apiAdminSecurityScanPost**
> apiAdminSecurityScanPost()

Run security scan

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = AdminApi();

try {
    api_instance.apiAdminSecurityScanPost();
} catch (e) {
    print('Exception when calling AdminApi->apiAdminSecurityScanPost: $e\n');
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

# **apiAdminSystemHealthGet**
> apiAdminSystemHealthGet()

Get system health metrics

### Example
```dart
import 'package:openapi/api.dart';

final api_instance = AdminApi();

try {
    api_instance.apiAdminSystemHealthGet();
} catch (e) {
    print('Exception when calling AdminApi->apiAdminSystemHealthGet: $e\n');
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
final field = field_example; // String | Field to search (all, name, email, role)
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
 **field** | **String**| Field to search (all, name, email, role) | [optional] 
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

