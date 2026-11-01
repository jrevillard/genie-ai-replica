//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiAdminSystemHealthGet200ResponseMetrics {
  /// Returns a new [ApiAdminSystemHealthGet200ResponseMetrics] instance.
  ApiAdminSystemHealthGet200ResponseMetrics({
    this.systemUptime,
    this.avgResponseTime,
    this.errorRate,
    this.monthlyActiveUsers,
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  num? systemUptime;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  num? avgResponseTime;

  /// Percentage of ERROR+FATAL severity_text rows in the last 24h. null when VL is unreachable.
  num? errorRate;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? monthlyActiveUsers;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiAdminSystemHealthGet200ResponseMetrics &&
    other.systemUptime == systemUptime &&
    other.avgResponseTime == avgResponseTime &&
    other.errorRate == errorRate &&
    other.monthlyActiveUsers == monthlyActiveUsers;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (systemUptime == null ? 0 : systemUptime!.hashCode) +
    (avgResponseTime == null ? 0 : avgResponseTime!.hashCode) +
    (errorRate == null ? 0 : errorRate!.hashCode) +
    (monthlyActiveUsers == null ? 0 : monthlyActiveUsers!.hashCode);

  @override
  String toString() => 'ApiAdminSystemHealthGet200ResponseMetrics[systemUptime=$systemUptime, avgResponseTime=$avgResponseTime, errorRate=$errorRate, monthlyActiveUsers=$monthlyActiveUsers]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.systemUptime != null) {
      json[r'systemUptime'] = this.systemUptime;
    } else {
      json[r'systemUptime'] = null;
    }
    if (this.avgResponseTime != null) {
      json[r'avgResponseTime'] = this.avgResponseTime;
    } else {
      json[r'avgResponseTime'] = null;
    }
    if (this.errorRate != null) {
      json[r'errorRate'] = this.errorRate;
    } else {
      json[r'errorRate'] = null;
    }
    if (this.monthlyActiveUsers != null) {
      json[r'monthlyActiveUsers'] = this.monthlyActiveUsers;
    } else {
      json[r'monthlyActiveUsers'] = null;
    }
    return json;
  }

  /// Returns a new [ApiAdminSystemHealthGet200ResponseMetrics] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiAdminSystemHealthGet200ResponseMetrics? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiAdminSystemHealthGet200ResponseMetrics(
        systemUptime: num.parse('${json[r'systemUptime']}'),
        avgResponseTime: num.parse('${json[r'avgResponseTime']}'),
        errorRate: json[r'errorRate'] == null
            ? null
            : num.parse('${json[r'errorRate']}'),
        monthlyActiveUsers: mapValueOfType<int>(json, r'monthlyActiveUsers'),
      );
    }
    return null;
  }

  static List<ApiAdminSystemHealthGet200ResponseMetrics> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiAdminSystemHealthGet200ResponseMetrics>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiAdminSystemHealthGet200ResponseMetrics.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiAdminSystemHealthGet200ResponseMetrics> mapFromJson(dynamic json) {
    final map = <String, ApiAdminSystemHealthGet200ResponseMetrics>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiAdminSystemHealthGet200ResponseMetrics.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiAdminSystemHealthGet200ResponseMetrics-objects as value to a dart map
  static Map<String, List<ApiAdminSystemHealthGet200ResponseMetrics>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiAdminSystemHealthGet200ResponseMetrics>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiAdminSystemHealthGet200ResponseMetrics.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

