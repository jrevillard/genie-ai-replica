//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiWeatherPost400Response {
  /// Returns a new [ApiWeatherPost400Response] instance.
  ApiWeatherPost400Response({
    required this.error,
    required this.message,
  });

  ApiWeatherPost400ResponseErrorEnum error;

  String message;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiWeatherPost400Response &&
    other.error == error &&
    other.message == message;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (error.hashCode) +
    (message.hashCode);

  @override
  String toString() => 'ApiWeatherPost400Response[error=$error, message=$message]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'error'] = this.error;
      json[r'message'] = this.message;
    return json;
  }

  /// Returns a new [ApiWeatherPost400Response] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiWeatherPost400Response? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        assert(json.containsKey(r'error'), 'Required key "ApiWeatherPost400Response[error]" is missing from JSON.');
        assert(json[r'error'] != null, 'Required key "ApiWeatherPost400Response[error]" has a null value in JSON.');
        assert(json.containsKey(r'message'), 'Required key "ApiWeatherPost400Response[message]" is missing from JSON.');
        assert(json[r'message'] != null, 'Required key "ApiWeatherPost400Response[message]" has a null value in JSON.');
        return true;
      }());

      return ApiWeatherPost400Response(
        error: ApiWeatherPost400ResponseErrorEnum.fromJson(json[r'error'])!,
        message: mapValueOfType<String>(json, r'message')!,
      );
    }
    return null;
  }

  static List<ApiWeatherPost400Response> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiWeatherPost400Response>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiWeatherPost400Response.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiWeatherPost400Response> mapFromJson(dynamic json) {
    final map = <String, ApiWeatherPost400Response>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiWeatherPost400Response.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiWeatherPost400Response-objects as value to a dart map
  static Map<String, List<ApiWeatherPost400Response>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiWeatherPost400Response>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiWeatherPost400Response.listFromJson(entry.value, growable: growable,);
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


enum ApiWeatherPost400ResponseErrorEnum {
  LOCATION_REQUIRED._(r'LOCATION_REQUIRED'),
  ;

  /// Instantiate a new enum with the provided value.
  const ApiWeatherPost400ResponseErrorEnum._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [ApiWeatherPost400ResponseErrorEnum] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static ApiWeatherPost400ResponseErrorEnum? fromJson(dynamic value) => ApiWeatherPost400ResponseErrorEnumTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [ApiWeatherPost400ResponseErrorEnum]
  /// that were successfully decoded from the passed [JSON][json].
  static List<ApiWeatherPost400ResponseErrorEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiWeatherPost400ResponseErrorEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiWeatherPost400ResponseErrorEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [ApiWeatherPost400ResponseErrorEnum] to String,
/// and [decode] dynamic data back to [ApiWeatherPost400ResponseErrorEnum].
class ApiWeatherPost400ResponseErrorEnumTypeTransformer {
  factory ApiWeatherPost400ResponseErrorEnumTypeTransformer() => _instance ??= const ApiWeatherPost400ResponseErrorEnumTypeTransformer._();

  const ApiWeatherPost400ResponseErrorEnumTypeTransformer._();

  String encode(ApiWeatherPost400ResponseErrorEnum data) => data._value;

  /// Returns the instance of [ApiWeatherPost400ResponseErrorEnum] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  ApiWeatherPost400ResponseErrorEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data is ApiWeatherPost400ResponseErrorEnum) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'LOCATION_REQUIRED': return ApiWeatherPost400ResponseErrorEnum.LOCATION_REQUIRED;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static ApiWeatherPost400ResponseErrorEnumTypeTransformer? _instance;
}


