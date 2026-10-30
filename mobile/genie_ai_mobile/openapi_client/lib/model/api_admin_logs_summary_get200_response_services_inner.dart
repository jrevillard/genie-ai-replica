//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiAdminLogsSummaryGet200ResponseServicesInner {
  /// Returns a new [ApiAdminLogsSummaryGet200ResponseServicesInner] instance.
  ApiAdminLogsSummaryGet200ResponseServicesInner({
    this.name,
    this.count,
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? name;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? count;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiAdminLogsSummaryGet200ResponseServicesInner &&
    other.name == name &&
    other.count == count;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (name == null ? 0 : name!.hashCode) +
    (count == null ? 0 : count!.hashCode);

  @override
  String toString() => 'ApiAdminLogsSummaryGet200ResponseServicesInner[name=$name, count=$count]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.name != null) {
      json[r'name'] = this.name;
    } else {
      json[r'name'] = null;
    }
    if (this.count != null) {
      json[r'count'] = this.count;
    } else {
      json[r'count'] = null;
    }
    return json;
  }

  /// Returns a new [ApiAdminLogsSummaryGet200ResponseServicesInner] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiAdminLogsSummaryGet200ResponseServicesInner? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiAdminLogsSummaryGet200ResponseServicesInner(
        name: mapValueOfType<String>(json, r'name'),
        count: mapValueOfType<int>(json, r'count'),
      );
    }
    return null;
  }

  static List<ApiAdminLogsSummaryGet200ResponseServicesInner> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiAdminLogsSummaryGet200ResponseServicesInner>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiAdminLogsSummaryGet200ResponseServicesInner.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiAdminLogsSummaryGet200ResponseServicesInner> mapFromJson(dynamic json) {
    final map = <String, ApiAdminLogsSummaryGet200ResponseServicesInner>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiAdminLogsSummaryGet200ResponseServicesInner.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiAdminLogsSummaryGet200ResponseServicesInner-objects as value to a dart map
  static Map<String, List<ApiAdminLogsSummaryGet200ResponseServicesInner>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiAdminLogsSummaryGet200ResponseServicesInner>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiAdminLogsSummaryGet200ResponseServicesInner.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

