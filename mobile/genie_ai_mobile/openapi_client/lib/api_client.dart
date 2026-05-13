//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiClient {
  ApiClient({this.basePath = 'https://localhost', this.authentication,});

  final String basePath;
  final Authentication? authentication;

  var _client = Client();
  final _defaultHeaderMap = <String, String>{};

  /// Returns the current HTTP [Client] instance to use in this class.
  ///
  /// The return value is guaranteed to never be null.
  Client get client => _client;

  /// Requests to use a new HTTP [Client] in this class.
  set client(Client newClient) {
    _client = newClient;
  }

  Map<String, String> get defaultHeaderMap => _defaultHeaderMap;

  void addDefaultHeader(String key, String value) {
     _defaultHeaderMap[key] = value;
  }

  // We don't use a Map<String, String> for queryParams.
  // If collectionFormat is 'multi', a key might appear multiple times.
  Future<Response> invokeAPI(
    String path,
    String method,
    List<QueryParam> queryParams,
    Object? body,
    Map<String, String> headerParams,
    Map<String, String> formParams,
    String? contentType,
  ) async {
    await authentication?.applyToParams(queryParams, headerParams);

    headerParams.addAll(_defaultHeaderMap);
    if (contentType != null) {
      headerParams['Content-Type'] = contentType;
    }

    final urlEncodedQueryParams = queryParams.map((param) => '$param');
    final queryString = urlEncodedQueryParams.isNotEmpty ? '?${urlEncodedQueryParams.join('&')}' : '';
    final uri = Uri.parse('$basePath$path$queryString');

    try {
      // Special case for uploading a single file which isn't a 'multipart/form-data'.
      if (
        body is MultipartFile && (contentType == null ||
        !contentType.toLowerCase().startsWith('multipart/form-data'))
      ) {
        final request = StreamedRequest(method, uri);
        request.headers.addAll(headerParams);
        request.contentLength = body.length;
        body.finalize().listen(
          request.sink.add,
          onDone: request.sink.close,
          // ignore: avoid_types_on_closure_parameters
          onError: (Object error, StackTrace trace) => request.sink.close(),
          cancelOnError: true,
        );
        final response = await _client.send(request);
        return Response.fromStream(response);
      }

      if (body is MultipartRequest) {
        final request = MultipartRequest(method, uri);
        request.fields.addAll(body.fields);
        request.files.addAll(body.files);
        request.headers.addAll(body.headers);
        request.headers.addAll(headerParams);
        final response = await _client.send(request);
        return Response.fromStream(response);
      }

      final msgBody = contentType == 'application/x-www-form-urlencoded'
        ? formParams
        : await serializeAsync(body);
      final nullableHeaderParams = headerParams.isEmpty ? null : headerParams;

      switch(method) {
        case 'POST': return await _client.post(uri, headers: nullableHeaderParams, body: msgBody,);
        case 'PUT': return await _client.put(uri, headers: nullableHeaderParams, body: msgBody,);
        case 'DELETE': return await _client.delete(uri, headers: nullableHeaderParams, body: msgBody,);
        case 'PATCH': return await _client.patch(uri, headers: nullableHeaderParams, body: msgBody,);
        case 'HEAD': return await _client.head(uri, headers: nullableHeaderParams,);
        case 'GET': return await _client.get(uri, headers: nullableHeaderParams,);
      }
    } on SocketException catch (error, trace) {
      throw ApiException.withInner(
        HttpStatus.badRequest,
        'Socket operation failed: $method $path',
        error,
        trace,
      );
    } on TlsException catch (error, trace) {
      throw ApiException.withInner(
        HttpStatus.badRequest,
        'TLS/SSL communication failed: $method $path',
        error,
        trace,
      );
    } on IOException catch (error, trace) {
      throw ApiException.withInner(
        HttpStatus.badRequest,
        'I/O operation failed: $method $path',
        error,
        trace,
      );
    } on ClientException catch (error, trace) {
      throw ApiException.withInner(
        HttpStatus.badRequest,
        'HTTP connection failed: $method $path',
        error,
        trace,
      );
    } on Exception catch (error, trace) {
      throw ApiException.withInner(
        HttpStatus.badRequest,
        'Exception occurred: $method $path',
        error,
        trace,
      );
    }

    throw ApiException(
      HttpStatus.badRequest,
      'Invalid HTTP operation: $method $path',
    );
  }

  Future<dynamic> deserializeAsync(String value, String targetType, {bool growable = false,}) async =>
    // ignore: deprecated_member_use_from_same_package
    deserialize(value, targetType, growable: growable);

  @Deprecated('Scheduled for removal in OpenAPI Generator 6.x. Use deserializeAsync() instead.')
  dynamic deserialize(String value, String targetType, {bool growable = false,}) {
    // Remove all spaces. Necessary for regular expressions as well.
    targetType = targetType.replaceAll(' ', ''); // ignore: parameter_assignments

    // If the expected target type is String, nothing to do...
    return targetType == 'String'
      ? value
      : fromJson(json.decode(value), targetType, growable: growable);
  }

  // ignore: deprecated_member_use_from_same_package
  Future<String> serializeAsync(Object? value) async => serialize(value);

  @Deprecated('Scheduled for removal in OpenAPI Generator 6.x. Use serializeAsync() instead.')
  String serialize(Object? value) => value == null ? '' : json.encode(value);

  /// Returns a native instance of an OpenAPI class matching the [specified type][targetType].
  static dynamic fromJson(dynamic value, String targetType, {bool growable = false,}) {
    try {
      switch (targetType) {
        case 'String':
          return value is String ? value : value.toString();
        case 'int':
          return value is int ? value : int.parse('$value');
        case 'double':
          return value is double ? value : double.parse('$value');
        case 'bool':
          if (value is bool) {
            return value;
          }
          final valueString = '$value'.toLowerCase();
          return valueString == 'true' || valueString == '1';
        case 'DateTime':
          return value is DateTime ? value : DateTime.tryParse(value);
        case 'Analytics':
          return Analytics.fromJson(value);
        case 'ApiAnalyticsDashboardGet200Response':
          return ApiAnalyticsDashboardGet200Response.fromJson(value);
        case 'ApiAnalyticsDashboardGet200ResponseCategoriesInner':
          return ApiAnalyticsDashboardGet200ResponseCategoriesInner.fromJson(value);
        case 'ApiAnalyticsDashboardGet200ResponseFeedback':
          return ApiAnalyticsDashboardGet200ResponseFeedback.fromJson(value);
        case 'ApiAnalyticsDashboardGet200ResponseQueries':
          return ApiAnalyticsDashboardGet200ResponseQueries.fromJson(value);
        case 'ApiAnalyticsDashboardGet200ResponseTopQueriesInner':
          return ApiAnalyticsDashboardGet200ResponseTopQueriesInner.fromJson(value);
        case 'ApiAnalyticsDashboardGet200ResponseUsers':
          return ApiAnalyticsDashboardGet200ResponseUsers.fromJson(value);
        case 'ApiAnalyticsEventsPostRequest':
          return ApiAnalyticsEventsPostRequest.fromJson(value);
        case 'ApiAnalyticsGet200Response':
          return ApiAnalyticsGet200Response.fromJson(value);
        case 'ApiAnalyticsMetricMetricGet200Response':
          return ApiAnalyticsMetricMetricGet200Response.fromJson(value);
        case 'ApiAnalyticsSatisfactionGaugeGet200Response':
          return ApiAnalyticsSatisfactionGaugeGet200Response.fromJson(value);
        case 'ApiAnalyticsSatisfactionGaugeGet200ResponseHistoricalDataInner':
          return ApiAnalyticsSatisfactionGaugeGet200ResponseHistoricalDataInner.fromJson(value);
        case 'ApiAnalyticsSatisfactionHeatmapGet200ResponseInner':
          return ApiAnalyticsSatisfactionHeatmapGet200ResponseInner.fromJson(value);
        case 'ApiAnalyticsSatisfactionHeatmapGet200ResponseInnerDataInner':
          return ApiAnalyticsSatisfactionHeatmapGet200ResponseInnerDataInner.fromJson(value);
        case 'ApiAnalyticsTimeseriesMetricTypeGet200ResponseInner':
          return ApiAnalyticsTimeseriesMetricTypeGet200ResponseInner.fromJson(value);
        case 'ApiChatConversationsConversationIdMessagesPostRequest':
          return ApiChatConversationsConversationIdMessagesPostRequest.fromJson(value);
        case 'ApiChatConversationsConversationIdMessagesReadPostRequest':
          return ApiChatConversationsConversationIdMessagesReadPostRequest.fromJson(value);
        case 'ApiChatConversationsConversationIdMovePostRequest':
          return ApiChatConversationsConversationIdMovePostRequest.fromJson(value);
        case 'ApiChatConversationsConversationIdPatchRequest':
          return ApiChatConversationsConversationIdPatchRequest.fromJson(value);
        case 'ApiChatConversationsPostRequest':
          return ApiChatConversationsPostRequest.fromJson(value);
        case 'ApiChatFoldersFolderIdPatchRequest':
          return ApiChatFoldersFolderIdPatchRequest.fromJson(value);
        case 'ApiChatFoldersPostRequest':
          return ApiChatFoldersPostRequest.fromJson(value);
        case 'ApiChatFoldersReorderPostRequest':
          return ApiChatFoldersReorderPostRequest.fromJson(value);
        case 'ApiChatFoldersReorderPostRequestFolderOrdersInner':
          return ApiChatFoldersReorderPostRequestFolderOrdersInner.fromJson(value);
        case 'ApiChatQueryQueryIdConversationPostRequest':
          return ApiChatQueryQueryIdConversationPostRequest.fromJson(value);
        case 'ApiDatabaseBackupPost200Response':
          return ApiDatabaseBackupPost200Response.fromJson(value);
        case 'ApiDatabaseOptimizePost200Response':
          return ApiDatabaseOptimizePost200Response.fromJson(value);
        case 'ApiDatabaseOptimizePost200ResponseResultsInner':
          return ApiDatabaseOptimizePost200ResponseResultsInner.fromJson(value);
        case 'ApiLoggerConfigurePost200Response':
          return ApiLoggerConfigurePost200Response.fromJson(value);
        case 'ApiLoggerConfigurePost400Response':
          return ApiLoggerConfigurePost400Response.fromJson(value);
        case 'ApiLoggerConfigurePost500Response':
          return ApiLoggerConfigurePost500Response.fromJson(value);
        case 'ApiLoggerConfigurePostRequest':
          return ApiLoggerConfigurePostRequest.fromJson(value);
        case 'ApiLoggerRolloverPost200Response':
          return ApiLoggerRolloverPost200Response.fromJson(value);
        case 'ApiLoggerRolloverPost500Response':
          return ApiLoggerRolloverPost500Response.fromJson(value);
        case 'ApiQueriesGet200Response':
          return ApiQueriesGet200Response.fromJson(value);
        case 'ApiQueriesGet200ResponsePagination':
          return ApiQueriesGet200ResponsePagination.fromJson(value);
        case 'ApiQueriesGet200ResponseQueriesInner':
          return ApiQueriesGet200ResponseQueriesInner.fromJson(value);
        case 'ApiQueriesPostRequest':
          return ApiQueriesPostRequest.fromJson(value);
        case 'ApiQueriesPostRequestContext':
          return ApiQueriesPostRequestContext.fromJson(value);
        case 'ApiQueriesPostRequestMessagesInner':
          return ApiQueriesPostRequestMessagesInner.fromJson(value);
        case 'ApiQueriesQueryIdAnsweredPatch200Response':
          return ApiQueriesQueryIdAnsweredPatch200Response.fromJson(value);
        case 'ApiQueriesQueryIdConversationPost201Response':
          return ApiQueriesQueryIdConversationPost201Response.fromJson(value);
        case 'ApiQueriesQueryIdFeedbackPost200Response':
          return ApiQueriesQueryIdFeedbackPost200Response.fromJson(value);
        case 'ApiQueriesQueryIdFeedbackPost200ResponseFeedback':
          return ApiQueriesQueryIdFeedbackPost200ResponseFeedback.fromJson(value);
        case 'ApiQueriesQueryIdFeedbackPostRequest':
          return ApiQueriesQueryIdFeedbackPostRequest.fromJson(value);
        case 'ApiQueriesQueryIdLinkMessageIdPostRequest':
          return ApiQueriesQueryIdLinkMessageIdPostRequest.fromJson(value);
        case 'ApiQueriesQueryIdResponsetimePatch200Response':
          return ApiQueriesQueryIdResponsetimePatch200Response.fromJson(value);
        case 'ApiQueriesQueryIdResponsetimePatchRequest':
          return ApiQueriesQueryIdResponsetimePatchRequest.fromJson(value);
        case 'ApiServiceCategoriesCategoriesGet200ResponseInner':
          return ApiServiceCategoriesCategoriesGet200ResponseInner.fromJson(value);
        case 'ApiServiceCategoriesCategoryIdTranslationsGet200ResponseInner':
          return ApiServiceCategoriesCategoryIdTranslationsGet200ResponseInner.fromJson(value);
        case 'ApiServiceCategoriesInitPost200Response':
          return ApiServiceCategoriesInitPost200Response.fromJson(value);
        case 'ApiServiceCategoriesPostRequest':
          return ApiServiceCategoriesPostRequest.fromJson(value);
        case 'ApiServiceCategoriesSearchGet200Response':
          return ApiServiceCategoriesSearchGet200Response.fromJson(value);
        case 'ApiServiceCategoriesSearchGet200ResponseCategoriesInner':
          return ApiServiceCategoriesSearchGet200ResponseCategoriesInner.fromJson(value);
        case 'ApiServiceCategoriesSearchGet200ResponseServicesInner':
          return ApiServiceCategoriesSearchGet200ResponseServicesInner.fromJson(value);
        case 'ApiServicesCategoriesGet200ResponseInner':
          return ApiServicesCategoriesGet200ResponseInner.fromJson(value);
        case 'ApiServicesCategoriesGet200ResponseInnerServicesInner':
          return ApiServicesCategoriesGet200ResponseInnerServicesInner.fromJson(value);
        case 'ApiServicesSearchGet200Response':
          return ApiServicesSearchGet200Response.fromJson(value);
        case 'ApiServicesSearchGet200ResponseCategoriesInner':
          return ApiServicesSearchGet200ResponseCategoriesInner.fromJson(value);
        case 'ApiServicesSearchGet200ResponseServicesInner':
          return ApiServicesSearchGet200ResponseServicesInner.fromJson(value);
        case 'ApiTranslateMarkdownPost200Response':
          return ApiTranslateMarkdownPost200Response.fromJson(value);
        case 'ApiTranslateMarkdownPostRequest':
          return ApiTranslateMarkdownPostRequest.fromJson(value);
        case 'ApiTranslatePost200Response':
          return ApiTranslatePost200Response.fromJson(value);
        case 'ApiTranslatePostRequest':
          return ApiTranslatePostRequest.fromJson(value);
        case 'ApiWeatherPost200Response':
          return ApiWeatherPost200Response.fromJson(value);
        case 'ApiWeatherPost200ResponseCurrent':
          return ApiWeatherPost200ResponseCurrent.fromJson(value);
        case 'ApiWeatherPost200ResponseForecastInner':
          return ApiWeatherPost200ResponseForecastInner.fromJson(value);
        case 'ApiWeatherPostRequest':
          return ApiWeatherPostRequest.fromJson(value);
        case 'Event':
          return Event.fromJson(value);
        case 'User':
          return User.fromJson(value);
        default:
          dynamic match;
          if (value is List && (match = _regList.firstMatch(targetType)?.group(1)) != null) {
            return value
              .map<dynamic>((dynamic v) => fromJson(v, match, growable: growable,))
              .toList(growable: growable);
          }
          if (value is Set && (match = _regSet.firstMatch(targetType)?.group(1)) != null) {
            return value
              .map<dynamic>((dynamic v) => fromJson(v, match, growable: growable,))
              .toSet();
          }
          if (value is Map && (match = _regMap.firstMatch(targetType)?.group(1)) != null) {
            return Map<String, dynamic>.fromIterables(
              value.keys.cast<String>(),
              value.values.map<dynamic>((dynamic v) => fromJson(v, match, growable: growable,)),
            );
          }
      }
    } on Exception catch (error, trace) {
      throw ApiException.withInner(HttpStatus.internalServerError, 'Exception during deserialization.', error, trace,);
    }
    throw ApiException(HttpStatus.internalServerError, 'Could not find a suitable class for deserialization',);
  }
}

