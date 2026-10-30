//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SessionDeviceInfo {
  /// Returns a new [SessionDeviceInfo] instance.
  SessionDeviceInfo({
    this.type,
    this.browser,
    this.os,
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? type;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? browser;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? os;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SessionDeviceInfo &&
    other.type == type &&
    other.browser == browser &&
    other.os == os;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (type == null ? 0 : type!.hashCode) +
    (browser == null ? 0 : browser!.hashCode) +
    (os == null ? 0 : os!.hashCode);

  @override
  String toString() => 'SessionDeviceInfo[type=$type, browser=$browser, os=$os]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.type != null) {
      json[r'type'] = this.type;
    } else {
      json[r'type'] = null;
    }
    if (this.browser != null) {
      json[r'browser'] = this.browser;
    } else {
      json[r'browser'] = null;
    }
    if (this.os != null) {
      json[r'os'] = this.os;
    } else {
      json[r'os'] = null;
    }
    return json;
  }

  /// Returns a new [SessionDeviceInfo] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SessionDeviceInfo? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return SessionDeviceInfo(
        type: mapValueOfType<String>(json, r'type'),
        browser: mapValueOfType<String>(json, r'browser'),
        os: mapValueOfType<String>(json, r'os'),
      );
    }
    return null;
  }

  static List<SessionDeviceInfo> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SessionDeviceInfo>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SessionDeviceInfo.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SessionDeviceInfo> mapFromJson(dynamic json) {
    final map = <String, SessionDeviceInfo>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SessionDeviceInfo.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SessionDeviceInfo-objects as value to a dart map
  static Map<String, List<SessionDeviceInfo>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SessionDeviceInfo>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SessionDeviceInfo.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

