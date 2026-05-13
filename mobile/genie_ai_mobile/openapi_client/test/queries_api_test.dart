//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

import 'package:openapi/api.dart';
import 'package:test/test.dart';


/// tests for QueriesApi
void main() {
  // final instance = QueriesApi();

  group('tests for QueriesApi', () {
    // Search queries
    //
    // Searches queries based on various criteria with pagination
    //
    //Future<ApiQueriesGet200Response> apiQueriesGet({ int limit, int offset, String sessionId, String text, String categoryId, String serviceId, bool isAnswered, DateTime startDate, DateTime endDate }) async
    test('test apiQueriesGet', () async {
      // TODO
    });

    // Create a new query
    //
    // Creates a new query and records it in analytics. Supports single-message or full conversation modes.
    //
    //Future<ApiQueriesGet200ResponseQueriesInner> apiQueriesPost(ApiQueriesPostRequest apiQueriesPostRequest) async
    test('test apiQueriesPost', () async {
      // TODO
    });

    // Mark query as answered
    //
    // Marks a query as answered and updates response time
    //
    //Future<ApiQueriesQueryIdAnsweredPatch200Response> apiQueriesQueryIdAnsweredPatch(String queryId, ApiQueriesQueryIdResponsetimePatchRequest apiQueriesQueryIdResponsetimePatchRequest) async
    test('test apiQueriesQueryIdAnsweredPatch', () async {
      // TODO
    });

    // Create conversation from query
    //
    // Creates a new conversation based on an existing query
    //
    //Future<ApiQueriesQueryIdConversationPost201Response> apiQueriesQueryIdConversationPost(String queryId, { ApiChatQueryQueryIdConversationPostRequest apiChatQueryQueryIdConversationPostRequest }) async
    test('test apiQueriesQueryIdConversationPost', () async {
      // TODO
    });

    // Get conversations for a query
    //
    // Retrieves all conversations associated with a specific query
    //
    //Future<List<Object>> apiQueriesQueryIdConversationsGet(String queryId) async
    test('test apiQueriesQueryIdConversationsGet', () async {
      // TODO
    });

    // Add feedback to a query
    //
    // Adds user feedback to a query and records it in analytics
    //
    //Future<ApiQueriesQueryIdFeedbackPost200Response> apiQueriesQueryIdFeedbackPost(String queryId, ApiQueriesQueryIdFeedbackPostRequest apiQueriesQueryIdFeedbackPostRequest) async
    test('test apiQueriesQueryIdFeedbackPost', () async {
      // TODO
    });

    // Get query by ID
    //
    // Retrieves a query by its unique identifier
    //
    //Future<ApiQueriesGet200ResponseQueriesInner> apiQueriesQueryIdGet(String queryId) async
    test('test apiQueriesQueryIdGet', () async {
      // TODO
    });

    // Link query to message
    //
    // Creates a link between a query and an existing message
    //
    //Future<Object> apiQueriesQueryIdLinkMessageIdPost(String queryId, String messageId, { ApiQueriesQueryIdLinkMessageIdPostRequest apiQueriesQueryIdLinkMessageIdPostRequest }) async
    test('test apiQueriesQueryIdLinkMessageIdPost', () async {
      // TODO
    });

    // Update query response time
    //
    // Updates the response time of a specific query.
    //
    //Future<ApiQueriesQueryIdResponsetimePatch200Response> apiQueriesQueryIdResponsetimePatch(String queryId, ApiQueriesQueryIdResponsetimePatchRequest apiQueriesQueryIdResponsetimePatchRequest) async
    test('test apiQueriesQueryIdResponsetimePatch', () async {
      // TODO
    });

  });
}
