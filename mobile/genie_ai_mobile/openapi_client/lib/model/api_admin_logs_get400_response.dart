//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiAdminLogsGet400Response {
  /// Returns a new [ApiAdminLogsGet400Response] instance.
  ApiAdminLogsGet400Response({
    this.error,
    this.message,
  });

  ApiAdminLogsGet400ResponseErrorEnum? error;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? message;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiAdminLogsGet400Response &&
    other.error == error &&
    other.message == message;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (error == null ? 0 : error!.hashCode) +
    (message == null ? 0 : message!.hashCode);

  @override
  String toString() => 'ApiAdminLogsGet400Response[error=$error, message=$message]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.error != null) {
      json[r'error'] = this.error;
    } else {
      json[r'error'] = null;
    }
    if (this.message != null) {
      json[r'message'] = this.message;
    } else {
      json[r'message'] = null;
    }
    return json;
  }

  /// Returns a new [ApiAdminLogsGet400Response] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiAdminLogsGet400Response? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiAdminLogsGet400Response(
        error: ApiAdminLogsGet400ResponseErrorEnum.fromJson(json[r'error']),
        message: mapValueOfType<String>(json, r'message'),
      );
    }
    return null;
  }

  static List<ApiAdminLogsGet400Response> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiAdminLogsGet400Response>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiAdminLogsGet400Response.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiAdminLogsGet400Response> mapFromJson(dynamic json) {
    final map = <String, ApiAdminLogsGet400Response>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiAdminLogsGet400Response.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiAdminLogsGet400Response-objects as value to a dart map
  static Map<String, List<ApiAdminLogsGet400Response>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiAdminLogsGet400Response>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiAdminLogsGet400Response.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}


class ApiAdminLogsGet400ResponseErrorEnum {
  /// Instantiate a new enum with the provided [value].
  const ApiAdminLogsGet400ResponseErrorEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const invalidFilter = ApiAdminLogsGet400ResponseErrorEnum._(r'invalid_filter');

  /// List of all possible values in this [enum][ApiAdminLogsGet400ResponseErrorEnum].
  static const values = <ApiAdminLogsGet400ResponseErrorEnum>[
    invalidFilter,
  ];

  static ApiAdminLogsGet400ResponseErrorEnum? fromJson(dynamic value) => ApiAdminLogsGet400ResponseErrorEnumTypeTransformer().decode(value);

  static List<ApiAdminLogsGet400ResponseErrorEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiAdminLogsGet400ResponseErrorEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiAdminLogsGet400ResponseErrorEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [ApiAdminLogsGet400ResponseErrorEnum] to String,
/// and [decode] dynamic data back to [ApiAdminLogsGet400ResponseErrorEnum].
class ApiAdminLogsGet400ResponseErrorEnumTypeTransformer {
  factory ApiAdminLogsGet400ResponseErrorEnumTypeTransformer() => _instance ??= const ApiAdminLogsGet400ResponseErrorEnumTypeTransformer._();

  const ApiAdminLogsGet400ResponseErrorEnumTypeTransformer._();

  String encode(ApiAdminLogsGet400ResponseErrorEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a ApiAdminLogsGet400ResponseErrorEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  ApiAdminLogsGet400ResponseErrorEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'invalid_filter': return ApiAdminLogsGet400ResponseErrorEnum.invalidFilter;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [ApiAdminLogsGet400ResponseErrorEnumTypeTransformer] instance.
  static ApiAdminLogsGet400ResponseErrorEnumTypeTransformer? _instance;
}


