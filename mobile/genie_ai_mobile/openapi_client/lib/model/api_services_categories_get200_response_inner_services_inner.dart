//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiServicesCategoriesGet200ResponseInnerServicesInner {
  /// Returns a new [ApiServicesCategoriesGet200ResponseInnerServicesInner] instance.
  ApiServicesCategoriesGet200ResponseInnerServicesInner({
    this.key,
    this.nameEN,
    this.descriptionEN,
    this.requirements,
    this.process,
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? key;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? nameEN;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? descriptionEN;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? requirements;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? process;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiServicesCategoriesGet200ResponseInnerServicesInner &&
    other.key == key &&
    other.nameEN == nameEN &&
    other.descriptionEN == descriptionEN &&
    other.requirements == requirements &&
    other.process == process;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (key == null ? 0 : key!.hashCode) +
    (nameEN == null ? 0 : nameEN!.hashCode) +
    (descriptionEN == null ? 0 : descriptionEN!.hashCode) +
    (requirements == null ? 0 : requirements!.hashCode) +
    (process == null ? 0 : process!.hashCode);

  @override
  String toString() => 'ApiServicesCategoriesGet200ResponseInnerServicesInner[key=$key, nameEN=$nameEN, descriptionEN=$descriptionEN, requirements=$requirements, process=$process]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.key != null) {
      json[r'_key'] = this.key;
    } else {
      json[r'_key'] = null;
    }
    if (this.nameEN != null) {
      json[r'nameEN'] = this.nameEN;
    } else {
      json[r'nameEN'] = null;
    }
    if (this.descriptionEN != null) {
      json[r'descriptionEN'] = this.descriptionEN;
    } else {
      json[r'descriptionEN'] = null;
    }
    if (this.requirements != null) {
      json[r'requirements'] = this.requirements;
    } else {
      json[r'requirements'] = null;
    }
    if (this.process != null) {
      json[r'process'] = this.process;
    } else {
      json[r'process'] = null;
    }
    return json;
  }

  /// Returns a new [ApiServicesCategoriesGet200ResponseInnerServicesInner] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiServicesCategoriesGet200ResponseInnerServicesInner? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiServicesCategoriesGet200ResponseInnerServicesInner(
        key: mapValueOfType<String>(json, r'_key'),
        nameEN: mapValueOfType<String>(json, r'nameEN'),
        descriptionEN: mapValueOfType<String>(json, r'descriptionEN'),
        requirements: mapValueOfType<String>(json, r'requirements'),
        process: mapValueOfType<String>(json, r'process'),
      );
    }
    return null;
  }

  static List<ApiServicesCategoriesGet200ResponseInnerServicesInner> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiServicesCategoriesGet200ResponseInnerServicesInner>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiServicesCategoriesGet200ResponseInnerServicesInner.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiServicesCategoriesGet200ResponseInnerServicesInner> mapFromJson(dynamic json) {
    final map = <String, ApiServicesCategoriesGet200ResponseInnerServicesInner>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiServicesCategoriesGet200ResponseInnerServicesInner.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiServicesCategoriesGet200ResponseInnerServicesInner-objects as value to a dart map
  static Map<String, List<ApiServicesCategoriesGet200ResponseInnerServicesInner>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiServicesCategoriesGet200ResponseInnerServicesInner>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiServicesCategoriesGet200ResponseInnerServicesInner.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

