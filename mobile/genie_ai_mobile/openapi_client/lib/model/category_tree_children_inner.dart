//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class CategoryTreeChildrenInner {
  /// Returns a new [CategoryTreeChildrenInner] instance.
  CategoryTreeChildrenInner({
    this.key,
    this.name,
    this.nameEN,
  });

  /// The service entity's stable key. Neither spelling of the name is unique inside a category, so identity that survives renames and locale switches keys on this.
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? key;

  /// Display name: the localized translation, or — on the PUBLIC tree — the ENGLISH one when the active locale has no translation.
  String? name;

  /// The ENGLISH name, the filter wire (SSOT): the English translation row, or the entity document's own `nameEN` for an entity with no English translation row.
  String? nameEN;

  @override
  bool operator ==(Object other) => identical(this, other) || other is CategoryTreeChildrenInner &&
    other.key == key &&
    other.name == name &&
    other.nameEN == nameEN;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (key == null ? 0 : key!.hashCode) +
    (name == null ? 0 : name!.hashCode) +
    (nameEN == null ? 0 : nameEN!.hashCode);

  @override
  String toString() => 'CategoryTreeChildrenInner[key=$key, name=$name, nameEN=$nameEN]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.key != null) {
      json[r'_key'] = this.key;
    } else {
      json[r'_key'] = null;
    }
    if (this.name != null) {
      json[r'name'] = this.name;
    } else {
      json[r'name'] = null;
    }
    if (this.nameEN != null) {
      json[r'nameEN'] = this.nameEN;
    } else {
      json[r'nameEN'] = null;
    }
    return json;
  }

  /// Returns a new [CategoryTreeChildrenInner] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static CategoryTreeChildrenInner? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return CategoryTreeChildrenInner(
        key: mapValueOfType<String>(json, r'_key'),
        name: mapValueOfType<String>(json, r'name'),
        nameEN: mapValueOfType<String>(json, r'nameEN'),
      );
    }
    return null;
  }

  static List<CategoryTreeChildrenInner> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <CategoryTreeChildrenInner>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = CategoryTreeChildrenInner.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, CategoryTreeChildrenInner> mapFromJson(dynamic json) {
    final map = <String, CategoryTreeChildrenInner>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = CategoryTreeChildrenInner.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of CategoryTreeChildrenInner-objects as value to a dart map
  static Map<String, List<CategoryTreeChildrenInner>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<CategoryTreeChildrenInner>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = CategoryTreeChildrenInner.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

