//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiAdminLogsSummaryGet200Response {
  /// Returns a new [ApiAdminLogsSummaryGet200Response] instance.
  ApiAdminLogsSummaryGet200Response({
    this.errors = const [],
    this.warnings = const [],
    this.services = const [],
    this.date,
    this.degraded,
  });

  List<Object> errors;

  List<Object> warnings;

  List<ApiAdminLogsSummaryGet200ResponseServicesInner> services;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? date;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  bool? degraded;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiAdminLogsSummaryGet200Response &&
    _deepEquality.equals(other.errors, errors) &&
    _deepEquality.equals(other.warnings, warnings) &&
    _deepEquality.equals(other.services, services) &&
    other.date == date &&
    other.degraded == degraded;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (errors.hashCode) +
    (warnings.hashCode) +
    (services.hashCode) +
    (date == null ? 0 : date!.hashCode) +
    (degraded == null ? 0 : degraded!.hashCode);

  @override
  String toString() => 'ApiAdminLogsSummaryGet200Response[errors=$errors, warnings=$warnings, services=$services, date=$date, degraded=$degraded]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'errors'] = this.errors;
      json[r'warnings'] = this.warnings;
      json[r'services'] = this.services;
    if (this.date != null) {
      json[r'date'] = this.date;
    } else {
      json[r'date'] = null;
    }
    if (this.degraded != null) {
      json[r'degraded'] = this.degraded;
    } else {
      json[r'degraded'] = null;
    }
    return json;
  }

  /// Returns a new [ApiAdminLogsSummaryGet200Response] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiAdminLogsSummaryGet200Response? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiAdminLogsSummaryGet200Response(
        errors: json[r'errors'] is Iterable
            ? (json[r'errors'] as Iterable).cast<Object>().toList(growable: false)
            : const [],
        warnings: json[r'warnings'] is Iterable
            ? (json[r'warnings'] as Iterable).cast<Object>().toList(growable: false)
            : const [],
        services: ApiAdminLogsSummaryGet200ResponseServicesInner.listFromJson(json[r'services']),
        date: mapValueOfType<String>(json, r'date'),
        degraded: mapValueOfType<bool>(json, r'degraded'),
      );
    }
    return null;
  }

  static List<ApiAdminLogsSummaryGet200Response> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiAdminLogsSummaryGet200Response>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiAdminLogsSummaryGet200Response.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiAdminLogsSummaryGet200Response> mapFromJson(dynamic json) {
    final map = <String, ApiAdminLogsSummaryGet200Response>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiAdminLogsSummaryGet200Response.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiAdminLogsSummaryGet200Response-objects as value to a dart map
  static Map<String, List<ApiAdminLogsSummaryGet200Response>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiAdminLogsSummaryGet200Response>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiAdminLogsSummaryGet200Response.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

