//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiChatConversationsConversationIdPatchRequest {
  /// Returns a new [ApiChatConversationsConversationIdPatchRequest] instance.
  ApiChatConversationsConversationIdPatchRequest({
    this.title,
    this.isStarred,
    this.isArchived,
    this.tags = const [],
    this.categoryId,
  });

  /// New title for the conversation
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? title;

  /// Star status
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  bool? isStarred;

  /// Archive status
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  bool? isArchived;

  /// Tags for the conversation
  List<String> tags;

  /// ID of the service category
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? categoryId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiChatConversationsConversationIdPatchRequest &&
    other.title == title &&
    other.isStarred == isStarred &&
    other.isArchived == isArchived &&
    _deepEquality.equals(other.tags, tags) &&
    other.categoryId == categoryId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (title == null ? 0 : title!.hashCode) +
    (isStarred == null ? 0 : isStarred!.hashCode) +
    (isArchived == null ? 0 : isArchived!.hashCode) +
    (tags.hashCode) +
    (categoryId == null ? 0 : categoryId!.hashCode);

  @override
  String toString() => 'ApiChatConversationsConversationIdPatchRequest[title=$title, isStarred=$isStarred, isArchived=$isArchived, tags=$tags, categoryId=$categoryId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.title != null) {
      json[r'title'] = this.title;
    } else {
      json[r'title'] = null;
    }
    if (this.isStarred != null) {
      json[r'isStarred'] = this.isStarred;
    } else {
      json[r'isStarred'] = null;
    }
    if (this.isArchived != null) {
      json[r'isArchived'] = this.isArchived;
    } else {
      json[r'isArchived'] = null;
    }
      json[r'tags'] = this.tags;
    if (this.categoryId != null) {
      json[r'categoryId'] = this.categoryId;
    } else {
      json[r'categoryId'] = null;
    }
    return json;
  }

  /// Returns a new [ApiChatConversationsConversationIdPatchRequest] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiChatConversationsConversationIdPatchRequest? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiChatConversationsConversationIdPatchRequest(
        title: mapValueOfType<String>(json, r'title'),
        isStarred: mapValueOfType<bool>(json, r'isStarred'),
        isArchived: mapValueOfType<bool>(json, r'isArchived'),
        tags: json[r'tags'] is Iterable
            ? (json[r'tags'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        categoryId: mapValueOfType<String>(json, r'categoryId'),
      );
    }
    return null;
  }

  static List<ApiChatConversationsConversationIdPatchRequest> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiChatConversationsConversationIdPatchRequest>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiChatConversationsConversationIdPatchRequest.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiChatConversationsConversationIdPatchRequest> mapFromJson(dynamic json) {
    final map = <String, ApiChatConversationsConversationIdPatchRequest>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiChatConversationsConversationIdPatchRequest.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiChatConversationsConversationIdPatchRequest-objects as value to a dart map
  static Map<String, List<ApiChatConversationsConversationIdPatchRequest>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiChatConversationsConversationIdPatchRequest>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiChatConversationsConversationIdPatchRequest.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

