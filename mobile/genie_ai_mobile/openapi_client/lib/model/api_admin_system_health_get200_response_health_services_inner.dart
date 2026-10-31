//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiAdminSystemHealthGet200ResponseHealthServicesInner {
  /// Returns a new [ApiAdminSystemHealthGet200ResponseHealthServicesInner] instance.
  ApiAdminSystemHealthGet200ResponseHealthServicesInner({
    this.id,
    this.name,
    this.status,
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? id;

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
  String? status;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiAdminSystemHealthGet200ResponseHealthServicesInner &&
    other.id == id &&
    other.name == name &&
    other.status == status;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (id == null ? 0 : id!.hashCode) +
    (name == null ? 0 : name!.hashCode) +
    (status == null ? 0 : status!.hashCode);

  @override
  String toString() => 'ApiAdminSystemHealthGet200ResponseHealthServicesInner[id=$id, name=$name, status=$status]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.id != null) {
      json[r'id'] = this.id;
    } else {
      json[r'id'] = null;
    }
    if (this.name != null) {
      json[r'name'] = this.name;
    } else {
      json[r'name'] = null;
    }
    if (this.status != null) {
      json[r'status'] = this.status;
    } else {
      json[r'status'] = null;
    }
    return json;
  }

  /// Returns a new [ApiAdminSystemHealthGet200ResponseHealthServicesInner] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiAdminSystemHealthGet200ResponseHealthServicesInner? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiAdminSystemHealthGet200ResponseHealthServicesInner(
        id: mapValueOfType<String>(json, r'id'),
        name: mapValueOfType<String>(json, r'name'),
        status: mapValueOfType<String>(json, r'status'),
      );
    }
    return null;
  }

  static List<ApiAdminSystemHealthGet200ResponseHealthServicesInner> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiAdminSystemHealthGet200ResponseHealthServicesInner>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiAdminSystemHealthGet200ResponseHealthServicesInner.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiAdminSystemHealthGet200ResponseHealthServicesInner> mapFromJson(dynamic json) {
    final map = <String, ApiAdminSystemHealthGet200ResponseHealthServicesInner>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiAdminSystemHealthGet200ResponseHealthServicesInner.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiAdminSystemHealthGet200ResponseHealthServicesInner-objects as value to a dart map
  static Map<String, List<ApiAdminSystemHealthGet200ResponseHealthServicesInner>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiAdminSystemHealthGet200ResponseHealthServicesInner>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiAdminSystemHealthGet200ResponseHealthServicesInner.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

