//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiWeatherPost200ResponseCurrent {
  /// Returns a new [ApiWeatherPost200ResponseCurrent] instance.
  ApiWeatherPost200ResponseCurrent({
    this.temperature,
    this.condition,
    this.humidity,
    this.windSpeed,
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? temperature;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? condition;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? humidity;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? windSpeed;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiWeatherPost200ResponseCurrent &&
    other.temperature == temperature &&
    other.condition == condition &&
    other.humidity == humidity &&
    other.windSpeed == windSpeed;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (temperature == null ? 0 : temperature!.hashCode) +
    (condition == null ? 0 : condition!.hashCode) +
    (humidity == null ? 0 : humidity!.hashCode) +
    (windSpeed == null ? 0 : windSpeed!.hashCode);

  @override
  String toString() => 'ApiWeatherPost200ResponseCurrent[temperature=$temperature, condition=$condition, humidity=$humidity, windSpeed=$windSpeed]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.temperature != null) {
      json[r'temperature'] = this.temperature;
    } else {
      json[r'temperature'] = null;
    }
    if (this.condition != null) {
      json[r'condition'] = this.condition;
    } else {
      json[r'condition'] = null;
    }
    if (this.humidity != null) {
      json[r'humidity'] = this.humidity;
    } else {
      json[r'humidity'] = null;
    }
    if (this.windSpeed != null) {
      json[r'windSpeed'] = this.windSpeed;
    } else {
      json[r'windSpeed'] = null;
    }
    return json;
  }

  /// Returns a new [ApiWeatherPost200ResponseCurrent] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiWeatherPost200ResponseCurrent? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiWeatherPost200ResponseCurrent(
        temperature: mapValueOfType<int>(json, r'temperature'),
        condition: mapValueOfType<String>(json, r'condition'),
        humidity: mapValueOfType<int>(json, r'humidity'),
        windSpeed: mapValueOfType<int>(json, r'windSpeed'),
      );
    }
    return null;
  }

  static List<ApiWeatherPost200ResponseCurrent> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiWeatherPost200ResponseCurrent>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiWeatherPost200ResponseCurrent.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiWeatherPost200ResponseCurrent> mapFromJson(dynamic json) {
    final map = <String, ApiWeatherPost200ResponseCurrent>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiWeatherPost200ResponseCurrent.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiWeatherPost200ResponseCurrent-objects as value to a dart map
  static Map<String, List<ApiWeatherPost200ResponseCurrent>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiWeatherPost200ResponseCurrent>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiWeatherPost200ResponseCurrent.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

