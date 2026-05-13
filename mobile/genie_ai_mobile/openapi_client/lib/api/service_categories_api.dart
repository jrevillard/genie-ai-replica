//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class ServiceCategoriesApi {
  ServiceCategoriesApi([ApiClient? apiClient]) : apiClient = apiClient ?? defaultApiClient;

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
  ///   Category key
  ///
  /// * [String] locale:
  ///   Language locale for category and service names
  Future<Response> apiServiceCategoriesCategoriesCategoryIdGetWithHttpInfo(String categoryId, { String? locale, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/service-categories/categories/{categoryId}'
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
  ///   Category key
  ///
  /// * [String] locale:
  ///   Language locale for category and service names
  Future<ApiServiceCategoriesCategoriesGet200ResponseInner?> apiServiceCategoriesCategoriesCategoryIdGet(String categoryId, { String? locale, }) async {
    final response = await apiServiceCategoriesCategoriesCategoryIdGetWithHttpInfo(categoryId,  locale: locale, );
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'ApiServiceCategoriesCategoriesGet200ResponseInner',) as ApiServiceCategoriesCategoriesGet200ResponseInner;
    
    }
    return null;
  }

  /// Get all categories with detailed services for admin
  ///
  /// Retrieves all categories with their associated services as objects (including keys)
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] locale:
  ///   Language locale for category and service names
  Future<Response> apiServiceCategoriesCategoriesDetailedGetWithHttpInfo({ String? locale, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/service-categories/categories/detailed';

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

  /// Get all categories with detailed services for admin
  ///
  /// Retrieves all categories with their associated services as objects (including keys)
  ///
  /// Parameters:
  ///
  /// * [String] locale:
  ///   Language locale for category and service names
  Future<void> apiServiceCategoriesCategoriesDetailedGet({ String? locale, }) async {
    final response = await apiServiceCategoriesCategoriesDetailedGetWithHttpInfo( locale: locale, );
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
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
  Future<Response> apiServiceCategoriesCategoriesGetWithHttpInfo({ String? locale, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/service-categories/categories';

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
  Future<List<ApiServiceCategoriesCategoriesGet200ResponseInner>?> apiServiceCategoriesCategoriesGet({ String? locale, }) async {
    final response = await apiServiceCategoriesCategoriesGetWithHttpInfo( locale: locale, );
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      final responseBody = await _decodeBodyBytes(response);
      return (await apiClient.deserializeAsync(responseBody, 'List<ApiServiceCategoriesCategoriesGet200ResponseInner>') as List)
        .cast<ApiServiceCategoriesCategoriesGet200ResponseInner>()
        .toList(growable: false);

    }
    return null;
  }

  /// Delete a category
  ///
  /// Deletes a service category and its associated services
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] categoryId (required):
  ///   Category key
  Future<Response> apiServiceCategoriesCategoryIdDeleteWithHttpInfo(String categoryId,) async {
    // ignore: prefer_const_declarations
    final path = r'/api/service-categories/{categoryId}'
      .replaceAll('{categoryId}', categoryId);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      path,
      'DELETE',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
    );
  }

  /// Delete a category
  ///
  /// Deletes a service category and its associated services
  ///
  /// Parameters:
  ///
  /// * [String] categoryId (required):
  ///   Category key
  Future<void> apiServiceCategoriesCategoryIdDelete(String categoryId,) async {
    final response = await apiServiceCategoriesCategoryIdDeleteWithHttpInfo(categoryId,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Update an existing category
  ///
  /// Updates a category's name and translations
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] categoryId (required):
  ///   The key of the category to update
  ///
  /// * [ApiServiceCategoriesPostRequest] apiServiceCategoriesPostRequest (required):
  Future<Response> apiServiceCategoriesCategoryIdPutWithHttpInfo(String categoryId, ApiServiceCategoriesPostRequest apiServiceCategoriesPostRequest,) async {
    // ignore: prefer_const_declarations
    final path = r'/api/service-categories/{categoryId}'
      .replaceAll('{categoryId}', categoryId);

    // ignore: prefer_final_locals
    Object? postBody = apiServiceCategoriesPostRequest;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>['application/json'];


    return apiClient.invokeAPI(
      path,
      'PUT',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
    );
  }

  /// Update an existing category
  ///
  /// Updates a category's name and translations
  ///
  /// Parameters:
  ///
  /// * [String] categoryId (required):
  ///   The key of the category to update
  ///
  /// * [ApiServiceCategoriesPostRequest] apiServiceCategoriesPostRequest (required):
  Future<void> apiServiceCategoriesCategoryIdPut(String categoryId, ApiServiceCategoriesPostRequest apiServiceCategoriesPostRequest,) async {
    final response = await apiServiceCategoriesCategoryIdPutWithHttpInfo(categoryId, apiServiceCategoriesPostRequest,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Create a new service for a category
  ///
  /// Creates a new service with translations under a specific category
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] categoryId (required):
  ///   The key of the parent category
  ///
  /// * [ApiServiceCategoriesPostRequest] apiServiceCategoriesPostRequest (required):
  Future<Response> apiServiceCategoriesCategoryIdServicesPostWithHttpInfo(String categoryId, ApiServiceCategoriesPostRequest apiServiceCategoriesPostRequest,) async {
    // ignore: prefer_const_declarations
    final path = r'/api/service-categories/{categoryId}/services'
      .replaceAll('{categoryId}', categoryId);

    // ignore: prefer_final_locals
    Object? postBody = apiServiceCategoriesPostRequest;

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

  /// Create a new service for a category
  ///
  /// Creates a new service with translations under a specific category
  ///
  /// Parameters:
  ///
  /// * [String] categoryId (required):
  ///   The key of the parent category
  ///
  /// * [ApiServiceCategoriesPostRequest] apiServiceCategoriesPostRequest (required):
  Future<void> apiServiceCategoriesCategoryIdServicesPost(String categoryId, ApiServiceCategoriesPostRequest apiServiceCategoriesPostRequest,) async {
    final response = await apiServiceCategoriesCategoryIdServicesPostWithHttpInfo(categoryId, apiServiceCategoriesPostRequest,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Get all translations for a category
  ///
  /// Retrieves all available translations for a specific service category
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] categoryId (required):
  ///   The key of the category
  Future<Response> apiServiceCategoriesCategoryIdTranslationsGetWithHttpInfo(String categoryId,) async {
    // ignore: prefer_const_declarations
    final path = r'/api/service-categories/{categoryId}/translations'
      .replaceAll('{categoryId}', categoryId);

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

  /// Get all translations for a category
  ///
  /// Retrieves all available translations for a specific service category
  ///
  /// Parameters:
  ///
  /// * [String] categoryId (required):
  ///   The key of the category
  Future<List<ApiServiceCategoriesCategoryIdTranslationsGet200ResponseInner>?> apiServiceCategoriesCategoryIdTranslationsGet(String categoryId,) async {
    final response = await apiServiceCategoriesCategoryIdTranslationsGetWithHttpInfo(categoryId,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      final responseBody = await _decodeBodyBytes(response);
      return (await apiClient.deserializeAsync(responseBody, 'List<ApiServiceCategoriesCategoryIdTranslationsGet200ResponseInner>') as List)
        .cast<ApiServiceCategoriesCategoryIdTranslationsGet200ResponseInner>()
        .toList(growable: false);

    }
    return null;
  }

  /// Initialize default categories
  ///
  /// Initializes the system with default categories and services
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> apiServiceCategoriesInitPostWithHttpInfo() async {
    // ignore: prefer_const_declarations
    final path = r'/api/service-categories/init';

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

  /// Initialize default categories
  ///
  /// Initializes the system with default categories and services
  Future<ApiServiceCategoriesInitPost200Response?> apiServiceCategoriesInitPost() async {
    final response = await apiServiceCategoriesInitPostWithHttpInfo();
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'ApiServiceCategoriesInitPost200Response',) as ApiServiceCategoriesInitPost200Response;
    
    }
    return null;
  }

  /// Create a new category
  ///
  /// Creates a new service category with translations
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [ApiServiceCategoriesPostRequest] apiServiceCategoriesPostRequest (required):
  Future<Response> apiServiceCategoriesPostWithHttpInfo(ApiServiceCategoriesPostRequest apiServiceCategoriesPostRequest,) async {
    // ignore: prefer_const_declarations
    final path = r'/api/service-categories';

    // ignore: prefer_final_locals
    Object? postBody = apiServiceCategoriesPostRequest;

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

  /// Create a new category
  ///
  /// Creates a new service category with translations
  ///
  /// Parameters:
  ///
  /// * [ApiServiceCategoriesPostRequest] apiServiceCategoriesPostRequest (required):
  Future<void> apiServiceCategoriesPost(ApiServiceCategoriesPostRequest apiServiceCategoriesPostRequest,) async {
    final response = await apiServiceCategoriesPostWithHttpInfo(apiServiceCategoriesPostRequest,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
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
  Future<Response> apiServiceCategoriesSearchGetWithHttpInfo(String query, { String? locale, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/service-categories/search';

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
  Future<ApiServiceCategoriesSearchGet200Response?> apiServiceCategoriesSearchGet(String query, { String? locale, }) async {
    final response = await apiServiceCategoriesSearchGetWithHttpInfo(query,  locale: locale, );
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'ApiServiceCategoriesSearchGet200Response',) as ApiServiceCategoriesSearchGet200Response;
    
    }
    return null;
  }

  /// Delete a service
  ///
  /// Deletes a service and its associated translations
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] serviceId (required):
  ///   The key of the service to delete
  Future<Response> apiServiceCategoriesServicesServiceIdDeleteWithHttpInfo(String serviceId,) async {
    // ignore: prefer_const_declarations
    final path = r'/api/service-categories/services/{serviceId}'
      .replaceAll('{serviceId}', serviceId);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      path,
      'DELETE',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
    );
  }

  /// Delete a service
  ///
  /// Deletes a service and its associated translations
  ///
  /// Parameters:
  ///
  /// * [String] serviceId (required):
  ///   The key of the service to delete
  Future<void> apiServiceCategoriesServicesServiceIdDelete(String serviceId,) async {
    final response = await apiServiceCategoriesServicesServiceIdDeleteWithHttpInfo(serviceId,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Update an existing service
  ///
  /// Updates a service's name and its associated translations
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] serviceId (required):
  ///   The key of the service to update
  ///
  /// * [ApiServiceCategoriesPostRequest] apiServiceCategoriesPostRequest (required):
  Future<Response> apiServiceCategoriesServicesServiceIdPutWithHttpInfo(String serviceId, ApiServiceCategoriesPostRequest apiServiceCategoriesPostRequest,) async {
    // ignore: prefer_const_declarations
    final path = r'/api/service-categories/services/{serviceId}'
      .replaceAll('{serviceId}', serviceId);

    // ignore: prefer_final_locals
    Object? postBody = apiServiceCategoriesPostRequest;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>['application/json'];


    return apiClient.invokeAPI(
      path,
      'PUT',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
    );
  }

  /// Update an existing service
  ///
  /// Updates a service's name and its associated translations
  ///
  /// Parameters:
  ///
  /// * [String] serviceId (required):
  ///   The key of the service to update
  ///
  /// * [ApiServiceCategoriesPostRequest] apiServiceCategoriesPostRequest (required):
  Future<void> apiServiceCategoriesServicesServiceIdPut(String serviceId, ApiServiceCategoriesPostRequest apiServiceCategoriesPostRequest,) async {
    final response = await apiServiceCategoriesServicesServiceIdPutWithHttpInfo(serviceId, apiServiceCategoriesPostRequest,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Get all translations for a service
  ///
  /// Retrieves all available translations for a specific service
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] serviceId (required):
  ///   The key of the service
  Future<Response> apiServiceCategoriesServicesServiceIdTranslationsGetWithHttpInfo(String serviceId,) async {
    // ignore: prefer_const_declarations
    final path = r'/api/service-categories/services/{serviceId}/translations'
      .replaceAll('{serviceId}', serviceId);

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

  /// Get all translations for a service
  ///
  /// Retrieves all available translations for a specific service
  ///
  /// Parameters:
  ///
  /// * [String] serviceId (required):
  ///   The key of the service
  Future<void> apiServiceCategoriesServicesServiceIdTranslationsGet(String serviceId,) async {
    final response = await apiServiceCategoriesServicesServiceIdTranslationsGetWithHttpInfo(serviceId,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }
}
