//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiAnalyticsDashboardGet200ResponseTopQueriesInner {
  /// Returns a new [ApiAnalyticsDashboardGet200ResponseTopQueriesInner] instance.
  ApiAnalyticsDashboardGet200ResponseTopQueriesInner({
    this.text,
    this.count,
    this.avgTime,
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? text;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? count;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  num? avgTime;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiAnalyticsDashboardGet200ResponseTopQueriesInner &&
    other.text == text &&
    other.count == count &&
    other.avgTime == avgTime;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (text == null ? 0 : text!.hashCode) +
    (count == null ? 0 : count!.hashCode) +
    (avgTime == null ? 0 : avgTime!.hashCode);

  @override
  String toString() => 'ApiAnalyticsDashboardGet200ResponseTopQueriesInner[text=$text, count=$count, avgTime=$avgTime]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.text != null) {
      json[r'text'] = this.text;
    } else {
      json[r'text'] = null;
    }
    if (this.count != null) {
      json[r'count'] = this.count;
    } else {
      json[r'count'] = null;
    }
    if (this.avgTime != null) {
      json[r'avgTime'] = this.avgTime;
    } else {
      json[r'avgTime'] = null;
    }
    return json;
  }

  /// Returns a new [ApiAnalyticsDashboardGet200ResponseTopQueriesInner] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiAnalyticsDashboardGet200ResponseTopQueriesInner? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiAnalyticsDashboardGet200ResponseTopQueriesInner(
        text: mapValueOfType<String>(json, r'text'),
        count: mapValueOfType<int>(json, r'count'),
        avgTime: num.parse('${json[r'avgTime']}'),
      );
    }
    return null;
  }

  static List<ApiAnalyticsDashboardGet200ResponseTopQueriesInner> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiAnalyticsDashboardGet200ResponseTopQueriesInner>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiAnalyticsDashboardGet200ResponseTopQueriesInner.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiAnalyticsDashboardGet200ResponseTopQueriesInner> mapFromJson(dynamic json) {
    final map = <String, ApiAnalyticsDashboardGet200ResponseTopQueriesInner>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiAnalyticsDashboardGet200ResponseTopQueriesInner.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiAnalyticsDashboardGet200ResponseTopQueriesInner-objects as value to a dart map
  static Map<String, List<ApiAnalyticsDashboardGet200ResponseTopQueriesInner>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiAnalyticsDashboardGet200ResponseTopQueriesInner>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiAnalyticsDashboardGet200ResponseTopQueriesInner.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

