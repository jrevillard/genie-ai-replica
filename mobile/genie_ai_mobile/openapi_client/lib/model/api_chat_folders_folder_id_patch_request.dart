//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiChatFoldersFolderIdPatchRequest {
  /// Returns a new [ApiChatFoldersFolderIdPatchRequest] instance.
  ApiChatFoldersFolderIdPatchRequest({
    this.name,
    this.description,
    this.isArchived,
    this.color,
    this.icon,
    this.parentFolderId,
  });

  /// New name for the folder
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? name;

  /// New description for the folder
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? description;

  /// Archive status
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  bool? isArchived;

  /// Color for the folder
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? color;

  /// Icon for the folder
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? icon;

  /// ID of parent folder (null for root)
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? parentFolderId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiChatFoldersFolderIdPatchRequest &&
    other.name == name &&
    other.description == description &&
    other.isArchived == isArchived &&
    other.color == color &&
    other.icon == icon &&
    other.parentFolderId == parentFolderId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (name == null ? 0 : name!.hashCode) +
    (description == null ? 0 : description!.hashCode) +
    (isArchived == null ? 0 : isArchived!.hashCode) +
    (color == null ? 0 : color!.hashCode) +
    (icon == null ? 0 : icon!.hashCode) +
    (parentFolderId == null ? 0 : parentFolderId!.hashCode);

  @override
  String toString() => 'ApiChatFoldersFolderIdPatchRequest[name=$name, description=$description, isArchived=$isArchived, color=$color, icon=$icon, parentFolderId=$parentFolderId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
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
    return json;
  }

  /// Returns a new [ApiChatFoldersFolderIdPatchRequest] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiChatFoldersFolderIdPatchRequest? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiChatFoldersFolderIdPatchRequest(
        name: mapValueOfType<String>(json, r'name'),
        description: mapValueOfType<String>(json, r'description'),
        isArchived: mapValueOfType<bool>(json, r'isArchived'),
        color: mapValueOfType<String>(json, r'color'),
        icon: mapValueOfType<String>(json, r'icon'),
        parentFolderId: mapValueOfType<String>(json, r'parentFolderId'),
      );
    }
    return null;
  }

  static List<ApiChatFoldersFolderIdPatchRequest> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiChatFoldersFolderIdPatchRequest>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiChatFoldersFolderIdPatchRequest.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiChatFoldersFolderIdPatchRequest> mapFromJson(dynamic json) {
    final map = <String, ApiChatFoldersFolderIdPatchRequest>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiChatFoldersFolderIdPatchRequest.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiChatFoldersFolderIdPatchRequest-objects as value to a dart map
  static Map<String, List<ApiChatFoldersFolderIdPatchRequest>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiChatFoldersFolderIdPatchRequest>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiChatFoldersFolderIdPatchRequest.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

