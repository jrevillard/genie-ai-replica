//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class ChatHistoryApi {
  ChatHistoryApi([ApiClient? apiClient]) : apiClient = apiClient ?? defaultApiClient;

  final ApiClient apiClient;

  /// Delete conversation
  ///
  /// Deletes a conversation and all associated messages
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] conversationId (required):
  ///   ID of the conversation to delete
  Future<Response> apiChatConversationsConversationIdDeleteWithHttpInfo(String conversationId,) async {
    // ignore: prefer_const_declarations
    final path = r'/api/chat/conversations/{conversationId}'
      .replaceAll('{conversationId}', conversationId);

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

  /// Delete conversation
  ///
  /// Deletes a conversation and all associated messages
  ///
  /// Parameters:
  ///
  /// * [String] conversationId (required):
  ///   ID of the conversation to delete
  Future<void> apiChatConversationsConversationIdDelete(String conversationId,) async {
    final response = await apiChatConversationsConversationIdDeleteWithHttpInfo(conversationId,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Get conversation's folder
  ///
  /// Finds which folder a conversation belongs to
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] conversationId (required):
  ///   ID of the conversation
  Future<Response> apiChatConversationsConversationIdFolderGetWithHttpInfo(String conversationId,) async {
    // ignore: prefer_const_declarations
    final path = r'/api/chat/conversations/{conversationId}/folder'
      .replaceAll('{conversationId}', conversationId);

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

  /// Get conversation's folder
  ///
  /// Finds which folder a conversation belongs to
  ///
  /// Parameters:
  ///
  /// * [String] conversationId (required):
  ///   ID of the conversation
  Future<void> apiChatConversationsConversationIdFolderGet(String conversationId,) async {
    final response = await apiChatConversationsConversationIdFolderGetWithHttpInfo(conversationId,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Get conversation details
  ///
  /// Retrieves a specific conversation including its messages
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] conversationId (required):
  ///   ID of the conversation to retrieve
  Future<Response> apiChatConversationsConversationIdGetWithHttpInfo(String conversationId,) async {
    // ignore: prefer_const_declarations
    final path = r'/api/chat/conversations/{conversationId}'
      .replaceAll('{conversationId}', conversationId);

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

  /// Get conversation details
  ///
  /// Retrieves a specific conversation including its messages
  ///
  /// Parameters:
  ///
  /// * [String] conversationId (required):
  ///   ID of the conversation to retrieve
  Future<void> apiChatConversationsConversationIdGet(String conversationId,) async {
    final response = await apiChatConversationsConversationIdGetWithHttpInfo(conversationId,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Get conversation messages
  ///
  /// Retrieves messages for a specific conversation with pagination
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] conversationId (required):
  ///   ID of the conversation
  ///
  /// * [int] limit:
  ///   Maximum number of messages to return
  ///
  /// * [int] offset:
  ///   Number of records to skip for pagination
  ///
  /// * [bool] newestFirst:
  ///   Sort messages with newest first
  Future<Response> apiChatConversationsConversationIdMessagesGetWithHttpInfo(String conversationId, { int? limit, int? offset, bool? newestFirst, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/chat/conversations/{conversationId}/messages'
      .replaceAll('{conversationId}', conversationId);

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
    if (newestFirst != null) {
      queryParams.addAll(_queryParams('', 'newestFirst', newestFirst));
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

  /// Get conversation messages
  ///
  /// Retrieves messages for a specific conversation with pagination
  ///
  /// Parameters:
  ///
  /// * [String] conversationId (required):
  ///   ID of the conversation
  ///
  /// * [int] limit:
  ///   Maximum number of messages to return
  ///
  /// * [int] offset:
  ///   Number of records to skip for pagination
  ///
  /// * [bool] newestFirst:
  ///   Sort messages with newest first
  Future<void> apiChatConversationsConversationIdMessagesGet(String conversationId, { int? limit, int? offset, bool? newestFirst, }) async {
    final response = await apiChatConversationsConversationIdMessagesGetWithHttpInfo(conversationId,  limit: limit, offset: offset, newestFirst: newestFirst, );
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Add message to conversation
  ///
  /// Adds a new message to a conversation
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] conversationId (required):
  ///   ID of the conversation
  ///
  /// * [ApiChatConversationsConversationIdMessagesPostRequest] apiChatConversationsConversationIdMessagesPostRequest (required):
  Future<Response> apiChatConversationsConversationIdMessagesPostWithHttpInfo(String conversationId, ApiChatConversationsConversationIdMessagesPostRequest apiChatConversationsConversationIdMessagesPostRequest,) async {
    // ignore: prefer_const_declarations
    final path = r'/api/chat/conversations/{conversationId}/messages'
      .replaceAll('{conversationId}', conversationId);

    // ignore: prefer_final_locals
    Object? postBody = apiChatConversationsConversationIdMessagesPostRequest;

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

  /// Add message to conversation
  ///
  /// Adds a new message to a conversation
  ///
  /// Parameters:
  ///
  /// * [String] conversationId (required):
  ///   ID of the conversation
  ///
  /// * [ApiChatConversationsConversationIdMessagesPostRequest] apiChatConversationsConversationIdMessagesPostRequest (required):
  Future<void> apiChatConversationsConversationIdMessagesPost(String conversationId, ApiChatConversationsConversationIdMessagesPostRequest apiChatConversationsConversationIdMessagesPostRequest,) async {
    final response = await apiChatConversationsConversationIdMessagesPostWithHttpInfo(conversationId, apiChatConversationsConversationIdMessagesPostRequest,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Mark messages as read
  ///
  /// Marks all or specific messages in a conversation as read
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] conversationId (required):
  ///   ID of the conversation
  ///
  /// * [ApiChatConversationsConversationIdMessagesReadPostRequest] apiChatConversationsConversationIdMessagesReadPostRequest:
  Future<Response> apiChatConversationsConversationIdMessagesReadPostWithHttpInfo(String conversationId, { ApiChatConversationsConversationIdMessagesReadPostRequest? apiChatConversationsConversationIdMessagesReadPostRequest, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/chat/conversations/{conversationId}/messages/read'
      .replaceAll('{conversationId}', conversationId);

    // ignore: prefer_final_locals
    Object? postBody = apiChatConversationsConversationIdMessagesReadPostRequest;

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

  /// Mark messages as read
  ///
  /// Marks all or specific messages in a conversation as read
  ///
  /// Parameters:
  ///
  /// * [String] conversationId (required):
  ///   ID of the conversation
  ///
  /// * [ApiChatConversationsConversationIdMessagesReadPostRequest] apiChatConversationsConversationIdMessagesReadPostRequest:
  Future<void> apiChatConversationsConversationIdMessagesReadPost(String conversationId, { ApiChatConversationsConversationIdMessagesReadPostRequest? apiChatConversationsConversationIdMessagesReadPostRequest, }) async {
    final response = await apiChatConversationsConversationIdMessagesReadPostWithHttpInfo(conversationId,  apiChatConversationsConversationIdMessagesReadPostRequest: apiChatConversationsConversationIdMessagesReadPostRequest, );
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Move conversation
  ///
  /// Moves a conversation from one folder to another
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] conversationId (required):
  ///   ID of the conversation to move
  ///
  /// * [ApiChatConversationsConversationIdMovePostRequest] apiChatConversationsConversationIdMovePostRequest (required):
  Future<Response> apiChatConversationsConversationIdMovePostWithHttpInfo(String conversationId, ApiChatConversationsConversationIdMovePostRequest apiChatConversationsConversationIdMovePostRequest,) async {
    // ignore: prefer_const_declarations
    final path = r'/api/chat/conversations/{conversationId}/move'
      .replaceAll('{conversationId}', conversationId);

    // ignore: prefer_final_locals
    Object? postBody = apiChatConversationsConversationIdMovePostRequest;

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

  /// Move conversation
  ///
  /// Moves a conversation from one folder to another
  ///
  /// Parameters:
  ///
  /// * [String] conversationId (required):
  ///   ID of the conversation to move
  ///
  /// * [ApiChatConversationsConversationIdMovePostRequest] apiChatConversationsConversationIdMovePostRequest (required):
  Future<void> apiChatConversationsConversationIdMovePost(String conversationId, ApiChatConversationsConversationIdMovePostRequest apiChatConversationsConversationIdMovePostRequest,) async {
    final response = await apiChatConversationsConversationIdMovePostWithHttpInfo(conversationId, apiChatConversationsConversationIdMovePostRequest,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Update conversation
  ///
  /// Updates conversation properties like title, starred status, etc.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] conversationId (required):
  ///   ID of the conversation to update
  ///
  /// * [ApiChatConversationsConversationIdPatchRequest] apiChatConversationsConversationIdPatchRequest (required):
  Future<Response> apiChatConversationsConversationIdPatchWithHttpInfo(String conversationId, ApiChatConversationsConversationIdPatchRequest apiChatConversationsConversationIdPatchRequest,) async {
    // ignore: prefer_const_declarations
    final path = r'/api/chat/conversations/{conversationId}'
      .replaceAll('{conversationId}', conversationId);

    // ignore: prefer_final_locals
    Object? postBody = apiChatConversationsConversationIdPatchRequest;

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
    );
  }

  /// Update conversation
  ///
  /// Updates conversation properties like title, starred status, etc.
  ///
  /// Parameters:
  ///
  /// * [String] conversationId (required):
  ///   ID of the conversation to update
  ///
  /// * [ApiChatConversationsConversationIdPatchRequest] apiChatConversationsConversationIdPatchRequest (required):
  Future<void> apiChatConversationsConversationIdPatch(String conversationId, ApiChatConversationsConversationIdPatchRequest apiChatConversationsConversationIdPatchRequest,) async {
    final response = await apiChatConversationsConversationIdPatchWithHttpInfo(conversationId, apiChatConversationsConversationIdPatchRequest,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Get user conversations
  ///
  /// Retrieves all conversations for the authenticated user with pagination and filtering options
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [int] limit:
  ///   Maximum number of conversations to return
  ///
  /// * [int] offset:
  ///   Number of records to skip for pagination
  ///
  /// * [bool] includeArchived:
  ///   Whether to include archived conversations
  ///
  /// * [bool] filterStarred:
  ///   Filter to show only starred conversations
  ///
  /// * [String] searchTerm:
  ///   Text to search for in conversation titles or messages
  Future<Response> apiChatConversationsGetWithHttpInfo({ int? limit, int? offset, bool? includeArchived, bool? filterStarred, String? searchTerm, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/chat/conversations';

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
    if (includeArchived != null) {
      queryParams.addAll(_queryParams('', 'includeArchived', includeArchived));
    }
    if (filterStarred != null) {
      queryParams.addAll(_queryParams('', 'filterStarred', filterStarred));
    }
    if (searchTerm != null) {
      queryParams.addAll(_queryParams('', 'searchTerm', searchTerm));
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

  /// Get user conversations
  ///
  /// Retrieves all conversations for the authenticated user with pagination and filtering options
  ///
  /// Parameters:
  ///
  /// * [int] limit:
  ///   Maximum number of conversations to return
  ///
  /// * [int] offset:
  ///   Number of records to skip for pagination
  ///
  /// * [bool] includeArchived:
  ///   Whether to include archived conversations
  ///
  /// * [bool] filterStarred:
  ///   Filter to show only starred conversations
  ///
  /// * [String] searchTerm:
  ///   Text to search for in conversation titles or messages
  Future<void> apiChatConversationsGet({ int? limit, int? offset, bool? includeArchived, bool? filterStarred, String? searchTerm, }) async {
    final response = await apiChatConversationsGetWithHttpInfo( limit: limit, offset: offset, includeArchived: includeArchived, filterStarred: filterStarred, searchTerm: searchTerm, );
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Create a new conversation
  ///
  /// Creates a new chat conversation
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [ApiChatConversationsPostRequest] apiChatConversationsPostRequest (required):
  Future<Response> apiChatConversationsPostWithHttpInfo(ApiChatConversationsPostRequest apiChatConversationsPostRequest,) async {
    // ignore: prefer_const_declarations
    final path = r'/api/chat/conversations';

    // ignore: prefer_final_locals
    Object? postBody = apiChatConversationsPostRequest;

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

  /// Create a new conversation
  ///
  /// Creates a new chat conversation
  ///
  /// Parameters:
  ///
  /// * [ApiChatConversationsPostRequest] apiChatConversationsPostRequest (required):
  Future<void> apiChatConversationsPost(ApiChatConversationsPostRequest apiChatConversationsPostRequest,) async {
    final response = await apiChatConversationsPostWithHttpInfo(apiChatConversationsPostRequest,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Remove conversation from folder
  ///
  /// Removes a conversation from a folder
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] folderId (required):
  ///   ID of the folder
  ///
  /// * [String] conversationId (required):
  ///   ID of the conversation to remove
  Future<Response> apiChatFoldersFolderIdConversationsConversationIdDeleteWithHttpInfo(String folderId, String conversationId,) async {
    // ignore: prefer_const_declarations
    final path = r'/api/chat/folders/{folderId}/conversations/{conversationId}'
      .replaceAll('{folderId}', folderId)
      .replaceAll('{conversationId}', conversationId);

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

  /// Remove conversation from folder
  ///
  /// Removes a conversation from a folder
  ///
  /// Parameters:
  ///
  /// * [String] folderId (required):
  ///   ID of the folder
  ///
  /// * [String] conversationId (required):
  ///   ID of the conversation to remove
  Future<void> apiChatFoldersFolderIdConversationsConversationIdDelete(String folderId, String conversationId,) async {
    final response = await apiChatFoldersFolderIdConversationsConversationIdDeleteWithHttpInfo(folderId, conversationId,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Add conversation to folder
  ///
  /// Adds a conversation to a folder
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] folderId (required):
  ///   ID of the folder
  ///
  /// * [String] conversationId (required):
  ///   ID of the conversation to add
  Future<Response> apiChatFoldersFolderIdConversationsConversationIdPostWithHttpInfo(String folderId, String conversationId,) async {
    // ignore: prefer_const_declarations
    final path = r'/api/chat/folders/{folderId}/conversations/{conversationId}'
      .replaceAll('{folderId}', folderId)
      .replaceAll('{conversationId}', conversationId);

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

  /// Add conversation to folder
  ///
  /// Adds a conversation to a folder
  ///
  /// Parameters:
  ///
  /// * [String] folderId (required):
  ///   ID of the folder
  ///
  /// * [String] conversationId (required):
  ///   ID of the conversation to add
  Future<void> apiChatFoldersFolderIdConversationsConversationIdPost(String folderId, String conversationId,) async {
    final response = await apiChatFoldersFolderIdConversationsConversationIdPostWithHttpInfo(folderId, conversationId,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Delete folder
  ///
  /// Deletes a folder and optionally its contents
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] folderId (required):
  ///   ID of the folder to delete
  ///
  /// * [bool] deleteContents:
  ///   Whether to delete contained conversations and subfolders
  Future<Response> apiChatFoldersFolderIdDeleteWithHttpInfo(String folderId, { bool? deleteContents, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/chat/folders/{folderId}'
      .replaceAll('{folderId}', folderId);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    if (deleteContents != null) {
      queryParams.addAll(_queryParams('', 'deleteContents', deleteContents));
    }

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

  /// Delete folder
  ///
  /// Deletes a folder and optionally its contents
  ///
  /// Parameters:
  ///
  /// * [String] folderId (required):
  ///   ID of the folder to delete
  ///
  /// * [bool] deleteContents:
  ///   Whether to delete contained conversations and subfolders
  Future<void> apiChatFoldersFolderIdDelete(String folderId, { bool? deleteContents, }) async {
    final response = await apiChatFoldersFolderIdDeleteWithHttpInfo(folderId,  deleteContents: deleteContents, );
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Get folder details
  ///
  /// Retrieves a specific folder including its conversations
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] folderId (required):
  ///   ID of the folder to retrieve
  Future<Response> apiChatFoldersFolderIdGetWithHttpInfo(String folderId,) async {
    // ignore: prefer_const_declarations
    final path = r'/api/chat/folders/{folderId}'
      .replaceAll('{folderId}', folderId);

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

  /// Get folder details
  ///
  /// Retrieves a specific folder including its conversations
  ///
  /// Parameters:
  ///
  /// * [String] folderId (required):
  ///   ID of the folder to retrieve
  Future<void> apiChatFoldersFolderIdGet(String folderId,) async {
    final response = await apiChatFoldersFolderIdGetWithHttpInfo(folderId,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Update folder
  ///
  /// Updates folder properties
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] folderId (required):
  ///   ID of the folder to update
  ///
  /// * [ApiChatFoldersFolderIdPatchRequest] apiChatFoldersFolderIdPatchRequest (required):
  Future<Response> apiChatFoldersFolderIdPatchWithHttpInfo(String folderId, ApiChatFoldersFolderIdPatchRequest apiChatFoldersFolderIdPatchRequest,) async {
    // ignore: prefer_const_declarations
    final path = r'/api/chat/folders/{folderId}'
      .replaceAll('{folderId}', folderId);

    // ignore: prefer_final_locals
    Object? postBody = apiChatFoldersFolderIdPatchRequest;

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
    );
  }

  /// Update folder
  ///
  /// Updates folder properties
  ///
  /// Parameters:
  ///
  /// * [String] folderId (required):
  ///   ID of the folder to update
  ///
  /// * [ApiChatFoldersFolderIdPatchRequest] apiChatFoldersFolderIdPatchRequest (required):
  Future<void> apiChatFoldersFolderIdPatch(String folderId, ApiChatFoldersFolderIdPatchRequest apiChatFoldersFolderIdPatchRequest,) async {
    final response = await apiChatFoldersFolderIdPatchWithHttpInfo(folderId, apiChatFoldersFolderIdPatchRequest,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Get folder path
  ///
  /// Retrieves the folder path (breadcrumbs)
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] folderId (required):
  ///   ID of the folder
  Future<Response> apiChatFoldersFolderIdPathGetWithHttpInfo(String folderId,) async {
    // ignore: prefer_const_declarations
    final path = r'/api/chat/folders/{folderId}/path'
      .replaceAll('{folderId}', folderId);

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

  /// Get folder path
  ///
  /// Retrieves the folder path (breadcrumbs)
  ///
  /// Parameters:
  ///
  /// * [String] folderId (required):
  ///   ID of the folder
  Future<void> apiChatFoldersFolderIdPathGet(String folderId,) async {
    final response = await apiChatFoldersFolderIdPathGetWithHttpInfo(folderId,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Get user folders
  ///
  /// Retrieves all folders for the authenticated user
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [bool] includeArchived:
  ///   Whether to include archived folders
  ///
  /// * [String] parentFolderId:
  ///   ID of parent folder to get subfolders (omit for root folders)
  Future<Response> apiChatFoldersGetWithHttpInfo({ bool? includeArchived, String? parentFolderId, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/chat/folders';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    if (includeArchived != null) {
      queryParams.addAll(_queryParams('', 'includeArchived', includeArchived));
    }
    if (parentFolderId != null) {
      queryParams.addAll(_queryParams('', 'parentFolderId', parentFolderId));
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

  /// Get user folders
  ///
  /// Retrieves all folders for the authenticated user
  ///
  /// Parameters:
  ///
  /// * [bool] includeArchived:
  ///   Whether to include archived folders
  ///
  /// * [String] parentFolderId:
  ///   ID of parent folder to get subfolders (omit for root folders)
  Future<void> apiChatFoldersGet({ bool? includeArchived, String? parentFolderId, }) async {
    final response = await apiChatFoldersGetWithHttpInfo( includeArchived: includeArchived, parentFolderId: parentFolderId, );
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Create a new folder
  ///
  /// Creates a new folder for organizing conversations
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [ApiChatFoldersPostRequest] apiChatFoldersPostRequest (required):
  Future<Response> apiChatFoldersPostWithHttpInfo(ApiChatFoldersPostRequest apiChatFoldersPostRequest,) async {
    // ignore: prefer_const_declarations
    final path = r'/api/chat/folders';

    // ignore: prefer_final_locals
    Object? postBody = apiChatFoldersPostRequest;

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

  /// Create a new folder
  ///
  /// Creates a new folder for organizing conversations
  ///
  /// Parameters:
  ///
  /// * [ApiChatFoldersPostRequest] apiChatFoldersPostRequest (required):
  Future<void> apiChatFoldersPost(ApiChatFoldersPostRequest apiChatFoldersPostRequest,) async {
    final response = await apiChatFoldersPostWithHttpInfo(apiChatFoldersPostRequest,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Reorder folders
  ///
  /// Updates the order of folders at the same level
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [ApiChatFoldersReorderPostRequest] apiChatFoldersReorderPostRequest (required):
  Future<Response> apiChatFoldersReorderPostWithHttpInfo(ApiChatFoldersReorderPostRequest apiChatFoldersReorderPostRequest,) async {
    // ignore: prefer_const_declarations
    final path = r'/api/chat/folders/reorder';

    // ignore: prefer_final_locals
    Object? postBody = apiChatFoldersReorderPostRequest;

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

  /// Reorder folders
  ///
  /// Updates the order of folders at the same level
  ///
  /// Parameters:
  ///
  /// * [ApiChatFoldersReorderPostRequest] apiChatFoldersReorderPostRequest (required):
  Future<void> apiChatFoldersReorderPost(ApiChatFoldersReorderPostRequest apiChatFoldersReorderPostRequest,) async {
    final response = await apiChatFoldersReorderPostWithHttpInfo(apiChatFoldersReorderPostRequest,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Search folders
  ///
  /// Searches for folders by name or description
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] q (required):
  ///   Search term
  ///
  /// * [bool] includeArchived:
  ///   Whether to include archived folders
  Future<Response> apiChatFoldersSearchGetWithHttpInfo(String q, { bool? includeArchived, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/chat/folders/search';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

      queryParams.addAll(_queryParams('', 'q', q));
    if (includeArchived != null) {
      queryParams.addAll(_queryParams('', 'includeArchived', includeArchived));
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

  /// Search folders
  ///
  /// Searches for folders by name or description
  ///
  /// Parameters:
  ///
  /// * [String] q (required):
  ///   Search term
  ///
  /// * [bool] includeArchived:
  ///   Whether to include archived folders
  Future<void> apiChatFoldersSearchGet(String q, { bool? includeArchived, }) async {
    final response = await apiChatFoldersSearchGetWithHttpInfo(q,  includeArchived: includeArchived, );
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Get originating query for a message
  ///
  /// Retrieves the query that led to a specific message
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] messageId (required):
  ///   ID of the message
  Future<Response> apiChatMessagesMessageIdQueryGetWithHttpInfo(String messageId,) async {
    // ignore: prefer_const_declarations
    final path = r'/api/chat/messages/{messageId}/query'
      .replaceAll('{messageId}', messageId);

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

  /// Get originating query for a message
  ///
  /// Retrieves the query that led to a specific message
  ///
  /// Parameters:
  ///
  /// * [String] messageId (required):
  ///   ID of the message
  Future<void> apiChatMessagesMessageIdQueryGet(String messageId,) async {
    final response = await apiChatMessagesMessageIdQueryGetWithHttpInfo(messageId,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
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
  ///   ID of the query
  ///
  /// * [ApiChatQueryQueryIdConversationPostRequest] apiChatQueryQueryIdConversationPostRequest:
  Future<Response> apiChatQueryQueryIdConversationPostWithHttpInfo(String queryId, { ApiChatQueryQueryIdConversationPostRequest? apiChatQueryQueryIdConversationPostRequest, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/chat/query/{queryId}/conversation'
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
    );
  }

  /// Create conversation from query
  ///
  /// Creates a new conversation based on an existing query
  ///
  /// Parameters:
  ///
  /// * [String] queryId (required):
  ///   ID of the query
  ///
  /// * [ApiChatQueryQueryIdConversationPostRequest] apiChatQueryQueryIdConversationPostRequest:
  Future<void> apiChatQueryQueryIdConversationPost(String queryId, { ApiChatQueryQueryIdConversationPostRequest? apiChatQueryQueryIdConversationPostRequest, }) async {
    final response = await apiChatQueryQueryIdConversationPostWithHttpInfo(queryId,  apiChatQueryQueryIdConversationPostRequest: apiChatQueryQueryIdConversationPostRequest, );
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Get messages for a query
  ///
  /// Retrieves all messages related to a specific query
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] queryId (required):
  ///   ID of the query
  Future<Response> apiChatQueryQueryIdMessagesGetWithHttpInfo(String queryId,) async {
    // ignore: prefer_const_declarations
    final path = r'/api/chat/query/{queryId}/messages'
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

  /// Get messages for a query
  ///
  /// Retrieves all messages related to a specific query
  ///
  /// Parameters:
  ///
  /// * [String] queryId (required):
  ///   ID of the query
  Future<void> apiChatQueryQueryIdMessagesGet(String queryId,) async {
    final response = await apiChatQueryQueryIdMessagesGetWithHttpInfo(queryId,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Get recent conversations
  ///
  /// Retrieves recent conversations for the user
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [int] limit:
  ///   Maximum number of conversations to return
  Future<Response> apiChatRecentGetWithHttpInfo({ int? limit, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/chat/recent';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    if (limit != null) {
      queryParams.addAll(_queryParams('', 'limit', limit));
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

  /// Get recent conversations
  ///
  /// Retrieves recent conversations for the user
  ///
  /// Parameters:
  ///
  /// * [int] limit:
  ///   Maximum number of conversations to return
  Future<void> apiChatRecentGet({ int? limit, }) async {
    final response = await apiChatRecentGetWithHttpInfo( limit: limit, );
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Search conversations
  ///
  /// Searches for conversations containing specific text
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] q (required):
  ///   Search term
  ///
  /// * [int] limit:
  ///   Maximum number of results to return
  ///
  /// * [int] offset:
  ///   Number of results to skip for pagination
  ///
  /// * [bool] includeArchived:
  ///   Whether to include archived conversations
  Future<Response> apiChatSearchGetWithHttpInfo(String q, { int? limit, int? offset, bool? includeArchived, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/chat/search';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

      queryParams.addAll(_queryParams('', 'q', q));
    if (limit != null) {
      queryParams.addAll(_queryParams('', 'limit', limit));
    }
    if (offset != null) {
      queryParams.addAll(_queryParams('', 'offset', offset));
    }
    if (includeArchived != null) {
      queryParams.addAll(_queryParams('', 'includeArchived', includeArchived));
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

  /// Search conversations
  ///
  /// Searches for conversations containing specific text
  ///
  /// Parameters:
  ///
  /// * [String] q (required):
  ///   Search term
  ///
  /// * [int] limit:
  ///   Maximum number of results to return
  ///
  /// * [int] offset:
  ///   Number of results to skip for pagination
  ///
  /// * [bool] includeArchived:
  ///   Whether to include archived conversations
  Future<void> apiChatSearchGet(String q, { int? limit, int? offset, bool? includeArchived, }) async {
    final response = await apiChatSearchGetWithHttpInfo(q,  limit: limit, offset: offset, includeArchived: includeArchived, );
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Get conversation statistics
  ///
  /// Retrieves statistics about the user's conversations
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> apiChatStatsGetWithHttpInfo() async {
    // ignore: prefer_const_declarations
    final path = r'/api/chat/stats';

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

  /// Get conversation statistics
  ///
  /// Retrieves statistics about the user's conversations
  Future<void> apiChatStatsGet() async {
    final response = await apiChatStatsGetWithHttpInfo();
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }
}
