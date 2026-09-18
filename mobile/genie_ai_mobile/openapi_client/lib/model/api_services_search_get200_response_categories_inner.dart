//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiServicesSearchGet200ResponseCategoriesInner {
  /// Returns a new [ApiServicesSearchGet200ResponseCategoriesInner] instance.
  ApiServicesSearchGet200ResponseCategoriesInner({
    this.key,
    this.nameEN,
    this.descriptionEN,
    this.relevance,
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
  num? relevance;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiServicesSearchGet200ResponseCategoriesInner &&
    other.key == key &&
    other.nameEN == nameEN &&
    other.descriptionEN == descriptionEN &&
    other.relevance == relevance;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (key == null ? 0 : key!.hashCode) +
    (nameEN == null ? 0 : nameEN!.hashCode) +
    (descriptionEN == null ? 0 : descriptionEN!.hashCode) +
    (relevance == null ? 0 : relevance!.hashCode);

  @override
  String toString() => 'ApiServicesSearchGet200ResponseCategoriesInner[key=$key, nameEN=$nameEN, descriptionEN=$descriptionEN, relevance=$relevance]';

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
    if (this.relevance != null) {
      json[r'relevance'] = this.relevance;
    } else {
      json[r'relevance'] = null;
    }
    return json;
  }

  /// Returns a new [ApiServicesSearchGet200ResponseCategoriesInner] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiServicesSearchGet200ResponseCategoriesInner? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiServicesSearchGet200ResponseCategoriesInner(
        key: mapValueOfType<String>(json, r'_key'),
        nameEN: mapValueOfType<String>(json, r'nameEN'),
        descriptionEN: mapValueOfType<String>(json, r'descriptionEN'),
        relevance: num.parse('${json[r'relevance']}'),
      );
    }
    return null;
  }

  static List<ApiServicesSearchGet200ResponseCategoriesInner> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiServicesSearchGet200ResponseCategoriesInner>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiServicesSearchGet200ResponseCategoriesInner.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiServicesSearchGet200ResponseCategoriesInner> mapFromJson(dynamic json) {
    final map = <String, ApiServicesSearchGet200ResponseCategoriesInner>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiServicesSearchGet200ResponseCategoriesInner.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiServicesSearchGet200ResponseCategoriesInner-objects as value to a dart map
  static Map<String, List<ApiServicesSearchGet200ResponseCategoriesInner>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiServicesSearchGet200ResponseCategoriesInner>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiServicesSearchGet200ResponseCategoriesInner.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

