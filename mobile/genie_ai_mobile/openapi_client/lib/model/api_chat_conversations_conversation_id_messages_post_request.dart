//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiChatConversationsConversationIdMessagesPostRequest {
  /// Returns a new [ApiChatConversationsConversationIdMessagesPostRequest] instance.
  ApiChatConversationsConversationIdMessagesPostRequest({
    required this.content,
    required this.sender,
    this.queryId,
    this.metadata,
  });

  /// Message content
  String content;

  /// Sender of the message
  ApiChatConversationsConversationIdMessagesPostRequestSenderEnum sender;

  /// Optional ID of a related query (for assistant messages)
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? queryId;

  /// Additional metadata for the message
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Object? metadata;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiChatConversationsConversationIdMessagesPostRequest &&
    other.content == content &&
    other.sender == sender &&
    other.queryId == queryId &&
    other.metadata == metadata;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (content.hashCode) +
    (sender.hashCode) +
    (queryId == null ? 0 : queryId!.hashCode) +
    (metadata == null ? 0 : metadata!.hashCode);

  @override
  String toString() => 'ApiChatConversationsConversationIdMessagesPostRequest[content=$content, sender=$sender, queryId=$queryId, metadata=$metadata]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'content'] = this.content;
      json[r'sender'] = this.sender;
    if (this.queryId != null) {
      json[r'queryId'] = this.queryId;
    } else {
      json[r'queryId'] = null;
    }
    if (this.metadata != null) {
      json[r'metadata'] = this.metadata;
    } else {
      json[r'metadata'] = null;
    }
    return json;
  }

  /// Returns a new [ApiChatConversationsConversationIdMessagesPostRequest] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiChatConversationsConversationIdMessagesPostRequest? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        assert(json.containsKey(r'content'), 'Required key "ApiChatConversationsConversationIdMessagesPostRequest[content]" is missing from JSON.');
        assert(json[r'content'] != null, 'Required key "ApiChatConversationsConversationIdMessagesPostRequest[content]" has a null value in JSON.');
        assert(json.containsKey(r'sender'), 'Required key "ApiChatConversationsConversationIdMessagesPostRequest[sender]" is missing from JSON.');
        assert(json[r'sender'] != null, 'Required key "ApiChatConversationsConversationIdMessagesPostRequest[sender]" has a null value in JSON.');
        return true;
      }());

      return ApiChatConversationsConversationIdMessagesPostRequest(
        content: mapValueOfType<String>(json, r'content')!,
        sender: ApiChatConversationsConversationIdMessagesPostRequestSenderEnum.fromJson(json[r'sender'])!,
        queryId: mapValueOfType<String>(json, r'queryId'),
        metadata: mapValueOfType<Object>(json, r'metadata'),
      );
    }
    return null;
  }

  static List<ApiChatConversationsConversationIdMessagesPostRequest> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiChatConversationsConversationIdMessagesPostRequest>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiChatConversationsConversationIdMessagesPostRequest.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiChatConversationsConversationIdMessagesPostRequest> mapFromJson(dynamic json) {
    final map = <String, ApiChatConversationsConversationIdMessagesPostRequest>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiChatConversationsConversationIdMessagesPostRequest.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiChatConversationsConversationIdMessagesPostRequest-objects as value to a dart map
  static Map<String, List<ApiChatConversationsConversationIdMessagesPostRequest>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiChatConversationsConversationIdMessagesPostRequest>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiChatConversationsConversationIdMessagesPostRequest.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'content',
    'sender',
  };
}

/// Sender of the message
class ApiChatConversationsConversationIdMessagesPostRequestSenderEnum {
  /// Instantiate a new enum with the provided [value].
  const ApiChatConversationsConversationIdMessagesPostRequestSenderEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const user = ApiChatConversationsConversationIdMessagesPostRequestSenderEnum._(r'user');
  static const assistant = ApiChatConversationsConversationIdMessagesPostRequestSenderEnum._(r'assistant');

  /// List of all possible values in this [enum][ApiChatConversationsConversationIdMessagesPostRequestSenderEnum].
  static const values = <ApiChatConversationsConversationIdMessagesPostRequestSenderEnum>[
    user,
    assistant,
  ];

  static ApiChatConversationsConversationIdMessagesPostRequestSenderEnum? fromJson(dynamic value) => ApiChatConversationsConversationIdMessagesPostRequestSenderEnumTypeTransformer().decode(value);

  static List<ApiChatConversationsConversationIdMessagesPostRequestSenderEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiChatConversationsConversationIdMessagesPostRequestSenderEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiChatConversationsConversationIdMessagesPostRequestSenderEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [ApiChatConversationsConversationIdMessagesPostRequestSenderEnum] to String,
/// and [decode] dynamic data back to [ApiChatConversationsConversationIdMessagesPostRequestSenderEnum].
class ApiChatConversationsConversationIdMessagesPostRequestSenderEnumTypeTransformer {
  factory ApiChatConversationsConversationIdMessagesPostRequestSenderEnumTypeTransformer() => _instance ??= const ApiChatConversationsConversationIdMessagesPostRequestSenderEnumTypeTransformer._();

  const ApiChatConversationsConversationIdMessagesPostRequestSenderEnumTypeTransformer._();

  String encode(ApiChatConversationsConversationIdMessagesPostRequestSenderEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a ApiChatConversationsConversationIdMessagesPostRequestSenderEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  ApiChatConversationsConversationIdMessagesPostRequestSenderEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'user': return ApiChatConversationsConversationIdMessagesPostRequestSenderEnum.user;
        case r'assistant': return ApiChatConversationsConversationIdMessagesPostRequestSenderEnum.assistant;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [ApiChatConversationsConversationIdMessagesPostRequestSenderEnumTypeTransformer] instance.
  static ApiChatConversationsConversationIdMessagesPostRequestSenderEnumTypeTransformer? _instance;
}


