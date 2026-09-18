//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class QueriesApi {
  QueriesApi([ApiClient? apiClient]) : apiClient = apiClient ?? defaultApiClient;

  final ApiClient apiClient;

  /// Search queries
  ///
  /// Searches queries based on various criteria with pagination
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [int] limit:
  ///   Number of queries per page
  ///
  /// * [int] offset:
  ///   Offset for pagination
  ///
  /// * [String] sessionId:
  ///   Filter by session ID
  ///
  /// * [String] text:
  ///   Filter by text content
  ///
  /// * [String] categoryId:
  ///   Filter by category ID
  ///
  /// * [String] serviceId:
  ///   Filter by service ID
  ///
  /// * [bool] isAnswered:
  ///   Filter by answered status
  ///
  /// * [DateTime] startDate:
  ///   Filter by start date
  ///
  /// * [DateTime] endDate:
  ///   Filter by end date
  Future<Response> apiQueriesGetWithHttpInfo({ int? limit, int? offset, String? sessionId, String? text, String? categoryId, String? serviceId, bool? isAnswered, DateTime? startDate, DateTime? endDate, Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/queries';

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
    if (sessionId != null) {
      queryParams.addAll(_queryParams('', 'sessionId', sessionId));
    }
    if (text != null) {
      queryParams.addAll(_queryParams('', 'text', text));
    }
    if (categoryId != null) {
      queryParams.addAll(_queryParams('', 'categoryId', categoryId));
    }
    if (serviceId != null) {
      queryParams.addAll(_queryParams('', 'serviceId', serviceId));
    }
    if (isAnswered != null) {
      queryParams.addAll(_queryParams('', 'isAnswered', isAnswered));
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

  /// Search queries
  ///
  /// Searches queries based on various criteria with pagination
  ///
  /// Parameters:
  ///
  /// * [int] limit:
  ///   Number of queries per page
  ///
  /// * [int] offset:
  ///   Offset for pagination
  ///
  /// * [String] sessionId:
  ///   Filter by session ID
  ///
  /// * [String] text:
  ///   Filter by text content
  ///
  /// * [String] categoryId:
  ///   Filter by category ID
  ///
  /// * [String] serviceId:
  ///   Filter by service ID
  ///
  /// * [bool] isAnswered:
  ///   Filter by answered status
  ///
  /// * [DateTime] startDate:
  ///   Filter by start date
  ///
  /// * [DateTime] endDate:
  ///   Filter by end date
  Future<ApiQueriesGet200Response?> apiQueriesGet({ int? limit, int? offset, String? sessionId, String? text, String? categoryId, String? serviceId, bool? isAnswered, DateTime? startDate, DateTime? endDate, Future<void>? abortTrigger, }) async {
    final response = await apiQueriesGetWithHttpInfo(limit: limit, offset: offset, sessionId: sessionId, text: text, categoryId: categoryId, serviceId: serviceId, isAnswered: isAnswered, startDate: startDate, endDate: endDate, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'ApiQueriesGet200Response',) as ApiQueriesGet200Response;
    
    }
    return null;
  }

  /// Mark query as answered
  ///
  /// Marks a query as answered and updates response time
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] queryId (required):
  ///   ID of the query to update.
  ///
  /// * [ApiQueriesQueryIdResponsetimePatchRequest] apiQueriesQueryIdResponsetimePatchRequest (required):
  Future<Response> apiQueriesQueryIdAnsweredPatchWithHttpInfo(String queryId, ApiQueriesQueryIdResponsetimePatchRequest apiQueriesQueryIdResponsetimePatchRequest, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/queries/{queryId}/answered'
      .replaceAll('{queryId}', queryId);

    // ignore: prefer_final_locals
    Object? postBody = apiQueriesQueryIdResponsetimePatchRequest;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>['application/json'];


    return apiClient.invokeAPI(
      path,
      'PATCH',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Mark query as answered
  ///
  /// Marks a query as answered and updates response time
  ///
  /// Parameters:
  ///
  /// * [String] queryId (required):
  ///   ID of the query to update.
  ///
  /// * [ApiQueriesQueryIdResponsetimePatchRequest] apiQueriesQueryIdResponsetimePatchRequest (required):
  Future<ApiQueriesQueryIdAnsweredPatch200Response?> apiQueriesQueryIdAnsweredPatch(String queryId, ApiQueriesQueryIdResponsetimePatchRequest apiQueriesQueryIdResponsetimePatchRequest, { Future<void>? abortTrigger, }) async {
    final response = await apiQueriesQueryIdAnsweredPatchWithHttpInfo(queryId, apiQueriesQueryIdResponsetimePatchRequest, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'ApiQueriesQueryIdAnsweredPatch200Response',) as ApiQueriesQueryIdAnsweredPatch200Response;
    
    }
    return null;
  }

  /// Create conversation from query
  ///
  /// Creates a new conversation based on an existing query
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] queryId (required):
  ///   Query ID
  ///
  /// * [ApiChatQueryQueryIdConversationPostRequest] apiChatQueryQueryIdConversationPostRequest:
  Future<Response> apiQueriesQueryIdConversationPostWithHttpInfo(String queryId, { ApiChatQueryQueryIdConversationPostRequest? apiChatQueryQueryIdConversationPostRequest, Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/queries/{queryId}/conversation'
      .replaceAll('{queryId}', queryId);

    // ignore: prefer_final_locals
    Object? postBody = apiChatQueryQueryIdConversationPostRequest;

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
      abortTrigger: abortTrigger,
    );
  }

  /// Create conversation from query
  ///
  /// Creates a new conversation based on an existing query
  ///
  /// Parameters:
  ///
  /// * [String] queryId (required):
  ///   Query ID
  ///
  /// * [ApiChatQueryQueryIdConversationPostRequest] apiChatQueryQueryIdConversationPostRequest:
  Future<ApiQueriesQueryIdConversationPost201Response?> apiQueriesQueryIdConversationPost(String queryId, { ApiChatQueryQueryIdConversationPostRequest? apiChatQueryQueryIdConversationPostRequest, Future<void>? abortTrigger, }) async {
    final response = await apiQueriesQueryIdConversationPostWithHttpInfo(queryId, apiChatQueryQueryIdConversationPostRequest: apiChatQueryQueryIdConversationPostRequest, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'ApiQueriesQueryIdConversationPost201Response',) as ApiQueriesQueryIdConversationPost201Response;
    
    }
    return null;
  }

  /// Get conversations for a query
  ///
  /// Retrieves all conversations associated with a specific query
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] queryId (required):
  ///   Query ID
  Future<Response> apiQueriesQueryIdConversationsGetWithHttpInfo(String queryId, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/queries/{queryId}/conversations'
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

  /// Get conversations for a query
  ///
  /// Retrieves all conversations associated with a specific query
  ///
  /// Parameters:
  ///
  /// * [String] queryId (required):
  ///   Query ID
  Future<List<Object>?> apiQueriesQueryIdConversationsGet(String queryId, { Future<void>? abortTrigger, }) async {
    final response = await apiQueriesQueryIdConversationsGetWithHttpInfo(queryId, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      final responseBody = await _decodeBodyBytes(response);
      return (await apiClient.deserializeAsync(responseBody, 'List<Object>') as List)
        .cast<Object>()
        .toList(growable: false);

    }
    return null;
  }

  /// Add feedback to a query
  ///
  /// Adds user feedback to a query and records it in analytics
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] queryId (required):
  ///   Query ID
  ///
  /// * [ApiQueriesQueryIdFeedbackPostRequest] apiQueriesQueryIdFeedbackPostRequest (required):
  Future<Response> apiQueriesQueryIdFeedbackPostWithHttpInfo(String queryId, ApiQueriesQueryIdFeedbackPostRequest apiQueriesQueryIdFeedbackPostRequest, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/queries/{queryId}/feedback'
      .replaceAll('{queryId}', queryId);

    // ignore: prefer_final_locals
    Object? postBody = apiQueriesQueryIdFeedbackPostRequest;

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
      abortTrigger: abortTrigger,
    );
  }

  /// Add feedback to a query
  ///
  /// Adds user feedback to a query and records it in analytics
  ///
  /// Parameters:
  ///
  /// * [String] queryId (required):
  ///   Query ID
  ///
  /// * [ApiQueriesQueryIdFeedbackPostRequest] apiQueriesQueryIdFeedbackPostRequest (required):
  Future<ApiQueriesQueryIdFeedbackPost200Response?> apiQueriesQueryIdFeedbackPost(String queryId, ApiQueriesQueryIdFeedbackPostRequest apiQueriesQueryIdFeedbackPostRequest, { Future<void>? abortTrigger, }) async {
    final response = await apiQueriesQueryIdFeedbackPostWithHttpInfo(queryId, apiQueriesQueryIdFeedbackPostRequest, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'ApiQueriesQueryIdFeedbackPost200Response',) as ApiQueriesQueryIdFeedbackPost200Response;
    
    }
    return null;
  }

  /// Get query by ID
  ///
  /// Retrieves a query by its unique identifier
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] queryId (required):
  ///   Query ID
  Future<Response> apiQueriesQueryIdGetWithHttpInfo(String queryId, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/queries/{queryId}'
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

  /// Get query by ID
  ///
  /// Retrieves a query by its unique identifier
  ///
  /// Parameters:
  ///
  /// * [String] queryId (required):
  ///   Query ID
  Future<QueriesPost201Response?> apiQueriesQueryIdGet(String queryId, { Future<void>? abortTrigger, }) async {
    final response = await apiQueriesQueryIdGetWithHttpInfo(queryId, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'QueriesPost201Response',) as QueriesPost201Response;
    
    }
    return null;
  }

  /// Link query to message
  ///
  /// Creates a link between a query and an existing message
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] queryId (required):
  ///   Query ID
  ///
  /// * [String] messageId (required):
  ///   Message ID
  ///
  /// * [ApiQueriesQueryIdLinkMessageIdPostRequest] apiQueriesQueryIdLinkMessageIdPostRequest:
  Future<Response> apiQueriesQueryIdLinkMessageIdPostWithHttpInfo(String queryId, String messageId, { ApiQueriesQueryIdLinkMessageIdPostRequest? apiQueriesQueryIdLinkMessageIdPostRequest, Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/queries/{queryId}/link/{messageId}'
      .replaceAll('{queryId}', queryId)
      .replaceAll('{messageId}', messageId);

    // ignore: prefer_final_locals
    Object? postBody = apiQueriesQueryIdLinkMessageIdPostRequest;

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
      abortTrigger: abortTrigger,
    );
  }

  /// Link query to message
  ///
  /// Creates a link between a query and an existing message
  ///
  /// Parameters:
  ///
  /// * [String] queryId (required):
  ///   Query ID
  ///
  /// * [String] messageId (required):
  ///   Message ID
  ///
  /// * [ApiQueriesQueryIdLinkMessageIdPostRequest] apiQueriesQueryIdLinkMessageIdPostRequest:
  Future<Object?> apiQueriesQueryIdLinkMessageIdPost(String queryId, String messageId, { ApiQueriesQueryIdLinkMessageIdPostRequest? apiQueriesQueryIdLinkMessageIdPostRequest, Future<void>? abortTrigger, }) async {
    final response = await apiQueriesQueryIdLinkMessageIdPostWithHttpInfo(queryId, messageId, apiQueriesQueryIdLinkMessageIdPostRequest: apiQueriesQueryIdLinkMessageIdPostRequest, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'Object',) as Object;
    
    }
    return null;
  }

  /// Update query response time
  ///
  /// Updates the response time of a specific query.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] queryId (required):
  ///   ID of the query to update.
  ///
  /// * [ApiQueriesQueryIdResponsetimePatchRequest] apiQueriesQueryIdResponsetimePatchRequest (required):
  Future<Response> apiQueriesQueryIdResponsetimePatchWithHttpInfo(String queryId, ApiQueriesQueryIdResponsetimePatchRequest apiQueriesQueryIdResponsetimePatchRequest, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/queries/{queryId}/responsetime'
      .replaceAll('{queryId}', queryId);

    // ignore: prefer_final_locals
    Object? postBody = apiQueriesQueryIdResponsetimePatchRequest;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>['application/json'];


    return apiClient.invokeAPI(
      path,
      'PATCH',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Update query response time
  ///
  /// Updates the response time of a specific query.
  ///
  /// Parameters:
  ///
  /// * [String] queryId (required):
  ///   ID of the query to update.
  ///
  /// * [ApiQueriesQueryIdResponsetimePatchRequest] apiQueriesQueryIdResponsetimePatchRequest (required):
  Future<ApiQueriesQueryIdResponsetimePatch200Response?> apiQueriesQueryIdResponsetimePatch(String queryId, ApiQueriesQueryIdResponsetimePatchRequest apiQueriesQueryIdResponsetimePatchRequest, { Future<void>? abortTrigger, }) async {
    final response = await apiQueriesQueryIdResponsetimePatchWithHttpInfo(queryId, apiQueriesQueryIdResponsetimePatchRequest, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'ApiQueriesQueryIdResponsetimePatch200Response',) as ApiQueriesQueryIdResponsetimePatch200Response;
    
    }
    return null;
  }

  /// Create a new query
  ///
  /// Creates a new query and records it in analytics. Supports single-message or full conversation modes.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [QueriesPostRequest] queriesPostRequest (required):
  Future<Response> queriesPostWithHttpInfo(QueriesPostRequest queriesPostRequest, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/queries';

    // ignore: prefer_final_locals
    Object? postBody = queriesPostRequest;

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
      abortTrigger: abortTrigger,
    );
  }

  /// Create a new query
  ///
  /// Creates a new query and records it in analytics. Supports single-message or full conversation modes.
  ///
  /// Parameters:
  ///
  /// * [QueriesPostRequest] queriesPostRequest (required):
  Future<QueriesPost201Response?> queriesPost(QueriesPostRequest queriesPostRequest, { Future<void>? abortTrigger, }) async {
    final response = await queriesPostWithHttpInfo(queriesPostRequest, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'QueriesPost201Response',) as QueriesPost201Response;
    
    }
    return null;
  }
}
