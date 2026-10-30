//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiAdminSystemHealthGet200ResponseResourceUsage {
  /// Returns a new [ApiAdminSystemHealthGet200ResponseResourceUsage] instance.
  ApiAdminSystemHealthGet200ResponseResourceUsage({
    this.cpu,
    this.memory,
    this.storage,
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  num? cpu;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  num? memory;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  num? storage;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiAdminSystemHealthGet200ResponseResourceUsage &&
    other.cpu == cpu &&
    other.memory == memory &&
    other.storage == storage;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (cpu == null ? 0 : cpu!.hashCode) +
    (memory == null ? 0 : memory!.hashCode) +
    (storage == null ? 0 : storage!.hashCode);

  @override
  String toString() => 'ApiAdminSystemHealthGet200ResponseResourceUsage[cpu=$cpu, memory=$memory, storage=$storage]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.cpu != null) {
      json[r'cpu'] = this.cpu;
    } else {
      json[r'cpu'] = null;
    }
    if (this.memory != null) {
      json[r'memory'] = this.memory;
    } else {
      json[r'memory'] = null;
    }
    if (this.storage != null) {
      json[r'storage'] = this.storage;
    } else {
      json[r'storage'] = null;
    }
    return json;
  }

  /// Returns a new [ApiAdminSystemHealthGet200ResponseResourceUsage] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiAdminSystemHealthGet200ResponseResourceUsage? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiAdminSystemHealthGet200ResponseResourceUsage(
        cpu: num.parse('${json[r'cpu']}'),
        memory: num.parse('${json[r'memory']}'),
        storage: num.parse('${json[r'storage']}'),
      );
    }
    return null;
  }

  static List<ApiAdminSystemHealthGet200ResponseResourceUsage> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiAdminSystemHealthGet200ResponseResourceUsage>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiAdminSystemHealthGet200ResponseResourceUsage.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiAdminSystemHealthGet200ResponseResourceUsage> mapFromJson(dynamic json) {
    final map = <String, ApiAdminSystemHealthGet200ResponseResourceUsage>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiAdminSystemHealthGet200ResponseResourceUsage.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiAdminSystemHealthGet200ResponseResourceUsage-objects as value to a dart map
  static Map<String, List<ApiAdminSystemHealthGet200ResponseResourceUsage>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiAdminSystemHealthGet200ResponseResourceUsage>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiAdminSystemHealthGet200ResponseResourceUsage.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

