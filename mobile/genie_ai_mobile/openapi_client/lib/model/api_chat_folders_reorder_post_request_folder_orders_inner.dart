//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiChatFoldersReorderPostRequestFolderOrdersInner {
  /// Returns a new [ApiChatFoldersReorderPostRequestFolderOrdersInner] instance.
  ApiChatFoldersReorderPostRequestFolderOrdersInner({
    this.folderId,
    this.order,
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? folderId;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? order;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiChatFoldersReorderPostRequestFolderOrdersInner &&
    other.folderId == folderId &&
    other.order == order;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (folderId == null ? 0 : folderId!.hashCode) +
    (order == null ? 0 : order!.hashCode);

  @override
  String toString() => 'ApiChatFoldersReorderPostRequestFolderOrdersInner[folderId=$folderId, order=$order]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.folderId != null) {
      json[r'folderId'] = this.folderId;
    } else {
      json[r'folderId'] = null;
    }
    if (this.order != null) {
      json[r'order'] = this.order;
    } else {
      json[r'order'] = null;
    }
    return json;
  }

  /// Returns a new [ApiChatFoldersReorderPostRequestFolderOrdersInner] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiChatFoldersReorderPostRequestFolderOrdersInner? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiChatFoldersReorderPostRequestFolderOrdersInner(
        folderId: mapValueOfType<String>(json, r'folderId'),
        order: mapValueOfType<int>(json, r'order'),
      );
    }
    return null;
  }

  static List<ApiChatFoldersReorderPostRequestFolderOrdersInner> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiChatFoldersReorderPostRequestFolderOrdersInner>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiChatFoldersReorderPostRequestFolderOrdersInner.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiChatFoldersReorderPostRequestFolderOrdersInner> mapFromJson(dynamic json) {
    final map = <String, ApiChatFoldersReorderPostRequestFolderOrdersInner>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiChatFoldersReorderPostRequestFolderOrdersInner.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiChatFoldersReorderPostRequestFolderOrdersInner-objects as value to a dart map
  static Map<String, List<ApiChatFoldersReorderPostRequestFolderOrdersInner>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiChatFoldersReorderPostRequestFolderOrdersInner>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiChatFoldersReorderPostRequestFolderOrdersInner.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

