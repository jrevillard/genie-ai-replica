//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class TranslationApi {
  TranslationApi([ApiClient? apiClient]) : apiClient = apiClient ?? defaultApiClient;

  final ApiClient apiClient;

  /// Translate markdown content
  ///
  /// Translates the text content within a markdown string from a specified source language to a specified target language, preserving the markdown structure.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [ApiTranslateMarkdownPostRequest] apiTranslateMarkdownPostRequest (required):
  Future<Response> apiTranslateMarkdownPostWithHttpInfo(ApiTranslateMarkdownPostRequest apiTranslateMarkdownPostRequest,) async {
    // ignore: prefer_const_declarations
    final path = r'/api/translate/markdown';

    // ignore: prefer_final_locals
    Object? postBody = apiTranslateMarkdownPostRequest;

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

  /// Translate markdown content
  ///
  /// Translates the text content within a markdown string from a specified source language to a specified target language, preserving the markdown structure.
  ///
  /// Parameters:
  ///
  /// * [ApiTranslateMarkdownPostRequest] apiTranslateMarkdownPostRequest (required):
  Future<ApiTranslateMarkdownPost200Response?> apiTranslateMarkdownPost(ApiTranslateMarkdownPostRequest apiTranslateMarkdownPostRequest,) async {
    final response = await apiTranslateMarkdownPostWithHttpInfo(apiTranslateMarkdownPostRequest,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'ApiTranslateMarkdownPost200Response',) as ApiTranslateMarkdownPost200Response;
    
    }
    return null;
  }

  /// Translate text content
  ///
  /// Translates an array of text strings from a specified source language to a specified target language.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [ApiTranslatePostRequest] apiTranslatePostRequest (required):
  Future<Response> apiTranslatePostWithHttpInfo(ApiTranslatePostRequest apiTranslatePostRequest,) async {
    // ignore: prefer_const_declarations
    final path = r'/api/translate';

    // ignore: prefer_final_locals
    Object? postBody = apiTranslatePostRequest;

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

  /// Translate text content
  ///
  /// Translates an array of text strings from a specified source language to a specified target language.
  ///
  /// Parameters:
  ///
  /// * [ApiTranslatePostRequest] apiTranslatePostRequest (required):
  Future<ApiTranslatePost200Response?> apiTranslatePost(ApiTranslatePostRequest apiTranslatePostRequest,) async {
    final response = await apiTranslatePostWithHttpInfo(apiTranslatePostRequest,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'ApiTranslatePost200Response',) as ApiTranslatePost200Response;
    
    }
    return null;
  }
}
