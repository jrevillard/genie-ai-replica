//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiQueriesStreamPostRequest {
  /// Returns a new [ApiQueriesStreamPostRequest] instance.
  ApiQueriesStreamPostRequest({
    required this.sessionId,
    this.messages = const [],
    this.context,
  });

  String sessionId;

  List<ApiQueriesStreamPostRequestMessagesInner> messages;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  QueryContext? context;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiQueriesStreamPostRequest &&
    other.sessionId == sessionId &&
    _deepEquality.equals(other.messages, messages) &&
    other.context == context;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (sessionId.hashCode) +
    (messages.hashCode) +
    (context == null ? 0 : context!.hashCode);

  @override
  String toString() => 'ApiQueriesStreamPostRequest[sessionId=$sessionId, messages=$messages, context=$context]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'sessionId'] = this.sessionId;
      json[r'messages'] = this.messages;
    if (this.context != null) {
      json[r'context'] = this.context;
    } else {
      json[r'context'] = null;
    }
    return json;
  }

  /// Returns a new [ApiQueriesStreamPostRequest] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiQueriesStreamPostRequest? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        assert(json.containsKey(r'sessionId'), 'Required key "ApiQueriesStreamPostRequest[sessionId]" is missing from JSON.');
        assert(json[r'sessionId'] != null, 'Required key "ApiQueriesStreamPostRequest[sessionId]" has a null value in JSON.');
        return true;
      }());

      return ApiQueriesStreamPostRequest(
        sessionId: mapValueOfType<String>(json, r'sessionId')!,
        messages: ApiQueriesStreamPostRequestMessagesInner.listFromJson(json[r'messages']),
        context: QueryContext.fromJson(json[r'context']),
      );
    }
    return null;
  }

  static List<ApiQueriesStreamPostRequest> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiQueriesStreamPostRequest>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiQueriesStreamPostRequest.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiQueriesStreamPostRequest> mapFromJson(dynamic json) {
    final map = <String, ApiQueriesStreamPostRequest>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiQueriesStreamPostRequest.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiQueriesStreamPostRequest-objects as value to a dart map
  static Map<String, List<ApiQueriesStreamPostRequest>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiQueriesStreamPostRequest>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiQueriesStreamPostRequest.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'sessionId',
  };
}

