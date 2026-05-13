//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class LoggerApi {
  LoggerApi([ApiClient? apiClient]) : apiClient = apiClient ?? defaultApiClient;

  final ApiClient apiClient;

  /// Reconfigure logger settings
  ///
  /// Updates the application's logging configuration with new settings.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [ApiLoggerConfigurePostRequest] apiLoggerConfigurePostRequest (required):
  Future<Response> apiLoggerConfigurePostWithHttpInfo(ApiLoggerConfigurePostRequest apiLoggerConfigurePostRequest,) async {
    // ignore: prefer_const_declarations
    final path = r'/api/logger/configure';

    // ignore: prefer_final_locals
    Object? postBody = apiLoggerConfigurePostRequest;

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

  /// Reconfigure logger settings
  ///
  /// Updates the application's logging configuration with new settings.
  ///
  /// Parameters:
  ///
  /// * [ApiLoggerConfigurePostRequest] apiLoggerConfigurePostRequest (required):
  Future<ApiLoggerConfigurePost200Response?> apiLoggerConfigurePost(ApiLoggerConfigurePostRequest apiLoggerConfigurePostRequest,) async {
    final response = await apiLoggerConfigurePostWithHttpInfo(apiLoggerConfigurePostRequest,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'ApiLoggerConfigurePost200Response',) as ApiLoggerConfigurePost200Response;
    
    }
    return null;
  }

  /// Trigger log rollover
  ///
  /// Forces an immediate log rotation regardless of current file sizes
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> apiLoggerRolloverPostWithHttpInfo() async {
    // ignore: prefer_const_declarations
    final path = r'/api/logger/rollover';

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
  ///
  /// Forces an immediate log rotation regardless of current file sizes
  Future<ApiLoggerRolloverPost200Response?> apiLoggerRolloverPost() async {
    final response = await apiLoggerRolloverPostWithHttpInfo();
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'ApiLoggerRolloverPost200Response',) as ApiLoggerRolloverPost200Response;
    
    }
    return null;
  }
}
