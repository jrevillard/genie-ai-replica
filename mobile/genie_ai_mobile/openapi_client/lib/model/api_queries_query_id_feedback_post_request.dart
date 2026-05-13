//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiQueriesQueryIdFeedbackPostRequest {
  /// Returns a new [ApiQueriesQueryIdFeedbackPostRequest] instance.
  ApiQueriesQueryIdFeedbackPostRequest({
    required this.rating,
    this.comment,
  });

  /// Rating from 1 to 5
  ///
  /// Minimum value: 1
  /// Maximum value: 5
  num rating;

  /// Optional feedback comment
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? comment;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiQueriesQueryIdFeedbackPostRequest &&
    other.rating == rating &&
    other.comment == comment;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (rating.hashCode) +
    (comment == null ? 0 : comment!.hashCode);

  @override
  String toString() => 'ApiQueriesQueryIdFeedbackPostRequest[rating=$rating, comment=$comment]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'rating'] = this.rating;
    if (this.comment != null) {
      json[r'comment'] = this.comment;
    } else {
      json[r'comment'] = null;
    }
    return json;
  }

  /// Returns a new [ApiQueriesQueryIdFeedbackPostRequest] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiQueriesQueryIdFeedbackPostRequest? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        assert(json.containsKey(r'rating'), 'Required key "ApiQueriesQueryIdFeedbackPostRequest[rating]" is missing from JSON.');
        assert(json[r'rating'] != null, 'Required key "ApiQueriesQueryIdFeedbackPostRequest[rating]" has a null value in JSON.');
        return true;
      }());

      return ApiQueriesQueryIdFeedbackPostRequest(
        rating: num.parse('${json[r'rating']}'),
        comment: mapValueOfType<String>(json, r'comment'),
      );
    }
    return null;
  }

  static List<ApiQueriesQueryIdFeedbackPostRequest> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiQueriesQueryIdFeedbackPostRequest>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiQueriesQueryIdFeedbackPostRequest.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiQueriesQueryIdFeedbackPostRequest> mapFromJson(dynamic json) {
    final map = <String, ApiQueriesQueryIdFeedbackPostRequest>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiQueriesQueryIdFeedbackPostRequest.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiQueriesQueryIdFeedbackPostRequest-objects as value to a dart map
  static Map<String, List<ApiQueriesQueryIdFeedbackPostRequest>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiQueriesQueryIdFeedbackPostRequest>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiQueriesQueryIdFeedbackPostRequest.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'rating',
  };
}

