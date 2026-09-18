//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiAnalyticsSatisfactionGaugeGet200Response {
  /// Returns a new [ApiAnalyticsSatisfactionGaugeGet200Response] instance.
  ApiAnalyticsSatisfactionGaugeGet200Response({
    this.currentValue,
    this.previousValue,
    this.changePercentage,
    this.target,
    this.historicalData = const [],
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  num? currentValue;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  num? previousValue;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  num? changePercentage;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  num? target;

  List<ApiAnalyticsSatisfactionGaugeGet200ResponseHistoricalDataInner> historicalData;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiAnalyticsSatisfactionGaugeGet200Response &&
    other.currentValue == currentValue &&
    other.previousValue == previousValue &&
    other.changePercentage == changePercentage &&
    other.target == target &&
    _deepEquality.equals(other.historicalData, historicalData);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (currentValue == null ? 0 : currentValue!.hashCode) +
    (previousValue == null ? 0 : previousValue!.hashCode) +
    (changePercentage == null ? 0 : changePercentage!.hashCode) +
    (target == null ? 0 : target!.hashCode) +
    (historicalData.hashCode);

  @override
  String toString() => 'ApiAnalyticsSatisfactionGaugeGet200Response[currentValue=$currentValue, previousValue=$previousValue, changePercentage=$changePercentage, target=$target, historicalData=$historicalData]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.currentValue != null) {
      json[r'currentValue'] = this.currentValue;
    } else {
      json[r'currentValue'] = null;
    }
    if (this.previousValue != null) {
      json[r'previousValue'] = this.previousValue;
    } else {
      json[r'previousValue'] = null;
    }
    if (this.changePercentage != null) {
      json[r'changePercentage'] = this.changePercentage;
    } else {
      json[r'changePercentage'] = null;
    }
    if (this.target != null) {
      json[r'target'] = this.target;
    } else {
      json[r'target'] = null;
    }
      json[r'historicalData'] = this.historicalData;
    return json;
  }

  /// Returns a new [ApiAnalyticsSatisfactionGaugeGet200Response] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiAnalyticsSatisfactionGaugeGet200Response? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiAnalyticsSatisfactionGaugeGet200Response(
        currentValue: num.parse('${json[r'currentValue']}'),
        previousValue: num.parse('${json[r'previousValue']}'),
        changePercentage: num.parse('${json[r'changePercentage']}'),
        target: num.parse('${json[r'target']}'),
        historicalData: ApiAnalyticsSatisfactionGaugeGet200ResponseHistoricalDataInner.listFromJson(json[r'historicalData']),
      );
    }
    return null;
  }

  static List<ApiAnalyticsSatisfactionGaugeGet200Response> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiAnalyticsSatisfactionGaugeGet200Response>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiAnalyticsSatisfactionGaugeGet200Response.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiAnalyticsSatisfactionGaugeGet200Response> mapFromJson(dynamic json) {
    final map = <String, ApiAnalyticsSatisfactionGaugeGet200Response>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiAnalyticsSatisfactionGaugeGet200Response.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiAnalyticsSatisfactionGaugeGet200Response-objects as value to a dart map
  static Map<String, List<ApiAnalyticsSatisfactionGaugeGet200Response>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiAnalyticsSatisfactionGaugeGet200Response>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiAnalyticsSatisfactionGaugeGet200Response.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