/// Primarily intended for use in an isolate.
class DeserializationMessage {
  const DeserializationMessage({
    required this.json,
    required this.targetType,
    this.growable = false,
  });

  /// The JSON value to deserialize.
  final String json;

  /// Target type to deserialize to.
  final String targetType;

  /// Whether to make deserialized lists or maps growable.
  final bool growable;
}

/// Primarily intended for use in an isolate.
Future<dynamic> decodeAsync(DeserializationMessage message) async {
  // Remove all spaces. Necessary for regular expressions as well.
  final targetType = message.targetType.replaceAll(' ', '');

  // If the expected target type is String, nothing to do...
  return targetType == 'String'
    ? message.json
    : json.decode(message.json);
}

/// Primarily intended for use in an isolate.
Future<dynamic> deserializeAsync(DeserializationMessage message) async {
  // Remove all spaces. Necessary for regular expressions as well.
  final targetType = message.targetType.replaceAll(' ', '');

  // If the expected target type is String, nothing to do...
  return targetType == 'String'
    ? message.json
    : ApiClient.fromJson(
        json.decode(message.json),
        targetType,
        growable: message.growable,
      );
}

/// Primarily intended for use in an isolate.
Future<String> serializeAsync(Object? value) async => value == null ? '' : json.encode(value);
