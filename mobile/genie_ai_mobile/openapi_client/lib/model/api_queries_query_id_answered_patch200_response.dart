//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiQueriesQueryIdAnsweredPatch200Response {
  /// Returns a new [ApiQueriesQueryIdAnsweredPatch200Response] instance.
  ApiQueriesQueryIdAnsweredPatch200Response({
    this.key,
    this.isAnswered,
    this.responseTime,
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? key;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  bool? isAnswered;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? responseTime;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiQueriesQueryIdAnsweredPatch200Response &&
    other.key == key &&
    other.isAnswered == isAnswered &&
    other.responseTime == responseTime;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (key == null ? 0 : key!.hashCode) +
    (isAnswered == null ? 0 : isAnswered!.hashCode) +
    (responseTime == null ? 0 : responseTime!.hashCode);

  @override
  String toString() => 'ApiQueriesQueryIdAnsweredPatch200Response[key=$key, isAnswered=$isAnswered, responseTime=$responseTime]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.key != null) {
      json[r'_key'] = this.key;
    } else {
      json[r'_key'] = null;
    }
    if (this.isAnswered != null) {
      json[r'isAnswered'] = this.isAnswered;
    } else {
      json[r'isAnswered'] = null;
    }
    if (this.responseTime != null) {
      json[r'responseTime'] = this.responseTime;
    } else {
      json[r'responseTime'] = null;
    }
    return json;
  }

  /// Returns a new [ApiQueriesQueryIdAnsweredPatch200Response] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiQueriesQueryIdAnsweredPatch200Response? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiQueriesQueryIdAnsweredPatch200Response(
        key: mapValueOfType<String>(json, r'_key'),
        isAnswered: mapValueOfType<bool>(json, r'isAnswered'),
        responseTime: mapValueOfType<int>(json, r'responseTime'),
      );
    }
    return null;
  }

  static List<ApiQueriesQueryIdAnsweredPatch200Response> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiQueriesQueryIdAnsweredPatch200Response>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiQueriesQueryIdAnsweredPatch200Response.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiQueriesQueryIdAnsweredPatch200Response> mapFromJson(dynamic json) {
    final map = <String, ApiQueriesQueryIdAnsweredPatch200Response>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiQueriesQueryIdAnsweredPatch200Response.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiQueriesQueryIdAnsweredPatch200Response-objects as value to a dart map
  static Map<String, List<ApiQueriesQueryIdAnsweredPatch200Response>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiQueriesQueryIdAnsweredPatch200Response>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiQueriesQueryIdAnsweredPatch200Response.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

