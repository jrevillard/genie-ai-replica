//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiQueriesQueryIdFeedbackPost200ResponseFeedback {
  /// Returns a new [ApiQueriesQueryIdFeedbackPost200ResponseFeedback] instance.
  ApiQueriesQueryIdFeedbackPost200ResponseFeedback({
    this.rating,
    this.comment,
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  num? rating;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? comment;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiQueriesQueryIdFeedbackPost200ResponseFeedback &&
    other.rating == rating &&
    other.comment == comment;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (rating == null ? 0 : rating!.hashCode) +
    (comment == null ? 0 : comment!.hashCode);

  @override
  String toString() => 'ApiQueriesQueryIdFeedbackPost200ResponseFeedback[rating=$rating, comment=$comment]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.rating != null) {
      json[r'rating'] = this.rating;
    } else {
      json[r'rating'] = null;
    }
    if (this.comment != null) {
      json[r'comment'] = this.comment;
    } else {
      json[r'comment'] = null;
    }
    return json;
  }

  /// Returns a new [ApiQueriesQueryIdFeedbackPost200ResponseFeedback] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiQueriesQueryIdFeedbackPost200ResponseFeedback? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiQueriesQueryIdFeedbackPost200ResponseFeedback(
        rating: num.parse('${json[r'rating']}'),
        comment: mapValueOfType<String>(json, r'comment'),
      );
    }
    return null;
  }

  static List<ApiQueriesQueryIdFeedbackPost200ResponseFeedback> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiQueriesQueryIdFeedbackPost200ResponseFeedback>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiQueriesQueryIdFeedbackPost200ResponseFeedback.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiQueriesQueryIdFeedbackPost200ResponseFeedback> mapFromJson(dynamic json) {
    final map = <String, ApiQueriesQueryIdFeedbackPost200ResponseFeedback>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiQueriesQueryIdFeedbackPost200ResponseFeedback.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiQueriesQueryIdFeedbackPost200ResponseFeedback-objects as value to a dart map
  static Map<String, List<ApiQueriesQueryIdFeedbackPost200ResponseFeedback>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiQueriesQueryIdFeedbackPost200ResponseFeedback>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiQueriesQueryIdFeedbackPost200ResponseFeedback.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

