//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiAnalyticsDashboardGet200ResponseFeedback {
  /// Returns a new [ApiAnalyticsDashboardGet200ResponseFeedback] instance.
  ApiAnalyticsDashboardGet200ResponseFeedback({
    this.total,
    this.positive,
    this.neutral,
    this.negative,
    this.positivePercentage,
    this.negativePercentage,
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
  int? positive;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? neutral;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? negative;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  num? positivePercentage;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  num? negativePercentage;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiAnalyticsDashboardGet200ResponseFeedback &&
    other.total == total &&
    other.positive == positive &&
    other.neutral == neutral &&
    other.negative == negative &&
    other.positivePercentage == positivePercentage &&
    other.negativePercentage == negativePercentage;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (total == null ? 0 : total!.hashCode) +
    (positive == null ? 0 : positive!.hashCode) +
    (neutral == null ? 0 : neutral!.hashCode) +
    (negative == null ? 0 : negative!.hashCode) +
    (positivePercentage == null ? 0 : positivePercentage!.hashCode) +
    (negativePercentage == null ? 0 : negativePercentage!.hashCode);

  @override
  String toString() => 'ApiAnalyticsDashboardGet200ResponseFeedback[total=$total, positive=$positive, neutral=$neutral, negative=$negative, positivePercentage=$positivePercentage, negativePercentage=$negativePercentage]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.total != null) {
      json[r'total'] = this.total;
    } else {
      json[r'total'] = null;
    }
    if (this.positive != null) {
      json[r'positive'] = this.positive;
    } else {
      json[r'positive'] = null;
    }
    if (this.neutral != null) {
      json[r'neutral'] = this.neutral;
    } else {
      json[r'neutral'] = null;
    }
    if (this.negative != null) {
      json[r'negative'] = this.negative;
    } else {
      json[r'negative'] = null;
    }
    if (this.positivePercentage != null) {
      json[r'positivePercentage'] = this.positivePercentage;
    } else {
      json[r'positivePercentage'] = null;
    }
    if (this.negativePercentage != null) {
      json[r'negativePercentage'] = this.negativePercentage;
    } else {
      json[r'negativePercentage'] = null;
    }
    return json;
  }

  /// Returns a new [ApiAnalyticsDashboardGet200ResponseFeedback] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiAnalyticsDashboardGet200ResponseFeedback? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiAnalyticsDashboardGet200ResponseFeedback(
        total: mapValueOfType<int>(json, r'total'),
        positive: mapValueOfType<int>(json, r'positive'),
        neutral: mapValueOfType<int>(json, r'neutral'),
        negative: mapValueOfType<int>(json, r'negative'),
        positivePercentage: num.parse('${json[r'positivePercentage']}'),
        negativePercentage: num.parse('${json[r'negativePercentage']}'),
      );
    }
    return null;
  }

  static List<ApiAnalyticsDashboardGet200ResponseFeedback> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiAnalyticsDashboardGet200ResponseFeedback>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiAnalyticsDashboardGet200ResponseFeedback.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiAnalyticsDashboardGet200ResponseFeedback> mapFromJson(dynamic json) {
    final map = <String, ApiAnalyticsDashboardGet200ResponseFeedback>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiAnalyticsDashboardGet200ResponseFeedback.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiAnalyticsDashboardGet200ResponseFeedback-objects as value to a dart map
  static Map<String, List<ApiAnalyticsDashboardGet200ResponseFeedback>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiAnalyticsDashboardGet200ResponseFeedback>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiAnalyticsDashboardGet200ResponseFeedback.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

