//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class ServicesApi {
  ServicesApi([ApiClient? apiClient]) : apiClient = apiClient ?? defaultApiClient;

  final ApiClient apiClient;

  /// Get category with services
  ///
  /// Retrieves a specific service category with its associated services
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] categoryId (required):
  ///   Category ID
  ///
  /// * [String] locale:
  ///   Language locale for category and service names
  Future<Response> apiServicesCategoriesCategoryIdGetWithHttpInfo(String categoryId, { String? locale, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/services/categories/{categoryId}'
      .replaceAll('{categoryId}', categoryId);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

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

  /// Get category with services
  ///
  /// Retrieves a specific service category with its associated services
  ///
  /// Parameters:
  ///
  /// * [String] categoryId (required):
  ///   Category ID
  ///
  /// * [String] locale:
  ///   Language locale for category and service names
  Future<ApiServicesCategoriesGet200ResponseInner?> apiServicesCategoriesCategoryIdGet(String categoryId, { String? locale, }) async {
    final response = await apiServicesCategoriesCategoryIdGetWithHttpInfo(categoryId,  locale: locale, );
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'ApiServicesCategoriesGet200ResponseInner',) as ApiServicesCategoriesGet200ResponseInner;
    
    }
    return null;
  }

  /// Get all categories with services
  ///
  /// Retrieves all service categories with their associated services
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] locale:
  ///   Language locale for category and service names
  Future<Response> apiServicesCategoriesGetWithHttpInfo({ String? locale, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/services/categories';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

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

  /// Get all categories with services
  ///
  /// Retrieves all service categories with their associated services
  ///
  /// Parameters:
  ///
  /// * [String] locale:
  ///   Language locale for category and service names
  Future<List<ApiServicesCategoriesGet200ResponseInner>?> apiServicesCategoriesGet({ String? locale, }) async {
    final response = await apiServicesCategoriesGetWithHttpInfo( locale: locale, );
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      final responseBody = await _decodeBodyBytes(response);
      return (await apiClient.deserializeAsync(responseBody, 'List<ApiServicesCategoriesGet200ResponseInner>') as List)
        .cast<ApiServicesCategoriesGet200ResponseInner>()
        .toList(growable: false);

    }
    return null;
  }

  /// Search categories and services
  ///
  /// Searches for categories and services based on a query string
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] query (required):
  ///   Search query
  ///
  /// * [String] locale:
  ///   Language locale for search results
  Future<Response> apiServicesSearchGetWithHttpInfo(String query, { String? locale, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/services/search';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

      queryParams.addAll(_queryParams('', 'query', query));
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

  /// Search categories and services
  ///
  /// Searches for categories and services based on a query string
  ///
  /// Parameters:
  ///
  /// * [String] query (required):
  ///   Search query
  ///
  /// * [String] locale:
  ///   Language locale for search results
  Future<ApiServicesSearchGet200Response?> apiServicesSearchGet(String query, { String? locale, }) async {
    final response = await apiServicesSearchGetWithHttpInfo(query,  locale: locale, );
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'ApiServicesSearchGet200Response',) as ApiServicesSearchGet200Response;
    
    }
    return null;
  }
}
