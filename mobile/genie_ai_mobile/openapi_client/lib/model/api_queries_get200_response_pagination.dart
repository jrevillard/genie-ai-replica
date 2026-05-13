//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiQueriesGet200ResponsePagination {
  /// Returns a new [ApiQueriesGet200ResponsePagination] instance.
  ApiQueriesGet200ResponsePagination({
    this.total,
    this.limit,
    this.offset,
    this.pages,
    this.currentPage,
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? total;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? limit;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? offset;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? pages;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? currentPage;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiQueriesGet200ResponsePagination &&
    other.total == total &&
    other.limit == limit &&
    other.offset == offset &&
    other.pages == pages &&
    other.currentPage == currentPage;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (total == null ? 0 : total!.hashCode) +
    (limit == null ? 0 : limit!.hashCode) +
    (offset == null ? 0 : offset!.hashCode) +
    (pages == null ? 0 : pages!.hashCode) +
    (currentPage == null ? 0 : currentPage!.hashCode);

  @override
  String toString() => 'ApiQueriesGet200ResponsePagination[total=$total, limit=$limit, offset=$offset, pages=$pages, currentPage=$currentPage]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.total != null) {
      json[r'total'] = this.total;
    } else {
      json[r'total'] = null;
    }
    if (this.limit != null) {
      json[r'limit'] = this.limit;
    } else {
      json[r'limit'] = null;
    }
    if (this.offset != null) {
      json[r'offset'] = this.offset;
    } else {
      json[r'offset'] = null;
    }
    if (this.pages != null) {
      json[r'pages'] = this.pages;
    } else {
      json[r'pages'] = null;
    }
    if (this.currentPage != null) {
      json[r'currentPage'] = this.currentPage;
    } else {
      json[r'currentPage'] = null;
    }
    return json;
  }

  /// Returns a new [ApiQueriesGet200ResponsePagination] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiQueriesGet200ResponsePagination? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiQueriesGet200ResponsePagination(
        total: mapValueOfType<int>(json, r'total'),
        limit: mapValueOfType<int>(json, r'limit'),
        offset: mapValueOfType<int>(json, r'offset'),
        pages: mapValueOfType<int>(json, r'pages'),
        currentPage: mapValueOfType<int>(json, r'currentPage'),
      );
    }
    return null;
  }

  static List<ApiQueriesGet200ResponsePagination> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiQueriesGet200ResponsePagination>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiQueriesGet200ResponsePagination.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiQueriesGet200ResponsePagination> mapFromJson(dynamic json) {
    final map = <String, ApiQueriesGet200ResponsePagination>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiQueriesGet200ResponsePagination.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiQueriesGet200ResponsePagination-objects as value to a dart map
  static Map<String, List<ApiQueriesGet200ResponsePagination>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiQueriesGet200ResponsePagination>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiQueriesGet200ResponsePagination.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

