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
  Future<ApiAdminLogsDebugYesterdayGet200Response?> apiAdminLogsDebugYesterdayGet() async {
    final response = await apiAdminLogsDebugYesterdayGetWithHttpInfo();
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'ApiAdminLogsDebugYesterdayGet200Response',) as ApiAdminLogsDebugYesterdayGet200Response;
    
    }
    return null;
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
  ///   Filter logs by level. WARN/WARNING are synonyms (normalized to WARN before the VL query). The query is a single-value severity_text:<canonical> clause; ERROR matches only ERROR, FATAL only FATAL. Use /logs/summary for the sibling view.
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
  ///   Filter logs by level. WARN/WARNING are synonyms (normalized to WARN before the VL query). The query is a single-value severity_text:<canonical> clause; ERROR matches only ERROR, FATAL only FATAL. Use /logs/summary for the sibling view.
  ///
  /// * [String] service:
  ///   Filter logs by service name
  Future<ApiAdminLogsGet200Response?> apiAdminLogsGet({ int? limit, String? level, String? service, }) async {
    final response = await apiAdminLogsGetWithHttpInfo( limit: limit, level: level, service: service, );
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'ApiAdminLogsGet200Response',) as ApiAdminLogsGet200Response;
    
    }
    return null;
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
  ///   Filter by log level. WARN/WARNING are synonyms (normalized to WARN before the VL query). The query is a single-value severity_text:<canonical> clause; ERROR matches only ERROR, FATAL only FATAL. Use /logs/summary for the sibling view. The VL query uses the unquoted severity_text:<level> form. getLogsInRange is the only endpoint that uses the quoted form — these endpoints differ in shape.
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
  ///   Filter by log level. WARN/WARNING are synonyms (normalized to WARN before the VL query). The query is a single-value severity_text:<canonical> clause; ERROR matches only ERROR, FATAL only FATAL. Use /logs/summary for the sibling view. The VL query uses the unquoted severity_text:<level> form. getLogsInRange is the only endpoint that uses the quoted form — these endpoints differ in shape.
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
  Future<ApiAdminLogsGet200Response?> apiAdminLogsSearchGet({ String? term, String? level, String? service, String? dateRange, String? startDate, String? endDate, }) async {
    final response = await apiAdminLogsSearchGetWithHttpInfo( term: term, level: level, service: service, dateRange: dateRange, startDate: startDate, endDate: endDate, );
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'ApiAdminLogsGet200Response',) as ApiAdminLogsGet200Response;
    
    }
    return null;
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
  ///   Filter by log level. WARNING normalizes to WARN and is accepted; the canonical bucket keys are ERROR / WARN. WARN and WARNING are synonyms; ERROR and FATAL are siblings. The VL query OR-joins the synonyms internally. Any value outside the allowlist is rejected with 400 invalid_filter.
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
  ///   Filter by log level. WARNING normalizes to WARN and is accepted; the canonical bucket keys are ERROR / WARN. WARN and WARNING are synonyms; ERROR and FATAL are siblings. The VL query OR-joins the synonyms internally. Any value outside the allowlist is rejected with 400 invalid_filter.
  Future<ApiAdminLogsSummaryGet200Response?> apiAdminLogsSummaryGet({ String? date, String? level, }) async {
    final response = await apiAdminLogsSummaryGetWithHttpInfo( date: date, level: level, );
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'ApiAdminLogsSummaryGet200Response',) as ApiAdminLogsSummaryGet200Response;
    
    }
    return null;
  }

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
  Future<Response> apiAdminQueriesInspectGetWithHttpInfo({ int? limit, int? offset, String? userId, String? searchText, String? startDate, String? endDate, num? minConfidence, num? maxConfidence, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/admin/queries/inspect';

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
  Future<void> apiAdminQueriesInspectGet({ int? limit, int? offset, String? userId, String? searchText, String? startDate, String? endDate, num? minConfidence, num? maxConfidence, }) async {
    final response = await apiAdminQueriesInspectGetWithHttpInfo( limit: limit, offset: offset, userId: userId, searchText: searchText, startDate: startDate, endDate: endDate, minConfidence: minConfidence, maxConfidence: maxConfidence, );
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
  Future<Response> apiAdminQueriesInspectQueryIdGetWithHttpInfo(String queryId,) async {
    // ignore: prefer_const_declarations
    final path = r'/api/admin/queries/inspect/{queryId}'
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
    );
  }

  /// Get full query details for admin inspection
  ///
  /// Parameters:
  ///
  /// * [String] queryId (required):
  ///   The query ID to inspect
  Future<void> apiAdminQueriesInspectQueryIdGet(String queryId,) async {
    final response = await apiAdminQueriesInspectQueryIdGetWithHttpInfo(queryId,);
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
  Future<ApiAdminSecurityLastScanGet200Response?> apiAdminSecurityLastScanGet() async {
    final response = await apiAdminSecurityLastScanGetWithHttpInfo();
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'ApiAdminSecurityLastScanGet200Response',) as ApiAdminSecurityLastScanGet200Response;
    
    }
    return null;
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
  Future<ApiAdminSecurityMetricsGet200Response?> apiAdminSecurityMetricsGet() async {
    final response = await apiAdminSecurityMetricsGetWithHttpInfo();
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'ApiAdminSecurityMetricsGet200Response',) as ApiAdminSecurityMetricsGet200Response;
    
    }
    return null;
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
  Future<ApiAdminSecurityScanPost200Response?> apiAdminSecurityScanPost() async {
    final response = await apiAdminSecurityScanPostWithHttpInfo();
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'ApiAdminSecurityScanPost200Response',) as ApiAdminSecurityScanPost200Response;
    
    }
    return null;
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
  Future<ApiAdminSystemHealthGet200Response?> apiAdminSystemHealthGet() async {
    final response = await apiAdminSystemHealthGetWithHttpInfo();
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'ApiAdminSystemHealthGet200Response',) as ApiAdminSystemHealthGet200Response;
    
    }
    return null;
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
  ///   Field to search (all, name, email, role, exactEmail — matches the full email literally)
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
  ///   Field to search (all, name, email, role, exactEmail — matches the full email literally)
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
