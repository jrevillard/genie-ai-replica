//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiAdminLogsDebugYesterdayGet200ResponseLogsInner {
  /// Returns a new [ApiAdminLogsDebugYesterdayGet200ResponseLogsInner] instance.
  ApiAdminLogsDebugYesterdayGet200ResponseLogsInner({
    this.date,
    this.time,
    this.level,
    this.service,
    this.message,
  });

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
  String? time;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? level;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? service;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? message;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiAdminLogsDebugYesterdayGet200ResponseLogsInner &&
    other.date == date &&
    other.time == time &&
    other.level == level &&
    other.service == service &&
    other.message == message;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (date == null ? 0 : date!.hashCode) +
    (time == null ? 0 : time!.hashCode) +
    (level == null ? 0 : level!.hashCode) +
    (service == null ? 0 : service!.hashCode) +
    (message == null ? 0 : message!.hashCode);

  @override
  String toString() => 'ApiAdminLogsDebugYesterdayGet200ResponseLogsInner[date=$date, time=$time, level=$level, service=$service, message=$message]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.date != null) {
      json[r'date'] = this.date;
    } else {
      json[r'date'] = null;
    }
    if (this.time != null) {
      json[r'time'] = this.time;
    } else {
      json[r'time'] = null;
    }
    if (this.level != null) {
      json[r'level'] = this.level;
    } else {
      json[r'level'] = null;
    }
    if (this.service != null) {
      json[r'service'] = this.service;
    } else {
      json[r'service'] = null;
    }
    if (this.message != null) {
      json[r'message'] = this.message;
    } else {
      json[r'message'] = null;
    }
    return json;
  }

  /// Returns a new [ApiAdminLogsDebugYesterdayGet200ResponseLogsInner] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiAdminLogsDebugYesterdayGet200ResponseLogsInner? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiAdminLogsDebugYesterdayGet200ResponseLogsInner(
        date: mapValueOfType<String>(json, r'date'),
        time: mapValueOfType<String>(json, r'time'),
        level: mapValueOfType<String>(json, r'level'),
        service: mapValueOfType<String>(json, r'service'),
        message: mapValueOfType<String>(json, r'message'),
      );
    }
    return null;
  }

  static List<ApiAdminLogsDebugYesterdayGet200ResponseLogsInner> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiAdminLogsDebugYesterdayGet200ResponseLogsInner>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiAdminLogsDebugYesterdayGet200ResponseLogsInner.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiAdminLogsDebugYesterdayGet200ResponseLogsInner> mapFromJson(dynamic json) {
    final map = <String, ApiAdminLogsDebugYesterdayGet200ResponseLogsInner>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiAdminLogsDebugYesterdayGet200ResponseLogsInner.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiAdminLogsDebugYesterdayGet200ResponseLogsInner-objects as value to a dart map
  static Map<String, List<ApiAdminLogsDebugYesterdayGet200ResponseLogsInner>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiAdminLogsDebugYesterdayGet200ResponseLogsInner>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiAdminLogsDebugYesterdayGet200ResponseLogsInner.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

