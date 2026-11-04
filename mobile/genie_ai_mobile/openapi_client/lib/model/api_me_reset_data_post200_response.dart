//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiMeResetDataPost200Response {
  /// Returns a new [ApiMeResetDataPost200Response] instance.
  ApiMeResetDataPost200Response({
    this.success,
    this.message,
    this.userKey,
    this.fieldsPreserved,
    this.filesDeletionFailed,
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
  String? userKey;

  /// Informational count of system-managed fields carried over from the stored document (excludes the updated-at bump).
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? fieldsPreserved;

  /// True when the uploaded files could not be removed after the reset committed — files may remain on disk.
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  bool? filesDeletionFailed;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiMeResetDataPost200Response &&
    other.success == success &&
    other.message == message &&
    other.userKey == userKey &&
    other.fieldsPreserved == fieldsPreserved &&
    other.filesDeletionFailed == filesDeletionFailed;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (success == null ? 0 : success!.hashCode) +
    (message == null ? 0 : message!.hashCode) +
    (userKey == null ? 0 : userKey!.hashCode) +
    (fieldsPreserved == null ? 0 : fieldsPreserved!.hashCode) +
    (filesDeletionFailed == null ? 0 : filesDeletionFailed!.hashCode);

  @override
  String toString() => 'ApiMeResetDataPost200Response[success=$success, message=$message, userKey=$userKey, fieldsPreserved=$fieldsPreserved, filesDeletionFailed=$filesDeletionFailed]';

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
    if (this.userKey != null) {
      json[r'userKey'] = this.userKey;
    } else {
      json[r'userKey'] = null;
    }
    if (this.fieldsPreserved != null) {
      json[r'fieldsPreserved'] = this.fieldsPreserved;
    } else {
      json[r'fieldsPreserved'] = null;
    }
    if (this.filesDeletionFailed != null) {
      json[r'filesDeletionFailed'] = this.filesDeletionFailed;
    } else {
      json[r'filesDeletionFailed'] = null;
    }
    return json;
  }

  /// Returns a new [ApiMeResetDataPost200Response] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiMeResetDataPost200Response? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiMeResetDataPost200Response(
        success: mapValueOfType<bool>(json, r'success'),
        message: mapValueOfType<String>(json, r'message'),
        userKey: mapValueOfType<String>(json, r'userKey'),
        fieldsPreserved: mapValueOfType<int>(json, r'fieldsPreserved'),
        filesDeletionFailed: mapValueOfType<bool>(json, r'filesDeletionFailed'),
      );
    }
    return null;
  }

  static List<ApiMeResetDataPost200Response> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiMeResetDataPost200Response>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiMeResetDataPost200Response.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiMeResetDataPost200Response> mapFromJson(dynamic json) {
    final map = <String, ApiMeResetDataPost200Response>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiMeResetDataPost200Response.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiMeResetDataPost200Response-objects as value to a dart map
  static Map<String, List<ApiMeResetDataPost200Response>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiMeResetDataPost200Response>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiMeResetDataPost200Response.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

