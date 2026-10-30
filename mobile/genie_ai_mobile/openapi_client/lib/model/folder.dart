//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class Folder {
  /// Returns a new [Folder] instance.
  Folder({
    this.key,
    this.name,
    this.description,
    this.created,
    this.updated,
    this.isArchived,
    this.color,
    this.icon,
    this.parentFolderId,
    this.order,
  });

  /// Unique identifier
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? key;

  /// Folder name
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? name;

  /// Folder description
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? description;

  /// Creation timestamp
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  DateTime? created;

  /// Last update timestamp
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  DateTime? updated;

  /// Whether the folder is archived
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  bool? isArchived;

  /// Color code for the folder
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? color;

  /// Icon identifier for the folder
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? icon;

  /// Parent folder ID (null for root folders)
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? parentFolderId;

  /// Display order within parent
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? order;

  @override
  bool operator ==(Object other) => identical(this, other) || other is Folder &&
    other.key == key &&
    other.name == name &&
    other.description == description &&
    other.created == created &&
    other.updated == updated &&
    other.isArchived == isArchived &&
    other.color == color &&
    other.icon == icon &&
    other.parentFolderId == parentFolderId &&
    other.order == order;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (key == null ? 0 : key!.hashCode) +
    (name == null ? 0 : name!.hashCode) +
    (description == null ? 0 : description!.hashCode) +
    (created == null ? 0 : created!.hashCode) +
    (updated == null ? 0 : updated!.hashCode) +
    (isArchived == null ? 0 : isArchived!.hashCode) +
    (color == null ? 0 : color!.hashCode) +
    (icon == null ? 0 : icon!.hashCode) +
    (parentFolderId == null ? 0 : parentFolderId!.hashCode) +
    (order == null ? 0 : order!.hashCode);

  @override
  String toString() => 'Folder[key=$key, name=$name, description=$description, created=$created, updated=$updated, isArchived=$isArchived, color=$color, icon=$icon, parentFolderId=$parentFolderId, order=$order]';

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
    if (this.description != null) {
      json[r'description'] = this.description;
    } else {
      json[r'description'] = null;
    }
    if (this.created != null) {
      json[r'created'] = this.created!.toUtc().toIso8601String();
    } else {
      json[r'created'] = null;
    }
    if (this.updated != null) {
      json[r'updated'] = this.updated!.toUtc().toIso8601String();
    } else {
      json[r'updated'] = null;
    }
    if (this.isArchived != null) {
      json[r'isArchived'] = this.isArchived;
    } else {
      json[r'isArchived'] = null;
    }
    if (this.color != null) {
      json[r'color'] = this.color;
    } else {
      json[r'color'] = null;
    }
    if (this.icon != null) {
      json[r'icon'] = this.icon;
    } else {
      json[r'icon'] = null;
    }
    if (this.parentFolderId != null) {
      json[r'parentFolderId'] = this.parentFolderId;
    } else {
      json[r'parentFolderId'] = null;
    }
    if (this.order != null) {
      json[r'order'] = this.order;
    } else {
      json[r'order'] = null;
    }
    return json;
  }

  /// Returns a new [Folder] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static Folder? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return Folder(
        key: mapValueOfType<String>(json, r'_key'),
        name: mapValueOfType<String>(json, r'name'),
        description: mapValueOfType<String>(json, r'description'),
        created: mapDateTime(json, r'created', r''),
        updated: mapDateTime(json, r'updated', r''),
        isArchived: mapValueOfType<bool>(json, r'isArchived'),
        color: mapValueOfType<String>(json, r'color'),
        icon: mapValueOfType<String>(json, r'icon'),
        parentFolderId: mapValueOfType<String>(json, r'parentFolderId'),
        order: mapValueOfType<int>(json, r'order'),
      );
    }
    return null;
  }

  static List<Folder> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <Folder>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = Folder.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, Folder> mapFromJson(dynamic json) {
    final map = <String, Folder>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = Folder.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of Folder-objects as value to a dart map
  static Map<String, List<Folder>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<Folder>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = Folder.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

