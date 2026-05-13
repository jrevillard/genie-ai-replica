//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiChatConversationsPostRequest {
  /// Returns a new [ApiChatConversationsPostRequest] instance.
  ApiChatConversationsPostRequest({
    required this.title,
    this.categoryId,
    this.initialMessage,
    this.tags = const [],
  });

  /// Title of the conversation
  String title;

  /// ID of the service category
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? categoryId;

  /// Initial message to include in the conversation
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? initialMessage;

  /// Tags associated with the conversation
  List<String> tags;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiChatConversationsPostRequest &&
    other.title == title &&
    other.categoryId == categoryId &&
    other.initialMessage == initialMessage &&
    _deepEquality.equals(other.tags, tags);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (title.hashCode) +
    (categoryId == null ? 0 : categoryId!.hashCode) +
    (initialMessage == null ? 0 : initialMessage!.hashCode) +
    (tags.hashCode);

  @override
  String toString() => 'ApiChatConversationsPostRequest[title=$title, categoryId=$categoryId, initialMessage=$initialMessage, tags=$tags]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'title'] = this.title;
    if (this.categoryId != null) {
      json[r'categoryId'] = this.categoryId;
    } else {
      json[r'categoryId'] = null;
    }
    if (this.initialMessage != null) {
      json[r'initialMessage'] = this.initialMessage;
    } else {
      json[r'initialMessage'] = null;
    }
      json[r'tags'] = this.tags;
    return json;
  }

  /// Returns a new [ApiChatConversationsPostRequest] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiChatConversationsPostRequest? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        assert(json.containsKey(r'title'), 'Required key "ApiChatConversationsPostRequest[title]" is missing from JSON.');
        assert(json[r'title'] != null, 'Required key "ApiChatConversationsPostRequest[title]" has a null value in JSON.');
        return true;
      }());

      return ApiChatConversationsPostRequest(
        title: mapValueOfType<String>(json, r'title')!,
        categoryId: mapValueOfType<String>(json, r'categoryId'),
        initialMessage: mapValueOfType<String>(json, r'initialMessage'),
        tags: json[r'tags'] is Iterable
            ? (json[r'tags'] as Iterable).cast<String>().toList(growable: false)
            : const [],
      );
    }
    return null;
  }

  static List<ApiChatConversationsPostRequest> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiChatConversationsPostRequest>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiChatConversationsPostRequest.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiChatConversationsPostRequest> mapFromJson(dynamic json) {
    final map = <String, ApiChatConversationsPostRequest>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiChatConversationsPostRequest.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiChatConversationsPostRequest-objects as value to a dart map
  static Map<String, List<ApiChatConversationsPostRequest>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiChatConversationsPostRequest>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiChatConversationsPostRequest.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'title',
  };
}

