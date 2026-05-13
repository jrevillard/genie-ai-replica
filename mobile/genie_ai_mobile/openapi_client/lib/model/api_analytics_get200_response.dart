//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiAnalyticsGet200Response {
  /// Returns a new [ApiAnalyticsGet200Response] instance.
  ApiAnalyticsGet200Response({
    this.queryCount,
    this.feedbackCount,
    this.avgRating,
    this.timeDistribution,
    this.categoryDistribution,
    this.raw = const [],
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? queryCount;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? feedbackCount;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  num? avgRating;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Object? timeDistribution;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Object? categoryDistribution;

  List<Object> raw;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiAnalyticsGet200Response &&
    other.queryCount == queryCount &&
    other.feedbackCount == feedbackCount &&
    other.avgRating == avgRating &&
    other.timeDistribution == timeDistribution &&
    other.categoryDistribution == categoryDistribution &&
    _deepEquality.equals(other.raw, raw);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (queryCount == null ? 0 : queryCount!.hashCode) +
    (feedbackCount == null ? 0 : feedbackCount!.hashCode) +
    (avgRating == null ? 0 : avgRating!.hashCode) +
    (timeDistribution == null ? 0 : timeDistribution!.hashCode) +
    (categoryDistribution == null ? 0 : categoryDistribution!.hashCode) +
    (raw.hashCode);

  @override
  String toString() => 'ApiAnalyticsGet200Response[queryCount=$queryCount, feedbackCount=$feedbackCount, avgRating=$avgRating, timeDistribution=$timeDistribution, categoryDistribution=$categoryDistribution, raw=$raw]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.queryCount != null) {
      json[r'queryCount'] = this.queryCount;
    } else {
      json[r'queryCount'] = null;
    }
    if (this.feedbackCount != null) {
      json[r'feedbackCount'] = this.feedbackCount;
    } else {
      json[r'feedbackCount'] = null;
    }
    if (this.avgRating != null) {
      json[r'avgRating'] = this.avgRating;
    } else {
      json[r'avgRating'] = null;
    }
    if (this.timeDistribution != null) {
      json[r'timeDistribution'] = this.timeDistribution;
    } else {
      json[r'timeDistribution'] = null;
    }
    if (this.categoryDistribution != null) {
      json[r'categoryDistribution'] = this.categoryDistribution;
    } else {
      json[r'categoryDistribution'] = null;
    }
      json[r'raw'] = this.raw;
    return json;
  }

  /// Returns a new [ApiAnalyticsGet200Response] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiAnalyticsGet200Response? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiAnalyticsGet200Response(
        queryCount: mapValueOfType<int>(json, r'queryCount'),
        feedbackCount: mapValueOfType<int>(json, r'feedbackCount'),
        avgRating: num.parse('${json[r'avgRating']}'),
        timeDistribution: mapValueOfType<Object>(json, r'timeDistribution'),
        categoryDistribution: mapValueOfType<Object>(json, r'categoryDistribution'),
        raw: json[r'raw'] is Iterable
            ? (json[r'raw'] as Iterable).cast<Object>().toList(growable: false)
            : const [],
      );
    }
    return null;
  }

  static List<ApiAnalyticsGet200Response> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiAnalyticsGet200Response>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiAnalyticsGet200Response.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiAnalyticsGet200Response> mapFromJson(dynamic json) {
    final map = <String, ApiAnalyticsGet200Response>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiAnalyticsGet200Response.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiAnalyticsGet200Response-objects as value to a dart map
  static Map<String, List<ApiAnalyticsGet200Response>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiAnalyticsGet200Response>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiAnalyticsGet200Response.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

