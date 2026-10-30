//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiAdminSystemHealthGet200Response {
  /// Returns a new [ApiAdminSystemHealthGet200Response] instance.
  ApiAdminSystemHealthGet200Response({
    this.metrics,
    this.trends,
    this.resourceUsage,
    this.healthServices = const [],
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  ApiAdminSystemHealthGet200ResponseMetrics? metrics;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  ApiAdminSystemHealthGet200ResponseTrends? trends;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  ApiAdminSystemHealthGet200ResponseResourceUsage? resourceUsage;

  List<ApiAdminSystemHealthGet200ResponseHealthServicesInner> healthServices;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiAdminSystemHealthGet200Response &&
    other.metrics == metrics &&
    other.trends == trends &&
    other.resourceUsage == resourceUsage &&
    _deepEquality.equals(other.healthServices, healthServices);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (metrics == null ? 0 : metrics!.hashCode) +
    (trends == null ? 0 : trends!.hashCode) +
    (resourceUsage == null ? 0 : resourceUsage!.hashCode) +
    (healthServices.hashCode);

  @override
  String toString() => 'ApiAdminSystemHealthGet200Response[metrics=$metrics, trends=$trends, resourceUsage=$resourceUsage, healthServices=$healthServices]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.metrics != null) {
      json[r'metrics'] = this.metrics;
    } else {
      json[r'metrics'] = null;
    }
    if (this.trends != null) {
      json[r'trends'] = this.trends;
    } else {
      json[r'trends'] = null;
    }
    if (this.resourceUsage != null) {
      json[r'resourceUsage'] = this.resourceUsage;
    } else {
      json[r'resourceUsage'] = null;
    }
      json[r'healthServices'] = this.healthServices;
    return json;
  }

  /// Returns a new [ApiAdminSystemHealthGet200Response] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiAdminSystemHealthGet200Response? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiAdminSystemHealthGet200Response(
        metrics: ApiAdminSystemHealthGet200ResponseMetrics.fromJson(json[r'metrics']),
        trends: ApiAdminSystemHealthGet200ResponseTrends.fromJson(json[r'trends']),
        resourceUsage: ApiAdminSystemHealthGet200ResponseResourceUsage.fromJson(json[r'resourceUsage']),
        healthServices: ApiAdminSystemHealthGet200ResponseHealthServicesInner.listFromJson(json[r'healthServices']),
      );
    }
    return null;
  }

  static List<ApiAdminSystemHealthGet200Response> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiAdminSystemHealthGet200Response>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiAdminSystemHealthGet200Response.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiAdminSystemHealthGet200Response> mapFromJson(dynamic json) {
    final map = <String, ApiAdminSystemHealthGet200Response>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiAdminSystemHealthGet200Response.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiAdminSystemHealthGet200Response-objects as value to a dart map
  static Map<String, List<ApiAdminSystemHealthGet200Response>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiAdminSystemHealthGet200Response>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiAdminSystemHealthGet200Response.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

