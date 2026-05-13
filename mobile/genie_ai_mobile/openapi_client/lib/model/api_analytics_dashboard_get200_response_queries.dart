//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiAnalyticsDashboardGet200ResponseQueries {
  /// Returns a new [ApiAnalyticsDashboardGet200ResponseQueries] instance.
  ApiAnalyticsDashboardGet200ResponseQueries({
    this.total,
    this.unanswered,
    this.answeredPercentage,
    this.avgResponseTime,
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? total;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? unanswered;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  num? answeredPercentage;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  num? avgResponseTime;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiAnalyticsDashboardGet200ResponseQueries &&
    other.total == total &&
    other.unanswered == unanswered &&
    other.answeredPercentage == answeredPercentage &&
    other.avgResponseTime == avgResponseTime;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (total == null ? 0 : total!.hashCode) +
    (unanswered == null ? 0 : unanswered!.hashCode) +
    (answeredPercentage == null ? 0 : answeredPercentage!.hashCode) +
    (avgResponseTime == null ? 0 : avgResponseTime!.hashCode);

  @override
  String toString() => 'ApiAnalyticsDashboardGet200ResponseQueries[total=$total, unanswered=$unanswered, answeredPercentage=$answeredPercentage, avgResponseTime=$avgResponseTime]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.total != null) {
      json[r'total'] = this.total;
    } else {
      json[r'total'] = null;
    }
    if (this.unanswered != null) {
      json[r'unanswered'] = this.unanswered;
    } else {
      json[r'unanswered'] = null;
    }
    if (this.answeredPercentage != null) {
      json[r'answeredPercentage'] = this.answeredPercentage;
    } else {
      json[r'answeredPercentage'] = null;
    }
    if (this.avgResponseTime != null) {
      json[r'avgResponseTime'] = this.avgResponseTime;
    } else {
      json[r'avgResponseTime'] = null;
    }
    return json;
  }

  /// Returns a new [ApiAnalyticsDashboardGet200ResponseQueries] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiAnalyticsDashboardGet200ResponseQueries? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiAnalyticsDashboardGet200ResponseQueries(
        total: mapValueOfType<int>(json, r'total'),
        unanswered: mapValueOfType<int>(json, r'unanswered'),
        answeredPercentage: num.parse('${json[r'answeredPercentage']}'),
        avgResponseTime: num.parse('${json[r'avgResponseTime']}'),
      );
    }
    return null;
  }

  static List<ApiAnalyticsDashboardGet200ResponseQueries> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiAnalyticsDashboardGet200ResponseQueries>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiAnalyticsDashboardGet200ResponseQueries.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiAnalyticsDashboardGet200ResponseQueries> mapFromJson(dynamic json) {
    final map = <String, ApiAnalyticsDashboardGet200ResponseQueries>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiAnalyticsDashboardGet200ResponseQueries.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiAnalyticsDashboardGet200ResponseQueries-objects as value to a dart map
  static Map<String, List<ApiAnalyticsDashboardGet200ResponseQueries>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiAnalyticsDashboardGet200ResponseQueries>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiAnalyticsDashboardGet200ResponseQueries.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

