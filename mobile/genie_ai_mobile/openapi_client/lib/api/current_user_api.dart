//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class CurrentUserApi {
  CurrentUserApi([ApiClient? apiClient]) : apiClient = apiClient ?? defaultApiClient;

  final ApiClient apiClient;

  /// Get user context for AI enrichment
  ///
  /// Returns a sanitized subset of user data for OPEA AI context enrichment. User is resolved from the JWT.
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> apiMeContextGetWithHttpInfo() async {
    // ignore: prefer_const_declarations
    final path = r'/api/me/context';

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

  /// Get user context for AI enrichment
  ///
  /// Returns a sanitized subset of user data for OPEA AI context enrichment. User is resolved from the JWT.
  Future<void> apiMeContextGet() async {
    final response = await apiMeContextGetWithHttpInfo();
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Delete user account (GDPR right to erasure)
  ///
  /// Deletes the user from Keycloak and erases all PII from ArangoDB (soft-delete with nullification). This action is irreversible.
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> apiMeDeletePostWithHttpInfo() async {
    // ignore: prefer_const_declarations
    final path = r'/api/me/delete';

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

  /// Delete user account (GDPR right to erasure)
  ///
  /// Deletes the user from Keycloak and erases all PII from ArangoDB (soft-delete with nullification). This action is irreversible.
  Future<void> apiMeDeletePost() async {
    final response = await apiMeDeletePostWithHttpInfo();
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Get current user profile
  ///
  /// Returns the full profile of the authenticated user. User is resolved from the JWT — no ID parameter needed.
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> apiMeGetWithHttpInfo() async {
    // ignore: prefer_const_declarations
    final path = r'/api/me';

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

  /// Get current user profile
  ///
  /// Returns the full profile of the authenticated user. User is resolved from the JWT — no ID parameter needed.
  Future<void> apiMeGet() async {
    final response = await apiMeGetWithHttpInfo();
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Update current user profile
  ///
  /// Self-service profile update. JIT fields (email, name) forwarded to Keycloak Account API, custom fields saved to ArangoDB.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] data:
  ///   JSON string containing user profile data
  ///
  /// * [List<MultipartFile>] files:
  ///   Files to upload (optional)
  Future<Response> apiMePutWithHttpInfo({ String? data, List<MultipartFile>? files, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/me';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>['multipart/form-data', 'application/json'];

    bool hasFields = false;
    final mp = MultipartRequest('PUT', Uri.parse(path));
    if (data != null) {
      hasFields = true;
      mp.fields[r'data'] = parameterToString(data);
    }
    if (files != null) {
      hasFields = true;
      mp.files.addAll(files);
    }
    if (hasFields) {
      postBody = mp;
    }

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

  /// Update current user profile
  ///
  /// Self-service profile update. JIT fields (email, name) forwarded to Keycloak Account API, custom fields saved to ArangoDB.
  ///
  /// Parameters:
  ///
  /// * [String] data:
  ///   JSON string containing user profile data
  ///
  /// * [List<MultipartFile>] files:
  ///   Files to upload (optional)
  Future<void> apiMePut({ String? data, List<MultipartFile>? files, }) async {
    final response = await apiMePutWithHttpInfo( data: data, files: files, );
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Reset user profile data
  ///
  /// Resets the authenticated user's profile data while preserving essential account information (credentials, email, creation date). JIT-provisioned fields (name, roles) are restored on next login.
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> apiMeResetDataPostWithHttpInfo() async {
    // ignore: prefer_const_declarations
    final path = r'/api/me/reset-data';

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

  /// Reset user profile data
  ///
  /// Resets the authenticated user's profile data while preserving essential account information (credentials, email, creation date). JIT-provisioned fields (name, roles) are restored on next login.
  Future<void> apiMeResetDataPost() async {
    final response = await apiMeResetDataPostWithHttpInfo();
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }
}
