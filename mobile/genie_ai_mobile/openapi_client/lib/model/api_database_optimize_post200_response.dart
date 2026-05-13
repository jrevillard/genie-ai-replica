//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiDatabaseOptimizePost200Response {
  /// Returns a new [ApiDatabaseOptimizePost200Response] instance.
  ApiDatabaseOptimizePost200Response({
    this.success,
    this.message,
    this.results = const [],
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  bool? success;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? message;

  List<ApiDatabaseOptimizePost200ResponseResultsInner> results;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiDatabaseOptimizePost200Response &&
    other.success == success &&
    other.message == message &&
    _deepEquality.equals(other.results, results);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (success == null ? 0 : success!.hashCode) +
    (message == null ? 0 : message!.hashCode) +
    (results.hashCode);

  @override
  String toString() => 'ApiDatabaseOptimizePost200Response[success=$success, message=$message, results=$results]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.success != null) {
      json[r'success'] = this.success;
    } else {
      json[r'success'] = null;
    }
    if (this.message != null) {
      json[r'message'] = this.message;
    } else {
      json[r'message'] = null;
    }
      json[r'results'] = this.results;
    return json;
  }

  /// Returns a new [ApiDatabaseOptimizePost200Response] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiDatabaseOptimizePost200Response? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiDatabaseOptimizePost200Response(
        success: mapValueOfType<bool>(json, r'success'),
        message: mapValueOfType<String>(json, r'message'),
        results: ApiDatabaseOptimizePost200ResponseResultsInner.listFromJson(json[r'results']),
      );
    }
    return null;
  }

  static List<ApiDatabaseOptimizePost200Response> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiDatabaseOptimizePost200Response>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiDatabaseOptimizePost200Response.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiDatabaseOptimizePost200Response> mapFromJson(dynamic json) {
    final map = <String, ApiDatabaseOptimizePost200Response>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiDatabaseOptimizePost200Response.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiDatabaseOptimizePost200Response-objects as value to a dart map
  static Map<String, List<ApiDatabaseOptimizePost200Response>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiDatabaseOptimizePost200Response>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiDatabaseOptimizePost200Response.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

