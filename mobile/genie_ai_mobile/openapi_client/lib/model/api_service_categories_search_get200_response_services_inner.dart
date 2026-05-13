//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiServiceCategoriesSearchGet200ResponseServicesInner {
  /// Returns a new [ApiServiceCategoriesSearchGet200ResponseServicesInner] instance.
  ApiServiceCategoriesSearchGet200ResponseServicesInner({
    this.type,
    this.key,
    this.name,
    this.categoryKey,
    this.categoryName,
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
  String? key;

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
  String? categoryKey;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? categoryName;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiServiceCategoriesSearchGet200ResponseServicesInner &&
    other.type == type &&
    other.key == key &&
    other.name == name &&
    other.categoryKey == categoryKey &&
    other.categoryName == categoryName;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (type == null ? 0 : type!.hashCode) +
    (key == null ? 0 : key!.hashCode) +
    (name == null ? 0 : name!.hashCode) +
    (categoryKey == null ? 0 : categoryKey!.hashCode) +
    (categoryName == null ? 0 : categoryName!.hashCode);

  @override
  String toString() => 'ApiServiceCategoriesSearchGet200ResponseServicesInner[type=$type, key=$key, name=$name, categoryKey=$categoryKey, categoryName=$categoryName]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.type != null) {
      json[r'type'] = this.type;
    } else {
      json[r'type'] = null;
    }
    if (this.key != null) {
      json[r'key'] = this.key;
    } else {
      json[r'key'] = null;
    }
    if (this.name != null) {
      json[r'name'] = this.name;
    } else {
      json[r'name'] = null;
    }
    if (this.categoryKey != null) {
      json[r'categoryKey'] = this.categoryKey;
    } else {
      json[r'categoryKey'] = null;
    }
    if (this.categoryName != null) {
      json[r'categoryName'] = this.categoryName;
    } else {
      json[r'categoryName'] = null;
    }
    return json;
  }

  /// Returns a new [ApiServiceCategoriesSearchGet200ResponseServicesInner] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiServiceCategoriesSearchGet200ResponseServicesInner? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiServiceCategoriesSearchGet200ResponseServicesInner(
        type: mapValueOfType<String>(json, r'type'),
        key: mapValueOfType<String>(json, r'key'),
        name: mapValueOfType<String>(json, r'name'),
        categoryKey: mapValueOfType<String>(json, r'categoryKey'),
        categoryName: mapValueOfType<String>(json, r'categoryName'),
      );
    }
    return null;
  }

  static List<ApiServiceCategoriesSearchGet200ResponseServicesInner> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiServiceCategoriesSearchGet200ResponseServicesInner>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiServiceCategoriesSearchGet200ResponseServicesInner.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiServiceCategoriesSearchGet200ResponseServicesInner> mapFromJson(dynamic json) {
    final map = <String, ApiServiceCategoriesSearchGet200ResponseServicesInner>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiServiceCategoriesSearchGet200ResponseServicesInner.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiServiceCategoriesSearchGet200ResponseServicesInner-objects as value to a dart map
  static Map<String, List<ApiServiceCategoriesSearchGet200ResponseServicesInner>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiServiceCategoriesSearchGet200ResponseServicesInner>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiServiceCategoriesSearchGet200ResponseServicesInner.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

