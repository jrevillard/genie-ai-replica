//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiAnalyticsDashboardGet200Response {
  /// Returns a new [ApiAnalyticsDashboardGet200Response] instance.
  ApiAnalyticsDashboardGet200Response({
    this.queries,
    this.categories = const [],
    this.feedback,
    this.users,
    this.topQueries = const [],
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  ApiAnalyticsDashboardGet200ResponseQueries? queries;

  List<ApiAnalyticsDashboardGet200ResponseCategoriesInner> categories;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  ApiAnalyticsDashboardGet200ResponseFeedback? feedback;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  ApiAnalyticsDashboardGet200ResponseUsers? users;

  List<ApiAnalyticsDashboardGet200ResponseTopQueriesInner> topQueries;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiAnalyticsDashboardGet200Response &&
    other.queries == queries &&
    _deepEquality.equals(other.categories, categories) &&
    other.feedback == feedback &&
    other.users == users &&
    _deepEquality.equals(other.topQueries, topQueries);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (queries == null ? 0 : queries!.hashCode) +
    (categories.hashCode) +
    (feedback == null ? 0 : feedback!.hashCode) +
    (users == null ? 0 : users!.hashCode) +
    (topQueries.hashCode);

  @override
  String toString() => 'ApiAnalyticsDashboardGet200Response[queries=$queries, categories=$categories, feedback=$feedback, users=$users, topQueries=$topQueries]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.queries != null) {
      json[r'queries'] = this.queries;
    } else {
      json[r'queries'] = null;
    }
      json[r'categories'] = this.categories;
    if (this.feedback != null) {
      json[r'feedback'] = this.feedback;
    } else {
      json[r'feedback'] = null;
    }
    if (this.users != null) {
      json[r'users'] = this.users;
    } else {
      json[r'users'] = null;
    }
      json[r'topQueries'] = this.topQueries;
    return json;
  }

  /// Returns a new [ApiAnalyticsDashboardGet200Response] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiAnalyticsDashboardGet200Response? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiAnalyticsDashboardGet200Response(
        queries: ApiAnalyticsDashboardGet200ResponseQueries.fromJson(json[r'queries']),
        categories: ApiAnalyticsDashboardGet200ResponseCategoriesInner.listFromJson(json[r'categories']),
        feedback: ApiAnalyticsDashboardGet200ResponseFeedback.fromJson(json[r'feedback']),
        users: ApiAnalyticsDashboardGet200ResponseUsers.fromJson(json[r'users']),
        topQueries: ApiAnalyticsDashboardGet200ResponseTopQueriesInner.listFromJson(json[r'topQueries']),
      );
    }
    return null;
  }

  static List<ApiAnalyticsDashboardGet200Response> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiAnalyticsDashboardGet200Response>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiAnalyticsDashboardGet200Response.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiAnalyticsDashboardGet200Response> mapFromJson(dynamic json) {
    final map = <String, ApiAnalyticsDashboardGet200Response>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiAnalyticsDashboardGet200Response.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiAnalyticsDashboardGet200Response-objects as value to a dart map
  static Map<String, List<ApiAnalyticsDashboardGet200Response>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiAnalyticsDashboardGet200Response>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiAnalyticsDashboardGet200Response.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

