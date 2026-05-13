//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiChatConversationsConversationIdMovePostRequest {
  /// Returns a new [ApiChatConversationsConversationIdMovePostRequest] instance.
  ApiChatConversationsConversationIdMovePostRequest({
    this.sourceFolderId,
    this.targetFolderId,
  });

  /// Source folder ID (null for root)
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? sourceFolderId;

  /// Target folder ID (null for root)
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? targetFolderId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiChatConversationsConversationIdMovePostRequest &&
    other.sourceFolderId == sourceFolderId &&
    other.targetFolderId == targetFolderId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (sourceFolderId == null ? 0 : sourceFolderId!.hashCode) +
    (targetFolderId == null ? 0 : targetFolderId!.hashCode);

  @override
  String toString() => 'ApiChatConversationsConversationIdMovePostRequest[sourceFolderId=$sourceFolderId, targetFolderId=$targetFolderId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.sourceFolderId != null) {
      json[r'sourceFolderId'] = this.sourceFolderId;
    } else {
      json[r'sourceFolderId'] = null;
    }
    if (this.targetFolderId != null) {
      json[r'targetFolderId'] = this.targetFolderId;
    } else {
      json[r'targetFolderId'] = null;
    }
    return json;
  }

  /// Returns a new [ApiChatConversationsConversationIdMovePostRequest] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiChatConversationsConversationIdMovePostRequest? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiChatConversationsConversationIdMovePostRequest(
        sourceFolderId: mapValueOfType<String>(json, r'sourceFolderId'),
        targetFolderId: mapValueOfType<String>(json, r'targetFolderId'),
      );
    }
    return null;
  }

  static List<ApiChatConversationsConversationIdMovePostRequest> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiChatConversationsConversationIdMovePostRequest>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiChatConversationsConversationIdMovePostRequest.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiChatConversationsConversationIdMovePostRequest> mapFromJson(dynamic json) {
    final map = <String, ApiChatConversationsConversationIdMovePostRequest>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiChatConversationsConversationIdMovePostRequest.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiChatConversationsConversationIdMovePostRequest-objects as value to a dart map
  static Map<String, List<ApiChatConversationsConversationIdMovePostRequest>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiChatConversationsConversationIdMovePostRequest>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiChatConversationsConversationIdMovePostRequest.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

