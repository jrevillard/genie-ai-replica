//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiQueriesQueryIdConversationPost201Response {
  /// Returns a new [ApiQueriesQueryIdConversationPost201Response] instance.
  ApiQueriesQueryIdConversationPost201Response({
    this.conversation,
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Object? conversation;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiQueriesQueryIdConversationPost201Response &&
    other.conversation == conversation;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (conversation == null ? 0 : conversation!.hashCode);

  @override
  String toString() => 'ApiQueriesQueryIdConversationPost201Response[conversation=$conversation]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.conversation != null) {
      json[r'conversation'] = this.conversation;
    } else {
      json[r'conversation'] = null;
    }
    return json;
  }

  /// Returns a new [ApiQueriesQueryIdConversationPost201Response] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiQueriesQueryIdConversationPost201Response? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiQueriesQueryIdConversationPost201Response(
        conversation: mapValueOfType<Object>(json, r'conversation'),
      );
    }
    return null;
  }

  static List<ApiQueriesQueryIdConversationPost201Response> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiQueriesQueryIdConversationPost201Response>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiQueriesQueryIdConversationPost201Response.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiQueriesQueryIdConversationPost201Response> mapFromJson(dynamic json) {
    final map = <String, ApiQueriesQueryIdConversationPost201Response>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiQueriesQueryIdConversationPost201Response.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiQueriesQueryIdConversationPost201Response-objects as value to a dart map
  static Map<String, List<ApiQueriesQueryIdConversationPost201Response>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiQueriesQueryIdConversationPost201Response>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiQueriesQueryIdConversationPost201Response.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

