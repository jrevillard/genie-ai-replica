//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiServiceCategoriesCategoriesGet200ResponseInner {
  /// Returns a new [ApiServiceCategoriesCategoriesGet200ResponseInner] instance.
  ApiServiceCategoriesCategoriesGet200ResponseInner({
    this.catKey,
    this.name,
    this.children = const [],
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? catKey;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? name;

  List<String> children;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiServiceCategoriesCategoriesGet200ResponseInner &&
    other.catKey == catKey &&
    other.name == name &&
    _deepEquality.equals(other.children, children);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (catKey == null ? 0 : catKey!.hashCode) +
    (name == null ? 0 : name!.hashCode) +
    (children.hashCode);

  @override
  String toString() => 'ApiServiceCategoriesCategoriesGet200ResponseInner[catKey=$catKey, name=$name, children=$children]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.catKey != null) {
      json[r'catKey'] = this.catKey;
    } else {
      json[r'catKey'] = null;
    }
    if (this.name != null) {
      json[r'name'] = this.name;
    } else {
      json[r'name'] = null;
    }
      json[r'children'] = this.children;
    return json;
  }

  /// Returns a new [ApiServiceCategoriesCategoriesGet200ResponseInner] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiServiceCategoriesCategoriesGet200ResponseInner? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiServiceCategoriesCategoriesGet200ResponseInner(
        catKey: mapValueOfType<String>(json, r'catKey'),
        name: mapValueOfType<String>(json, r'name'),
        children: json[r'children'] is Iterable
            ? (json[r'children'] as Iterable).cast<String>().toList(growable: false)
            : const [],
      );
    }
    return null;
  }

  static List<ApiServiceCategoriesCategoriesGet200ResponseInner> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiServiceCategoriesCategoriesGet200ResponseInner>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiServiceCategoriesCategoriesGet200ResponseInner.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiServiceCategoriesCategoriesGet200ResponseInner> mapFromJson(dynamic json) {
    final map = <String, ApiServiceCategoriesCategoriesGet200ResponseInner>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiServiceCategoriesCategoriesGet200ResponseInner.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiServiceCategoriesCategoriesGet200ResponseInner-objects as value to a dart map
  static Map<String, List<ApiServiceCategoriesCategoriesGet200ResponseInner>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiServiceCategoriesCategoriesGet200ResponseInner>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiServiceCategoriesCategoriesGet200ResponseInner.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

