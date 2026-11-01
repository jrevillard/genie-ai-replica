//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiAdminSecurityMetricsGet200ResponseDataVulnerabilities {
  /// Returns a new [ApiAdminSecurityMetricsGet200ResponseDataVulnerabilities] instance.
  ApiAdminSecurityMetricsGet200ResponseDataVulnerabilities({
    this.critical,
    this.medium,
    this.low,
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? critical;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? medium;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? low;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiAdminSecurityMetricsGet200ResponseDataVulnerabilities &&
    other.critical == critical &&
    other.medium == medium &&
    other.low == low;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (critical == null ? 0 : critical!.hashCode) +
    (medium == null ? 0 : medium!.hashCode) +
    (low == null ? 0 : low!.hashCode);

  @override
  String toString() => 'ApiAdminSecurityMetricsGet200ResponseDataVulnerabilities[critical=$critical, medium=$medium, low=$low]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.critical != null) {
      json[r'critical'] = this.critical;
    } else {
      json[r'critical'] = null;
    }
    if (this.medium != null) {
      json[r'medium'] = this.medium;
    } else {
      json[r'medium'] = null;
    }
    if (this.low != null) {
      json[r'low'] = this.low;
    } else {
      json[r'low'] = null;
    }
    return json;
  }

  /// Returns a new [ApiAdminSecurityMetricsGet200ResponseDataVulnerabilities] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiAdminSecurityMetricsGet200ResponseDataVulnerabilities? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiAdminSecurityMetricsGet200ResponseDataVulnerabilities(
        critical: mapValueOfType<int>(json, r'critical'),
        medium: mapValueOfType<int>(json, r'medium'),
        low: mapValueOfType<int>(json, r'low'),
      );
    }
    return null;
  }

  static List<ApiAdminSecurityMetricsGet200ResponseDataVulnerabilities> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiAdminSecurityMetricsGet200ResponseDataVulnerabilities>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiAdminSecurityMetricsGet200ResponseDataVulnerabilities.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiAdminSecurityMetricsGet200ResponseDataVulnerabilities> mapFromJson(dynamic json) {
    final map = <String, ApiAdminSecurityMetricsGet200ResponseDataVulnerabilities>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiAdminSecurityMetricsGet200ResponseDataVulnerabilities.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiAdminSecurityMetricsGet200ResponseDataVulnerabilities-objects as value to a dart map
  static Map<String, List<ApiAdminSecurityMetricsGet200ResponseDataVulnerabilities>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiAdminSecurityMetricsGet200ResponseDataVulnerabilities>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiAdminSecurityMetricsGet200ResponseDataVulnerabilities.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

