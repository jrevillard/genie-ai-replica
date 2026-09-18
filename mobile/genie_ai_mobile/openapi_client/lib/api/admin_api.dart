//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AdminApi {
  AdminApi([ApiClient? apiClient]) : apiClient = apiClient ?? defaultApiClient;

  final ApiClient apiClient;

  /// Get recent queries for admin inspection (Query Inspector)
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [int] limit:
  ///   Maximum number of queries to return (default 50)
  ///
  /// * [int] offset:
  ///   Offset for pagination
  ///
  /// * [String] userId:
  ///   Filter by user ID
  ///
  /// * [String] searchText:
  ///   Search in query text
  ///
  /// * [String] startDate:
  ///   Filter from date (ISO string)
  ///
  /// * [String] endDate:
  ///   Filter to date (ISO string)
  ///
  /// * [num] minConfidence:
  ///   Minimum confidence score (0-1)
  ///
  /// * [num] maxConfidence:
  ///   Maximum confidence score (0-1)
  Future<Response> adminQueriesInspectGetWithHttpInfo({ int? limit, int? offset, String? userId, String? searchText, String? startDate, String? endDate, num? minConfidence, num? maxConfidence, Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/admin/queries/inspect';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    if (limit != null) {
      queryParams.addAll(_queryParams('', 'limit', limit));
    }
    if (offset != null) {
      queryParams.addAll(_queryParams('', 'offset', offset));
    }
    if (userId != null) {
      queryParams.addAll(_queryParams('', 'userId', userId));
    }
    if (searchText != null) {
      queryParams.addAll(_queryParams('', 'searchText', searchText));
    }
    if (startDate != null) {
      queryParams.addAll(_queryParams('', 'startDate', startDate));
    }
    if (endDate != null) {
      queryParams.addAll(_queryParams('', 'endDate', endDate));
    }
    if (minConfidence != null) {
      queryParams.addAll(_queryParams('', 'minConfidence', minConfidence));
    }
    if (maxConfidence != null) {
      queryParams.addAll(_queryParams('', 'maxConfidence', maxConfidence));
    }

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      path,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Get recent queries for admin inspection (Query Inspector)
  ///
  /// Parameters:
  ///
  /// * [int] limit:
  ///   Maximum number of queries to return (default 50)
  ///
  /// * [int] offset:
  ///   Offset for pagination
  ///
  /// * [String] userId:
  ///   Filter by user ID
  ///
  /// * [String] searchText:
  ///   Search in query text
  ///
  /// * [String] startDate:
  ///   Filter from date (ISO string)
  ///
  /// * [String] endDate:
  ///   Filter to date (ISO string)
  ///
  /// * [num] minConfidence:
  ///   Minimum confidence score (0-1)
  ///
  /// * [num] maxConfidence:
  ///   Maximum confidence score (0-1)
  Future<void> adminQueriesInspectGet({ int? limit, int? offset, String? userId, String? searchText, String? startDate, String? endDate, num? minConfidence, num? maxConfidence, Future<void>? abortTrigger, }) async {
    final response = await adminQueriesInspectGetWithHttpInfo(limit: limit, offset: offset, userId: userId, searchText: searchText, startDate: startDate, endDate: endDate, minConfidence: minConfidence, maxConfidence: maxConfidence, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Get full query details for admin inspection
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] queryId (required):
  ///   The query ID to inspect
  Future<Response> adminQueriesInspectQueryIdGetWithHttpInfo(String queryId, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/admin/queries/inspect/{queryId}'
      .replaceAll('{queryId}', queryId);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      path,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Get full query details for admin inspection
  ///
  /// Parameters:
  ///
  /// * [String] queryId (required):
  ///   The query ID to inspect
  Future<void> adminQueriesInspectQueryIdGet(String queryId, { Future<void>? abortTrigger, }) async {
    final response = await adminQueriesInspectQueryIdGetWithHttpInfo(queryId, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Backup database
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> apiAdminDatabaseOperationsBackupPostWithHttpInfo({ Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/admin/database-operations/backup';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      path,
      'POST',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Backup database
  Future<void> apiAdminDatabaseOperationsBackupPost({ Future<void>? abortTrigger, }) async {
    final response = await apiAdminDatabaseOperationsBackupPostWithHttpInfo(abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Optimize database
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> apiAdminDatabaseOperationsOptimizePostWithHttpInfo({ Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/admin/database-operations/optimize';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      path,
      'POST',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Optimize database
  Future<void> apiAdminDatabaseOperationsOptimizePost({ Future<void>? abortTrigger, }) async {
    final response = await apiAdminDatabaseOperationsOptimizePostWithHttpInfo(abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Get database statistics
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> apiAdminDatabaseStatsGetWithHttpInfo({ Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/admin/database/stats';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      path,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Get database statistics
  Future<void> apiAdminDatabaseStatsGet({ Future<void>? abortTrigger, }) async {
    final response = await apiAdminDatabaseStatsGetWithHttpInfo(abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Run system diagnostics
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> apiAdminDiagnosticsPostWithHttpInfo({ Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/admin/diagnostics';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      path,
      'POST',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Run system diagnostics
  Future<void> apiAdminDiagnosticsPost({ Future<void>? abortTrigger, }) async {
    final response = await apiAdminDiagnosticsPostWithHttpInfo(abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Debug logs for yesterday to diagnose issues
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> apiAdminLogsDebugYesterdayGetWithHttpInfo({ Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/admin/logs/debug-yesterday';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      path,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Debug logs for yesterday to diagnose issues
  Future<void> apiAdminLogsDebugYesterdayGet({ Future<void>? abortTrigger, }) async {
    final response = await apiAdminLogsDebugYesterdayGetWithHttpInfo(abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Get system logs
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [int] limit:
  ///   Maximum number of logs to return
  ///
  /// * [String] level:
  ///   Filter logs by level (INFO, WARNING, ERROR)
  ///
  /// * [String] service:
  ///   Filter logs by service name
  Future<Response> apiAdminLogsGetWithHttpInfo({ int? limit, String? level, String? service, Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/admin/logs';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    if (limit != null) {
      queryParams.addAll(_queryParams('', 'limit', limit));
    }
    if (level != null) {
      queryParams.addAll(_queryParams('', 'level', level));
    }
    if (service != null) {
      queryParams.addAll(_queryParams('', 'service', service));
    }

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      path,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Get system logs
  ///
  /// Parameters:
  ///
  /// * [int] limit:
  ///   Maximum number of logs to return
  ///
  /// * [String] level:
  ///   Filter logs by level (INFO, WARNING, ERROR)
  ///
  /// * [String] service:
  ///   Filter logs by service name
  Future<void> apiAdminLogsGet({ int? limit, String? level, String? service, Future<void>? abortTrigger, }) async {
    final response = await apiAdminLogsGetWithHttpInfo(limit: limit, level: level, service: service, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Trigger log rollover
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> apiAdminLogsRolloverPostWithHttpInfo({ Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/admin/logs/rollover';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      path,
      'POST',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Trigger log rollover
  Future<void> apiAdminLogsRolloverPost({ Future<void>? abortTrigger, }) async {
    final response = await apiAdminLogsRolloverPostWithHttpInfo(abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Search logs with filtering
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] term:
  ///   Search term
  ///
  /// * [String] level:
  ///   Filter by log level
  ///
  /// * [String] service:
  ///   Filter by service name
  ///
  /// * [String] dateRange:
  ///   Date range preset
  ///
  /// * [String] startDate:
  ///   Custom start date (YYYY-MM-DD)
  ///
  /// * [String] endDate:
  ///   Custom end date (YYYY-MM-DD)
  Future<Response> apiAdminLogsSearchGetWithHttpInfo({ String? term, String? level, String? service, String? dateRange, String? startDate, String? endDate, Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/admin/logs/search';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    if (term != null) {
      queryParams.addAll(_queryParams('', 'term', term));
    }
    if (level != null) {
      queryParams.addAll(_queryParams('', 'level', level));
    }
    if (service != null) {
      queryParams.addAll(_queryParams('', 'service', service));
    }
    if (dateRange != null) {
      queryParams.addAll(_queryParams('', 'dateRange', dateRange));
    }
    if (startDate != null) {
      queryParams.addAll(_queryParams('', 'startDate', startDate));
    }
    if (endDate != null) {
      queryParams.addAll(_queryParams('', 'endDate', endDate));
    }

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      path,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Search logs with filtering
  ///
  /// Parameters:
  ///
  /// * [String] term:
  ///   Search term
  ///
  /// * [String] level:
  ///   Filter by log level
  ///
  /// * [String] service:
  ///   Filter by service name
  ///
  /// * [String] dateRange:
  ///   Date range preset
  ///
  /// * [String] startDate:
  ///   Custom start date (YYYY-MM-DD)
  ///
  /// * [String] endDate:
  ///   Custom end date (YYYY-MM-DD)
  Future<void> apiAdminLogsSearchGet({ String? term, String? level, String? service, String? dateRange, String? startDate, String? endDate, Future<void>? abortTrigger, }) async {
    final response = await apiAdminLogsSearchGetWithHttpInfo(term: term, level: level, service: service, dateRange: dateRange, startDate: startDate, endDate: endDate, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Get logs summary by type and service
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] date:
  ///   Date for which to get logs (YYYY-MM-DD)
  ///
  /// * [String] level:
  ///   Filter by log level
  Future<Response> apiAdminLogsSummaryGetWithHttpInfo({ String? date, String? level, Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/admin/logs/summary';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    if (date != null) {
      queryParams.addAll(_queryParams('', 'date', date));
    }
    if (level != null) {
      queryParams.addAll(_queryParams('', 'level', level));
    }

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      path,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Get logs summary by type and service
  ///
  /// Parameters:
  ///
  /// * [String] date:
  ///   Date for which to get logs (YYYY-MM-DD)
  ///
  /// * [String] level:
  ///   Filter by log level
  Future<void> apiAdminLogsSummaryGet({ String? date, String? level, Future<void>? abortTrigger, }) async {
    final response = await apiAdminLogsSummaryGetWithHttpInfo(date: date, level: level, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Retrieve the last security scan details
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> apiAdminSecurityLastScanGetWithHttpInfo({ Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/admin/security/last-scan';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      path,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Retrieve the last security scan details
  Future<void> apiAdminSecurityLastScanGet({ Future<void>? abortTrigger, }) async {
    final response = await apiAdminSecurityLastScanGetWithHttpInfo(abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Get security metrics
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> apiAdminSecurityMetricsGetWithHttpInfo({ Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/admin/security-metrics';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      path,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Get security metrics
  Future<void> apiAdminSecurityMetricsGet({ Future<void>? abortTrigger, }) async {
    final response = await apiAdminSecurityMetricsGetWithHttpInfo(abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Run security scan
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> apiAdminSecurityScanPostWithHttpInfo({ Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/admin/security-scan';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      path,
      'POST',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Run security scan
  Future<void> apiAdminSecurityScanPost({ Future<void>? abortTrigger, }) async {
    final response = await apiAdminSecurityScanPostWithHttpInfo(abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Get system health metrics
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> apiAdminSystemHealthGetWithHttpInfo({ Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/admin/system-health';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      path,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Get system health metrics
  Future<void> apiAdminSystemHealthGet({ Future<void>? abortTrigger, }) async {
    final response = await apiAdminSystemHealthGetWithHttpInfo(abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Get user statistics
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> apiAdminUserStatsGetWithHttpInfo({ Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/admin/user-stats';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      path,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Get user statistics
  Future<void> apiAdminUserStatsGet({ Future<void>? abortTrigger, }) async {
    final response = await apiAdminUserStatsGetWithHttpInfo(abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Search users with filtering
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] term:
  ///   Search term
  ///
  /// * [String] field:
  ///   Field to search (all, name, email, role)
  ///
  /// * [int] limit:
  ///   Maximum number of users to return
  ///
  /// * [int] offset:
  ///   Offset for pagination
  Future<Response> apiAdminUsersSearchGetWithHttpInfo({ String? term, String? field, int? limit, int? offset, Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/admin/users/search';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    if (term != null) {
      queryParams.addAll(_queryParams('', 'term', term));
    }
    if (field != null) {
      queryParams.addAll(_queryParams('', 'field', field));
    }
    if (limit != null) {
      queryParams.addAll(_queryParams('', 'limit', limit));
    }
    if (offset != null) {
      queryParams.addAll(_queryParams('', 'offset', offset));
    }

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      path,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Search users with filtering
  ///
  /// Parameters:
  ///
  /// * [String] term:
  ///   Search term
  ///
  /// * [String] field:
  ///   Field to search (all, name, email, role)
  ///
  /// * [int] limit:
  ///   Maximum number of users to return
  ///
  /// * [int] offset:
  ///   Offset for pagination
  Future<void> apiAdminUsersSearchGet({ String? term, String? field, int? limit, int? offset, Future<void>? abortTrigger, }) async {
    final response = await apiAdminUsersSearchGetWithHttpInfo(term: term, field: field, limit: limit, offset: offset, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }
}
