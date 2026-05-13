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

  /// Backup database
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> apiAdminDatabaseOperationsBackupPostWithHttpInfo() async {
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
    );
  }

  /// Backup database
  Future<void> apiAdminDatabaseOperationsBackupPost() async {
    final response = await apiAdminDatabaseOperationsBackupPostWithHttpInfo();
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Optimize database
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> apiAdminDatabaseOperationsOptimizePostWithHttpInfo() async {
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
    );
  }

  /// Optimize database
  Future<void> apiAdminDatabaseOperationsOptimizePost() async {
    final response = await apiAdminDatabaseOperationsOptimizePostWithHttpInfo();
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Get database statistics
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> apiAdminDatabaseStatsGetWithHttpInfo() async {
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
    );
  }

  /// Get database statistics
  Future<void> apiAdminDatabaseStatsGet() async {
    final response = await apiAdminDatabaseStatsGetWithHttpInfo();
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Run system diagnostics
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> apiAdminDiagnosticsPostWithHttpInfo() async {
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
    );
  }

  /// Run system diagnostics
  Future<void> apiAdminDiagnosticsPost() async {
    final response = await apiAdminDiagnosticsPostWithHttpInfo();
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Debug logs for yesterday to diagnose issues
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> apiAdminLogsDebugYesterdayGetWithHttpInfo() async {
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
    );
  }

  /// Debug logs for yesterday to diagnose issues
  Future<void> apiAdminLogsDebugYesterdayGet() async {
    final response = await apiAdminLogsDebugYesterdayGetWithHttpInfo();
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
  Future<Response> apiAdminLogsGetWithHttpInfo({ int? limit, String? level, String? service, }) async {
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
  Future<void> apiAdminLogsGet({ int? limit, String? level, String? service, }) async {
    final response = await apiAdminLogsGetWithHttpInfo( limit: limit, level: level, service: service, );
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Trigger log rollover
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> apiAdminLogsRolloverPostWithHttpInfo() async {
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
    );
  }

  /// Trigger log rollover
  Future<void> apiAdminLogsRolloverPost() async {
    final response = await apiAdminLogsRolloverPostWithHttpInfo();
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
  Future<Response> apiAdminLogsSearchGetWithHttpInfo({ String? term, String? level, String? service, String? dateRange, String? startDate, String? endDate, }) async {
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
  Future<void> apiAdminLogsSearchGet({ String? term, String? level, String? service, String? dateRange, String? startDate, String? endDate, }) async {
    final response = await apiAdminLogsSearchGetWithHttpInfo( term: term, level: level, service: service, dateRange: dateRange, startDate: startDate, endDate: endDate, );
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
  Future<Response> apiAdminLogsSummaryGetWithHttpInfo({ String? date, String? level, }) async {
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
  Future<void> apiAdminLogsSummaryGet({ String? date, String? level, }) async {
    final response = await apiAdminLogsSummaryGetWithHttpInfo( date: date, level: level, );
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Retrieve the last security scan details
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> apiAdminSecurityLastScanGetWithHttpInfo() async {
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
    );
  }

  /// Retrieve the last security scan details
  Future<void> apiAdminSecurityLastScanGet() async {
    final response = await apiAdminSecurityLastScanGetWithHttpInfo();
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Get security metrics
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> apiAdminSecurityMetricsGetWithHttpInfo() async {
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
    );
  }

  /// Get security metrics
  Future<void> apiAdminSecurityMetricsGet() async {
    final response = await apiAdminSecurityMetricsGetWithHttpInfo();
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Run security scan
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> apiAdminSecurityScanPostWithHttpInfo() async {
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
    );
  }

  /// Run security scan
  Future<void> apiAdminSecurityScanPost() async {
    final response = await apiAdminSecurityScanPostWithHttpInfo();
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Get system health metrics
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> apiAdminSystemHealthGetWithHttpInfo() async {
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
    );
  }

  /// Get system health metrics
  Future<void> apiAdminSystemHealthGet() async {
    final response = await apiAdminSystemHealthGetWithHttpInfo();
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Get user statistics
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> apiAdminUserStatsGetWithHttpInfo() async {
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
    );
  }

  /// Get user statistics
  Future<void> apiAdminUserStatsGet() async {
    final response = await apiAdminUserStatsGetWithHttpInfo();
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
  Future<Response> apiAdminUsersSearchGetWithHttpInfo({ String? term, String? field, int? limit, int? offset, }) async {
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
  Future<void> apiAdminUsersSearchGet({ String? term, String? field, int? limit, int? offset, }) async {
    final response = await apiAdminUsersSearchGetWithHttpInfo( term: term, field: field, limit: limit, offset: offset, );
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }
}
