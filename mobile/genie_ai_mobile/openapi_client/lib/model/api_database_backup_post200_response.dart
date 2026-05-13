//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiDatabaseBackupPost200Response {
  /// Returns a new [ApiDatabaseBackupPost200Response] instance.
  ApiDatabaseBackupPost200Response({
    this.success,
    this.message,
    this.backupFile,
    this.backupLocation,
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  bool? success;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? message;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? backupFile;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? backupLocation;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiDatabaseBackupPost200Response &&
    other.success == success &&
    other.message == message &&
    other.backupFile == backupFile &&
    other.backupLocation == backupLocation;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (success == null ? 0 : success!.hashCode) +
    (message == null ? 0 : message!.hashCode) +
    (backupFile == null ? 0 : backupFile!.hashCode) +
    (backupLocation == null ? 0 : backupLocation!.hashCode);

  @override
  String toString() => 'ApiDatabaseBackupPost200Response[success=$success, message=$message, backupFile=$backupFile, backupLocation=$backupLocation]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.success != null) {
      json[r'success'] = this.success;
    } else {
      json[r'success'] = null;
    }
    if (this.message != null) {
      json[r'message'] = this.message;
    } else {
      json[r'message'] = null;
    }
    if (this.backupFile != null) {
      json[r'backupFile'] = this.backupFile;
    } else {
      json[r'backupFile'] = null;
    }
    if (this.backupLocation != null) {
      json[r'backupLocation'] = this.backupLocation;
    } else {
      json[r'backupLocation'] = null;
    }
    return json;
  }

  /// Returns a new [ApiDatabaseBackupPost200Response] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiDatabaseBackupPost200Response? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiDatabaseBackupPost200Response(
        success: mapValueOfType<bool>(json, r'success'),
        message: mapValueOfType<String>(json, r'message'),
        backupFile: mapValueOfType<String>(json, r'backupFile'),
        backupLocation: mapValueOfType<String>(json, r'backupLocation'),
      );
    }
    return null;
  }

  static List<ApiDatabaseBackupPost200Response> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiDatabaseBackupPost200Response>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiDatabaseBackupPost200Response.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiDatabaseBackupPost200Response> mapFromJson(dynamic json) {
    final map = <String, ApiDatabaseBackupPost200Response>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiDatabaseBackupPost200Response.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiDatabaseBackupPost200Response-objects as value to a dart map
  static Map<String, List<ApiDatabaseBackupPost200Response>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiDatabaseBackupPost200Response>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiDatabaseBackupPost200Response.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

