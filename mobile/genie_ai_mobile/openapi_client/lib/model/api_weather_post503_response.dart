//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiWeatherPost503Response {
  /// Returns a new [ApiWeatherPost503Response] instance.
  ApiWeatherPost503Response({
    required this.error,
    required this.message,
  });

  ApiWeatherPost503ResponseErrorEnum error;

  String message;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiWeatherPost503Response &&
    other.error == error &&
    other.message == message;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (error.hashCode) +
    (message.hashCode);

  @override
  String toString() => 'ApiWeatherPost503Response[error=$error, message=$message]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'error'] = this.error;
      json[r'message'] = this.message;
    return json;
  }

  /// Returns a new [ApiWeatherPost503Response] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiWeatherPost503Response? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        assert(json.containsKey(r'error'), 'Required key "ApiWeatherPost503Response[error]" is missing from JSON.');
        assert(json[r'error'] != null, 'Required key "ApiWeatherPost503Response[error]" has a null value in JSON.');
        assert(json.containsKey(r'message'), 'Required key "ApiWeatherPost503Response[message]" is missing from JSON.');
        assert(json[r'message'] != null, 'Required key "ApiWeatherPost503Response[message]" has a null value in JSON.');
        return true;
      }());

      return ApiWeatherPost503Response(
        error: ApiWeatherPost503ResponseErrorEnum.fromJson(json[r'error'])!,
        message: mapValueOfType<String>(json, r'message')!,
      );
    }
    return null;
  }

  static List<ApiWeatherPost503Response> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiWeatherPost503Response>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiWeatherPost503Response.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiWeatherPost503Response> mapFromJson(dynamic json) {
    final map = <String, ApiWeatherPost503Response>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiWeatherPost503Response.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiWeatherPost503Response-objects as value to a dart map
  static Map<String, List<ApiWeatherPost503Response>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiWeatherPost503Response>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiWeatherPost503Response.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'error',
    'message',
  };
}


enum ApiWeatherPost503ResponseErrorEnum {
  WEATHER_UPSTREAM_UNAVAILABLE._(r'WEATHER_UPSTREAM_UNAVAILABLE'),
  CITY_NOT_FOUND._(r'CITY_NOT_FOUND'),
  ;

  /// Instantiate a new enum with the provided value.
  const ApiWeatherPost503ResponseErrorEnum._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [ApiWeatherPost503ResponseErrorEnum] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static ApiWeatherPost503ResponseErrorEnum? fromJson(dynamic value) => ApiWeatherPost503ResponseErrorEnumTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [ApiWeatherPost503ResponseErrorEnum]
  /// that were successfully decoded from the passed [JSON][json].
  static List<ApiWeatherPost503ResponseErrorEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiWeatherPost503ResponseErrorEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiWeatherPost503ResponseErrorEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [ApiWeatherPost503ResponseErrorEnum] to String,
/// and [decode] dynamic data back to [ApiWeatherPost503ResponseErrorEnum].
class ApiWeatherPost503ResponseErrorEnumTypeTransformer {
  factory ApiWeatherPost503ResponseErrorEnumTypeTransformer() => _instance ??= const ApiWeatherPost503ResponseErrorEnumTypeTransformer._();

  const ApiWeatherPost503ResponseErrorEnumTypeTransformer._();

  String encode(ApiWeatherPost503ResponseErrorEnum data) => data._value;

  /// Returns the instance of [ApiWeatherPost503ResponseErrorEnum] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  ApiWeatherPost503ResponseErrorEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data is ApiWeatherPost503ResponseErrorEnum) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'WEATHER_UPSTREAM_UNAVAILABLE': return ApiWeatherPost503ResponseErrorEnum.WEATHER_UPSTREAM_UNAVAILABLE;
        case r'CITY_NOT_FOUND': return ApiWeatherPost503ResponseErrorEnum.CITY_NOT_FOUND;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static ApiWeatherPost503ResponseErrorEnumTypeTransformer? _instance;
}


