//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiChatFoldersReorderPostRequest {
  /// Returns a new [ApiChatFoldersReorderPostRequest] instance.
  ApiChatFoldersReorderPostRequest({
    this.folderOrders = const [],
    this.parentFolderId,
  });

  List<ApiChatFoldersReorderPostRequestFolderOrdersInner> folderOrders;

  /// Parent folder ID (null for root folders)
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? parentFolderId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiChatFoldersReorderPostRequest &&
    _deepEquality.equals(other.folderOrders, folderOrders) &&
    other.parentFolderId == parentFolderId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (folderOrders.hashCode) +
    (parentFolderId == null ? 0 : parentFolderId!.hashCode);

  @override
  String toString() => 'ApiChatFoldersReorderPostRequest[folderOrders=$folderOrders, parentFolderId=$parentFolderId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'folderOrders'] = this.folderOrders;
    if (this.parentFolderId != null) {
      json[r'parentFolderId'] = this.parentFolderId;
    } else {
      json[r'parentFolderId'] = null;
    }
    return json;
  }

  /// Returns a new [ApiChatFoldersReorderPostRequest] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiChatFoldersReorderPostRequest? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        assert(json.containsKey(r'folderOrders'), 'Required key "ApiChatFoldersReorderPostRequest[folderOrders]" is missing from JSON.');
        assert(json[r'folderOrders'] != null, 'Required key "ApiChatFoldersReorderPostRequest[folderOrders]" has a null value in JSON.');
        return true;
      }());

      return ApiChatFoldersReorderPostRequest(
        folderOrders: ApiChatFoldersReorderPostRequestFolderOrdersInner.listFromJson(json[r'folderOrders']),
        parentFolderId: mapValueOfType<String>(json, r'parentFolderId'),
      );
    }
    return null;
  }

  static List<ApiChatFoldersReorderPostRequest> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiChatFoldersReorderPostRequest>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiChatFoldersReorderPostRequest.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiChatFoldersReorderPostRequest> mapFromJson(dynamic json) {
    final map = <String, ApiChatFoldersReorderPostRequest>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiChatFoldersReorderPostRequest.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiChatFoldersReorderPostRequest-objects as value to a dart map
  static Map<String, List<ApiChatFoldersReorderPostRequest>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiChatFoldersReorderPostRequest>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiChatFoldersReorderPostRequest.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'folderOrders',
  };
}

