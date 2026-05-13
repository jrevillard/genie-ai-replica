//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiAnalyticsDashboardGet200ResponseUsers {
  /// Returns a new [ApiAnalyticsDashboardGet200ResponseUsers] instance.
  ApiAnalyticsDashboardGet200ResponseUsers({
    this.activeCount,
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? activeCount;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiAnalyticsDashboardGet200ResponseUsers &&
    other.activeCount == activeCount;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (activeCount == null ? 0 : activeCount!.hashCode);

  @override
  String toString() => 'ApiAnalyticsDashboardGet200ResponseUsers[activeCount=$activeCount]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.activeCount != null) {
      json[r'activeCount'] = this.activeCount;
    } else {
      json[r'activeCount'] = null;
    }
    return json;
  }

  /// Returns a new [ApiAnalyticsDashboardGet200ResponseUsers] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiAnalyticsDashboardGet200ResponseUsers? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiAnalyticsDashboardGet200ResponseUsers(
        activeCount: mapValueOfType<int>(json, r'activeCount'),
      );
    }
    return null;
  }

  static List<ApiAnalyticsDashboardGet200ResponseUsers> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiAnalyticsDashboardGet200ResponseUsers>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiAnalyticsDashboardGet200ResponseUsers.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiAnalyticsDashboardGet200ResponseUsers> mapFromJson(dynamic json) {
    final map = <String, ApiAnalyticsDashboardGet200ResponseUsers>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiAnalyticsDashboardGet200ResponseUsers.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiAnalyticsDashboardGet200ResponseUsers-objects as value to a dart map
  static Map<String, List<ApiAnalyticsDashboardGet200ResponseUsers>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiAnalyticsDashboardGet200ResponseUsers>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiAnalyticsDashboardGet200ResponseUsers.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

