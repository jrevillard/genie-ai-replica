//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiAnalyticsMetricMetricGet200Response {
  /// Returns a new [ApiAnalyticsMetricMetricGet200Response] instance.
  ApiAnalyticsMetricMetricGet200Response({
    this.metric,
    this.value,
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? metric;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  num? value;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiAnalyticsMetricMetricGet200Response &&
    other.metric == metric &&
    other.value == value;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (metric == null ? 0 : metric!.hashCode) +
    (value == null ? 0 : value!.hashCode);

  @override
  String toString() => 'ApiAnalyticsMetricMetricGet200Response[metric=$metric, value=$value]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.metric != null) {
      json[r'metric'] = this.metric;
    } else {
      json[r'metric'] = null;
    }
    if (this.value != null) {
      json[r'value'] = this.value;
    } else {
      json[r'value'] = null;
    }
    return json;
  }

  /// Returns a new [ApiAnalyticsMetricMetricGet200Response] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiAnalyticsMetricMetricGet200Response? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiAnalyticsMetricMetricGet200Response(
        metric: mapValueOfType<String>(json, r'metric'),
        value: num.parse('${json[r'value']}'),
      );
    }
    return null;
  }

  static List<ApiAnalyticsMetricMetricGet200Response> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiAnalyticsMetricMetricGet200Response>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiAnalyticsMetricMetricGet200Response.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiAnalyticsMetricMetricGet200Response> mapFromJson(dynamic json) {
    final map = <String, ApiAnalyticsMetricMetricGet200Response>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiAnalyticsMetricMetricGet200Response.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiAnalyticsMetricMetricGet200Response-objects as value to a dart map
  static Map<String, List<ApiAnalyticsMetricMetricGet200Response>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiAnalyticsMetricMetricGet200Response>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiAnalyticsMetricMetricGet200Response.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

