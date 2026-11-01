//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiAdminSecurityScanPost200ResponseDataVulnerabilities {
  /// Returns a new [ApiAdminSecurityScanPost200ResponseDataVulnerabilities] instance.
  ApiAdminSecurityScanPost200ResponseDataVulnerabilities({
    this.critical,
    this.medium,
    this.low,
    this.details = const [],
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

  List<Object> details;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiAdminSecurityScanPost200ResponseDataVulnerabilities &&
    other.critical == critical &&
    other.medium == medium &&
    other.low == low &&
    _deepEquality.equals(other.details, details);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (critical == null ? 0 : critical!.hashCode) +
    (medium == null ? 0 : medium!.hashCode) +
    (low == null ? 0 : low!.hashCode) +
    (details.hashCode);

  @override
  String toString() => 'ApiAdminSecurityScanPost200ResponseDataVulnerabilities[critical=$critical, medium=$medium, low=$low, details=$details]';

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
      json[r'details'] = this.details;
    return json;
  }

  /// Returns a new [ApiAdminSecurityScanPost200ResponseDataVulnerabilities] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiAdminSecurityScanPost200ResponseDataVulnerabilities? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiAdminSecurityScanPost200ResponseDataVulnerabilities(
        critical: mapValueOfType<int>(json, r'critical'),
        medium: mapValueOfType<int>(json, r'medium'),
        low: mapValueOfType<int>(json, r'low'),
        details: json[r'details'] is Iterable
            ? (json[r'details'] as Iterable).cast<Object>().toList(growable: false)
            : const [],
      );
    }
    return null;
  }

  static List<ApiAdminSecurityScanPost200ResponseDataVulnerabilities> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiAdminSecurityScanPost200ResponseDataVulnerabilities>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiAdminSecurityScanPost200ResponseDataVulnerabilities.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiAdminSecurityScanPost200ResponseDataVulnerabilities> mapFromJson(dynamic json) {
    final map = <String, ApiAdminSecurityScanPost200ResponseDataVulnerabilities>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiAdminSecurityScanPost200ResponseDataVulnerabilities.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiAdminSecurityScanPost200ResponseDataVulnerabilities-objects as value to a dart map
  static Map<String, List<ApiAdminSecurityScanPost200ResponseDataVulnerabilities>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiAdminSecurityScanPost200ResponseDataVulnerabilities>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiAdminSecurityScanPost200ResponseDataVulnerabilities.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

