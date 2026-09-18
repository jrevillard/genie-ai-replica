//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AnalyticsApi {
  AnalyticsApi([ApiClient? apiClient]) : apiClient = apiClient ?? defaultApiClient;

  final ApiClient apiClient;

  /// Get dashboard analytics
  ///
  /// Retrieves analytics data for the dashboard within a date range
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [DateTime] startDate:
  ///   Start date (YYYY-MM-DD)
  ///
  /// * [DateTime] endDate:
  ///   End date (ISO format)
  ///
  /// * [String] locale:
  ///   Language locale for category names (e.g. en, fr, sw, ar, id, es, etc.)
  Future<Response> apiAnalyticsDashboardGetWithHttpInfo({ DateTime? startDate, DateTime? endDate, String? locale, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/analytics/dashboard';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    if (startDate != null) {
      queryParams.addAll(_queryParams('', 'startDate', startDate));
    }
    if (endDate != null) {
      queryParams.addAll(_queryParams('', 'endDate', endDate));
    }
    if (locale != null) {
      queryParams.addAll(_queryParams('', 'locale', locale));
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

  /// Get dashboard analytics
  ///
  /// Retrieves analytics data for the dashboard within a date range
  ///
  /// Parameters:
  ///
  /// * [DateTime] startDate:
  ///   Start date (YYYY-MM-DD)
  ///
  /// * [DateTime] endDate:
  ///   End date (ISO format)
  ///
  /// * [String] locale:
  ///   Language locale for category names (e.g. en, fr, sw, ar, id, es, etc.)
  Future<ApiAnalyticsDashboardGet200Response?> apiAnalyticsDashboardGet({ DateTime? startDate, DateTime? endDate, String? locale, }) async {
    final response = await apiAnalyticsDashboardGetWithHttpInfo( startDate: startDate, endDate: endDate, locale: locale, );
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'ApiAnalyticsDashboardGet200Response',) as ApiAnalyticsDashboardGet200Response;
    
    }
    return null;
  }

  /// Get events records
  ///
  /// Retrieves event records with pagination
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [int] limit:
  ///   Maximum number of results to return
  ///
  /// * [int] offset:
  ///   Number of results to skip for pagination
  Future<Response> apiAnalyticsEventsGetWithHttpInfo({ int? limit, int? offset, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/analytics/events';

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

  /// Get events records
  ///
  /// Retrieves event records with pagination
  ///
  /// Parameters:
  ///
  /// * [int] limit:
  ///   Maximum number of results to return
  ///
  /// * [int] offset:
  ///   Number of results to skip for pagination
  Future<List<Event>?> apiAnalyticsEventsGet({ int? limit, int? offset, }) async {
    final response = await apiAnalyticsEventsGetWithHttpInfo( limit: limit, offset: offset, );
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      final responseBody = await _decodeBodyBytes(response);
      return (await apiClient.deserializeAsync(responseBody, 'List<Event>') as List)
        .cast<Event>()
        .toList(growable: false);

    }
    return null;
  }

  /// Track an event
  ///
  /// Records a user event for analytics
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [ApiAnalyticsEventsPostRequest] apiAnalyticsEventsPostRequest (required):
  Future<Response> apiAnalyticsEventsPostWithHttpInfo(ApiAnalyticsEventsPostRequest apiAnalyticsEventsPostRequest,) async {
    // ignore: prefer_const_declarations
    final path = r'/api/analytics/events';

    // ignore: prefer_final_locals
    Object? postBody = apiAnalyticsEventsPostRequest;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>['application/json'];


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

  /// Track an event
  ///
  /// Records a user event for analytics
  ///
  /// Parameters:
  ///
  /// * [ApiAnalyticsEventsPostRequest] apiAnalyticsEventsPostRequest (required):
  Future<Event?> apiAnalyticsEventsPost(ApiAnalyticsEventsPostRequest apiAnalyticsEventsPostRequest,) async {
    final response = await apiAnalyticsEventsPostWithHttpInfo(apiAnalyticsEventsPostRequest,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'Event',) as Event;
    
    }
    return null;
  }

  /// Get general analytics
  ///
  /// Retrieves general analytics data with optional filters and date range
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [DateTime] startDate:
  ///   Start date (ISO format)
  ///
  /// * [DateTime] endDate:
  ///   End date (ISO format)
  ///
  /// * [String] filters:
  ///   JSON string of filter criteria
  ///
  /// * [String] locale:
  ///   Language locale for category names (e.g. en, fr, sw, ar, id, es, etc.)
  Future<Response> apiAnalyticsGetWithHttpInfo({ DateTime? startDate, DateTime? endDate, String? filters, String? locale, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/analytics';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    if (startDate != null) {
      queryParams.addAll(_queryParams('', 'startDate', startDate));
    }
    if (endDate != null) {
      queryParams.addAll(_queryParams('', 'endDate', endDate));
    }
    if (filters != null) {
      queryParams.addAll(_queryParams('', 'filters', filters));
    }
    if (locale != null) {
      queryParams.addAll(_queryParams('', 'locale', locale));
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

  /// Get general analytics
  ///
  /// Retrieves general analytics data with optional filters and date range
  ///
  /// Parameters:
  ///
  /// * [DateTime] startDate:
  ///   Start date (ISO format)
  ///
  /// * [DateTime] endDate:
  ///   End date (ISO format)
  ///
  /// * [String] filters:
  ///   JSON string of filter criteria
  ///
  /// * [String] locale:
  ///   Language locale for category names (e.g. en, fr, sw, ar, id, es, etc.)
  Future<ApiAnalyticsGet200Response?> apiAnalyticsGet({ DateTime? startDate, DateTime? endDate, String? filters, String? locale, }) async {
    final response = await apiAnalyticsGetWithHttpInfo( startDate: startDate, endDate: endDate, filters: filters, locale: locale, );
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'ApiAnalyticsGet200Response',) as ApiAnalyticsGet200Response;
    
    }
    return null;
  }

  /// Get specific metric data
  ///
  /// Retrieves data for a specific analytics metric
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] metric (required):
  ///   Metric name
  ///
  /// * [DateTime] startDate (required):
  ///   Start date (ISO format)
  ///
  /// * [DateTime] endDate (required):
  ///   End date (ISO format)
  Future<Response> apiAnalyticsMetricMetricGetWithHttpInfo(String metric, DateTime startDate, DateTime endDate,) async {
    // ignore: prefer_const_declarations
    final path = r'/api/analytics/metric/{metric}'
      .replaceAll('{metric}', metric);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

      queryParams.addAll(_queryParams('', 'startDate', startDate));
      queryParams.addAll(_queryParams('', 'endDate', endDate));

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

  /// Get specific metric data
  ///
  /// Retrieves data for a specific analytics metric
  ///
  /// Parameters:
  ///
  /// * [String] metric (required):
  ///   Metric name
  ///
  /// * [DateTime] startDate (required):
  ///   Start date (ISO format)
  ///
  /// * [DateTime] endDate (required):
  ///   End date (ISO format)
  Future<ApiAnalyticsMetricMetricGet200Response?> apiAnalyticsMetricMetricGet(String metric, DateTime startDate, DateTime endDate,) async {
    final response = await apiAnalyticsMetricMetricGetWithHttpInfo(metric, startDate, endDate,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'ApiAnalyticsMetricMetricGet200Response',) as ApiAnalyticsMetricMetricGet200Response;
    
    }
    return null;
  }

  /// Get analytics records
  ///
  /// Retrieves analytics records with pagination
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [int] limit:
  ///   Maximum number of results to return
  ///
  /// * [int] offset:
  ///   Number of results to skip for pagination
  Future<Response> apiAnalyticsRecordsGetWithHttpInfo({ int? limit, int? offset, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/analytics/records';

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

  /// Get analytics records
  ///
  /// Retrieves analytics records with pagination
  ///
  /// Parameters:
  ///
  /// * [int] limit:
  ///   Maximum number of results to return
  ///
  /// * [int] offset:
  ///   Number of results to skip for pagination
  Future<List<Analytics>?> apiAnalyticsRecordsGet({ int? limit, int? offset, }) async {
    final response = await apiAnalyticsRecordsGetWithHttpInfo( limit: limit, offset: offset, );
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      final responseBody = await _decodeBodyBytes(response);
      return (await apiClient.deserializeAsync(responseBody, 'List<Analytics>') as List)
        .cast<Analytics>()
        .toList(growable: false);

    }
    return null;
  }

  /// Get satisfaction gauge data
  ///
  /// Retrieves satisfaction percentage data for the gauge visualization
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [DateTime] startDate:
  ///   Start date (ISO format)
  ///
  /// * [DateTime] endDate:
  ///   End date (ISO format)
  ///
  /// * [String] locale:
  ///   Language locale (e.g. en, fr, sw, ar, id, es, etc.)
  Future<Response> apiAnalyticsSatisfactionGaugeGetWithHttpInfo({ DateTime? startDate, DateTime? endDate, String? locale, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/analytics/satisfaction/gauge';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    if (startDate != null) {
      queryParams.addAll(_queryParams('', 'startDate', startDate));
    }
    if (endDate != null) {
      queryParams.addAll(_queryParams('', 'endDate', endDate));
    }
    if (locale != null) {
      queryParams.addAll(_queryParams('', 'locale', locale));
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

  /// Get satisfaction gauge data
  ///
  /// Retrieves satisfaction percentage data for the gauge visualization
  ///
  /// Parameters:
  ///
  /// * [DateTime] startDate:
  ///   Start date (ISO format)
  ///
  /// * [DateTime] endDate:
  ///   End date (ISO format)
  ///
  /// * [String] locale:
  ///   Language locale (e.g. en, fr, sw, ar, id, es, etc.)
  Future<ApiAnalyticsSatisfactionGaugeGet200Response?> apiAnalyticsSatisfactionGaugeGet({ DateTime? startDate, DateTime? endDate, String? locale, }) async {
    final response = await apiAnalyticsSatisfactionGaugeGetWithHttpInfo( startDate: startDate, endDate: endDate, locale: locale, );
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'ApiAnalyticsSatisfactionGaugeGet200Response',) as ApiAnalyticsSatisfactionGaugeGet200Response;
    
    }
    return null;
  }

  /// Get satisfaction heatmap data
  ///
  /// Retrieves satisfaction percentage data by knowledge area over time
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [DateTime] startDate:
  ///   Start date (ISO format)
  ///
  /// * [DateTime] endDate:
  ///   End date (ISO format)
  ///
  /// * [String] locale:
  ///   Language locale (e.g. en, fr, sw, ar, id, es, etc.)
  Future<Response> apiAnalyticsSatisfactionHeatmapGetWithHttpInfo({ DateTime? startDate, DateTime? endDate, String? locale, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/analytics/satisfaction/heatmap';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    if (startDate != null) {
      queryParams.addAll(_queryParams('', 'startDate', startDate));
    }
    if (endDate != null) {
      queryParams.addAll(_queryParams('', 'endDate', endDate));
    }
    if (locale != null) {
      queryParams.addAll(_queryParams('', 'locale', locale));
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

  /// Get satisfaction heatmap data
  ///
  /// Retrieves satisfaction percentage data by knowledge area over time
  ///
  /// Parameters:
  ///
  /// * [DateTime] startDate:
  ///   Start date (ISO format)
  ///
  /// * [DateTime] endDate:
  ///   End date (ISO format)
  ///
  /// * [String] locale:
  ///   Language locale (e.g. en, fr, sw, ar, id, es, etc.)
  Future<List<ApiAnalyticsSatisfactionHeatmapGet200ResponseInner>?> apiAnalyticsSatisfactionHeatmapGet({ DateTime? startDate, DateTime? endDate, String? locale, }) async {
    final response = await apiAnalyticsSatisfactionHeatmapGetWithHttpInfo( startDate: startDate, endDate: endDate, locale: locale, );
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      final responseBody = await _decodeBodyBytes(response);
      return (await apiClient.deserializeAsync(responseBody, 'List<ApiAnalyticsSatisfactionHeatmapGet200ResponseInner>') as List)
        .cast<ApiAnalyticsSatisfactionHeatmapGet200ResponseInner>()
        .toList(growable: false);

    }
    return null;
  }

  /// Get time series data
  ///
  /// Retrieves time series data for a specific metric, interval, and date range
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] metricType (required):
  ///   Metric type name (e.g., queries, users)
  ///
  /// * [String] interval:
  ///   Time interval for grouping
  ///
  /// * [DateTime] startDate:
  ///   Start date (ISO format)
  ///
  /// * [DateTime] endDate:
  ///   End date (ISO format)
  Future<Response> apiAnalyticsTimeseriesMetricTypeGetWithHttpInfo(String metricType, { String? interval, DateTime? startDate, DateTime? endDate, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/analytics/timeseries/{metricType}'
      .replaceAll('{metricType}', metricType);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    if (interval != null) {
      queryParams.addAll(_queryParams('', 'interval', interval));
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

  /// Get time series data
  ///
  /// Retrieves time series data for a specific metric, interval, and date range
  ///
  /// Parameters:
  ///
  /// * [String] metricType (required):
  ///   Metric type name (e.g., queries, users)
  ///
  /// * [String] interval:
  ///   Time interval for grouping
  ///
  /// * [DateTime] startDate:
  ///   Start date (ISO format)
  ///
  /// * [DateTime] endDate:
  ///   End date (ISO format)
  Future<List<ApiAnalyticsTimeseriesMetricTypeGet200ResponseInner>?> apiAnalyticsTimeseriesMetricTypeGet(String metricType, { String? interval, DateTime? startDate, DateTime? endDate, }) async {
    final response = await apiAnalyticsTimeseriesMetricTypeGetWithHttpInfo(metricType,  interval: interval, startDate: startDate, endDate: endDate, );
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      final responseBody = await _decodeBodyBytes(response);
      return (await apiClient.deserializeAsync(responseBody, 'List<ApiAnalyticsTimeseriesMetricTypeGet200ResponseInner>') as List)
        .cast<ApiAnalyticsTimeseriesMetricTypeGet200ResponseInner>()
        .toList(growable: false);

    }
    return null;
  }
}
