//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiServiceCategoriesInitPost200Response {
  /// Returns a new [ApiServiceCategoriesInitPost200Response] instance.
  ApiServiceCategoriesInitPost200Response({
    this.message,
    this.categoriesCreated,
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? message;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? categoriesCreated;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiServiceCategoriesInitPost200Response &&
    other.message == message &&
    other.categoriesCreated == categoriesCreated;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (message == null ? 0 : message!.hashCode) +
    (categoriesCreated == null ? 0 : categoriesCreated!.hashCode);

  @override
  String toString() => 'ApiServiceCategoriesInitPost200Response[message=$message, categoriesCreated=$categoriesCreated]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.message != null) {
      json[r'message'] = this.message;
    } else {
      json[r'message'] = null;
    }
    if (this.categoriesCreated != null) {
      json[r'categoriesCreated'] = this.categoriesCreated;
    } else {
      json[r'categoriesCreated'] = null;
    }
    return json;
  }

  /// Returns a new [ApiServiceCategoriesInitPost200Response] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiServiceCategoriesInitPost200Response? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiServiceCategoriesInitPost200Response(
        message: mapValueOfType<String>(json, r'message'),
        categoriesCreated: mapValueOfType<int>(json, r'categoriesCreated'),
      );
    }
    return null;
  }

  static List<ApiServiceCategoriesInitPost200Response> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiServiceCategoriesInitPost200Response>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiServiceCategoriesInitPost200Response.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiServiceCategoriesInitPost200Response> mapFromJson(dynamic json) {
    final map = <String, ApiServiceCategoriesInitPost200Response>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiServiceCategoriesInitPost200Response.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiServiceCategoriesInitPost200Response-objects as value to a dart map
  static Map<String, List<ApiServiceCategoriesInitPost200Response>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiServiceCategoriesInitPost200Response>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiServiceCategoriesInitPost200Response.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

