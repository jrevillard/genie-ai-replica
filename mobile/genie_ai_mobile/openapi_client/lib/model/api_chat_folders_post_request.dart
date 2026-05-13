//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiChatFoldersPostRequest {
  /// Returns a new [ApiChatFoldersPostRequest] instance.
  ApiChatFoldersPostRequest({
    required this.name,
    this.description,
    this.parentFolderId,
    this.color,
    this.icon,
  });

  /// Name of the folder
  String name;

  /// Optional description of the folder
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? description;

  /// Optional ID of parent folder
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? parentFolderId;

  /// Optional color for the folder
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? color;

  /// Optional icon for the folder
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? icon;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiChatFoldersPostRequest &&
    other.name == name &&
    other.description == description &&
    other.parentFolderId == parentFolderId &&
    other.color == color &&
    other.icon == icon;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (name.hashCode) +
    (description == null ? 0 : description!.hashCode) +
    (parentFolderId == null ? 0 : parentFolderId!.hashCode) +
    (color == null ? 0 : color!.hashCode) +
    (icon == null ? 0 : icon!.hashCode);

  @override
  String toString() => 'ApiChatFoldersPostRequest[name=$name, description=$description, parentFolderId=$parentFolderId, color=$color, icon=$icon]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'name'] = this.name;
    if (this.description != null) {
      json[r'description'] = this.description;
    } else {
      json[r'description'] = null;
    }
    if (this.parentFolderId != null) {
      json[r'parentFolderId'] = this.parentFolderId;
    } else {
      json[r'parentFolderId'] = null;
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
    return json;
  }

  /// Returns a new [ApiChatFoldersPostRequest] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiChatFoldersPostRequest? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        assert(json.containsKey(r'name'), 'Required key "ApiChatFoldersPostRequest[name]" is missing from JSON.');
        assert(json[r'name'] != null, 'Required key "ApiChatFoldersPostRequest[name]" has a null value in JSON.');
        return true;
      }());

      return ApiChatFoldersPostRequest(
        name: mapValueOfType<String>(json, r'name')!,
        description: mapValueOfType<String>(json, r'description'),
        parentFolderId: mapValueOfType<String>(json, r'parentFolderId'),
        color: mapValueOfType<String>(json, r'color'),
        icon: mapValueOfType<String>(json, r'icon'),
      );
    }
    return null;
  }

  static List<ApiChatFoldersPostRequest> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiChatFoldersPostRequest>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiChatFoldersPostRequest.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiChatFoldersPostRequest> mapFromJson(dynamic json) {
    final map = <String, ApiChatFoldersPostRequest>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiChatFoldersPostRequest.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiChatFoldersPostRequest-objects as value to a dart map
  static Map<String, List<ApiChatFoldersPostRequest>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiChatFoldersPostRequest>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiChatFoldersPostRequest.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'name',
  };
}

