//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class DatabaseOperationsApi {
  DatabaseOperationsApi([ApiClient? apiClient]) : apiClient = apiClient ?? defaultApiClient;

  final ApiClient apiClient;

  /// Backup Database
  ///
  /// Creates a full backup of the database
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> apiDatabaseBackupPostWithHttpInfo() async {
    // ignore: prefer_const_declarations
    final path = r'/api/database/backup';

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

  /// Backup Database
  ///
  /// Creates a full backup of the database
  Future<ApiDatabaseBackupPost200Response?> apiDatabaseBackupPost() async {
    final response = await apiDatabaseBackupPostWithHttpInfo();
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'ApiDatabaseBackupPost200Response',) as ApiDatabaseBackupPost200Response;
    
    }
    return null;
  }

  /// Optimize Database
  ///
  /// Performs database optimization including compacting collections
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> apiDatabaseOptimizePostWithHttpInfo() async {
    // ignore: prefer_const_declarations
    final path = r'/api/database/optimize';

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

  /// Optimize Database
  ///
  /// Performs database optimization including compacting collections
  Future<ApiDatabaseOptimizePost200Response?> apiDatabaseOptimizePost() async {
    final response = await apiDatabaseOptimizePostWithHttpInfo();
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'ApiDatabaseOptimizePost200Response',) as ApiDatabaseOptimizePost200Response;
    
    }
    return null;
  }
}
