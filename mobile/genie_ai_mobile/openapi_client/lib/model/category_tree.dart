//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class CategoryTree {
  /// Returns a new [CategoryTree] instance.
  CategoryTree({
    this.catKey,
    this.catCode,
    this.name,
    this.nameEN,
    this.children = const [],
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? catKey;

  String? catCode;

  /// The name the UI displays: the localized translation, or — on the PUBLIC tree — the ENGLISH one when the active locale has no translation.
  String? name;

  /// The ENGLISH name — the SSOT every filter label is spoken in. Clients put THIS value on the query wire; the localized `name` is display-only. It is the English translation row, or the entity document's own `nameEN` for an entity with no English translation row.
  String? nameEN;

  /// The category's services, display + wire spellings.
  List<CategoryTreeChildrenInner> children;

  @override
  bool operator ==(Object other) => identical(this, other) || other is CategoryTree &&
    other.catKey == catKey &&
    other.catCode == catCode &&
    other.name == name &&
    other.nameEN == nameEN &&
    _deepEquality.equals(other.children, children);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (catKey == null ? 0 : catKey!.hashCode) +
    (catCode == null ? 0 : catCode!.hashCode) +
    (name == null ? 0 : name!.hashCode) +
    (nameEN == null ? 0 : nameEN!.hashCode) +
    (children.hashCode);

  @override
  String toString() => 'CategoryTree[catKey=$catKey, catCode=$catCode, name=$name, nameEN=$nameEN, children=$children]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.catKey != null) {
      json[r'catKey'] = this.catKey;
    } else {
      json[r'catKey'] = null;
    }
    if (this.catCode != null) {
      json[r'catCode'] = this.catCode;
    } else {
      json[r'catCode'] = null;
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
      json[r'children'] = this.children;
    return json;
  }

  /// Returns a new [CategoryTree] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static CategoryTree? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return CategoryTree(
        catKey: mapValueOfType<String>(json, r'catKey'),
        catCode: mapValueOfType<String>(json, r'catCode'),
        name: mapValueOfType<String>(json, r'name'),
        nameEN: mapValueOfType<String>(json, r'nameEN'),
        children: CategoryTreeChildrenInner.listFromJson(json[r'children']),
      );
    }
    return null;
  }

  static List<CategoryTree> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <CategoryTree>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = CategoryTree.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, CategoryTree> mapFromJson(dynamic json) {
    final map = <String, CategoryTree>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = CategoryTree.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of CategoryTree-objects as value to a dart map
  static Map<String, List<CategoryTree>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<CategoryTree>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = CategoryTree.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

