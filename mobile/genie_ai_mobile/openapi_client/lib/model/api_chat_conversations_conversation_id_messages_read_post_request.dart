//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiChatConversationsConversationIdMessagesReadPostRequest {
  /// Returns a new [ApiChatConversationsConversationIdMessagesReadPostRequest] instance.
  ApiChatConversationsConversationIdMessagesReadPostRequest({
    this.messageIds = const [],
  });

  /// Specific message IDs to mark as read (if empty, marks all messages)
  List<String> messageIds;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiChatConversationsConversationIdMessagesReadPostRequest &&
    _deepEquality.equals(other.messageIds, messageIds);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (messageIds.hashCode);

  @override
  String toString() => 'ApiChatConversationsConversationIdMessagesReadPostRequest[messageIds=$messageIds]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'messageIds'] = this.messageIds;
    return json;
  }

  /// Returns a new [ApiChatConversationsConversationIdMessagesReadPostRequest] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiChatConversationsConversationIdMessagesReadPostRequest? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiChatConversationsConversationIdMessagesReadPostRequest(
        messageIds: json[r'messageIds'] is Iterable
            ? (json[r'messageIds'] as Iterable).cast<String>().toList(growable: false)
            : const [],
      );
    }
    return null;
  }

  static List<ApiChatConversationsConversationIdMessagesReadPostRequest> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiChatConversationsConversationIdMessagesReadPostRequest>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiChatConversationsConversationIdMessagesReadPostRequest.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiChatConversationsConversationIdMessagesReadPostRequest> mapFromJson(dynamic json) {
    final map = <String, ApiChatConversationsConversationIdMessagesReadPostRequest>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiChatConversationsConversationIdMessagesReadPostRequest.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiChatConversationsConversationIdMessagesReadPostRequest-objects as value to a dart map
  static Map<String, List<ApiChatConversationsConversationIdMessagesReadPostRequest>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiChatConversationsConversationIdMessagesReadPostRequest>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiChatConversationsConversationIdMessagesReadPostRequest.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

