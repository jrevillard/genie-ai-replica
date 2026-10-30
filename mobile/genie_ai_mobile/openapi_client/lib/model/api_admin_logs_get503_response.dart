//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiAdminLogsGet503Response {
  /// Returns a new [ApiAdminLogsGet503Response] instance.
  ApiAdminLogsGet503Response({
    this.error,
    this.message,
  });

  ApiAdminLogsGet503ResponseErrorEnum? error;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? message;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiAdminLogsGet503Response &&
    other.error == error &&
    other.message == message;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (error == null ? 0 : error!.hashCode) +
    (message == null ? 0 : message!.hashCode);

  @override
  String toString() => 'ApiAdminLogsGet503Response[error=$error, message=$message]';

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

  /// Returns a new [ApiAdminLogsGet503Response] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiAdminLogsGet503Response? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiAdminLogsGet503Response(
        error: ApiAdminLogsGet503ResponseErrorEnum.fromJson(json[r'error']),
        message: mapValueOfType<String>(json, r'message'),
      );
    }
    return null;
  }

  static List<ApiAdminLogsGet503Response> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiAdminLogsGet503Response>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiAdminLogsGet503Response.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiAdminLogsGet503Response> mapFromJson(dynamic json) {
    final map = <String, ApiAdminLogsGet503Response>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiAdminLogsGet503Response.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiAdminLogsGet503Response-objects as value to a dart map
  static Map<String, List<ApiAdminLogsGet503Response>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiAdminLogsGet503Response>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiAdminLogsGet503Response.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}


class ApiAdminLogsGet503ResponseErrorEnum {
  /// Instantiate a new enum with the provided [value].
  const ApiAdminLogsGet503ResponseErrorEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const vlUnreachable = ApiAdminLogsGet503ResponseErrorEnum._(r'vl_unreachable');

  /// List of all possible values in this [enum][ApiAdminLogsGet503ResponseErrorEnum].
  static const values = <ApiAdminLogsGet503ResponseErrorEnum>[
    vlUnreachable,
  ];

  static ApiAdminLogsGet503ResponseErrorEnum? fromJson(dynamic value) => ApiAdminLogsGet503ResponseErrorEnumTypeTransformer().decode(value);

  static List<ApiAdminLogsGet503ResponseErrorEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiAdminLogsGet503ResponseErrorEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiAdminLogsGet503ResponseErrorEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [ApiAdminLogsGet503ResponseErrorEnum] to String,
/// and [decode] dynamic data back to [ApiAdminLogsGet503ResponseErrorEnum].
class ApiAdminLogsGet503ResponseErrorEnumTypeTransformer {
  factory ApiAdminLogsGet503ResponseErrorEnumTypeTransformer() => _instance ??= const ApiAdminLogsGet503ResponseErrorEnumTypeTransformer._();

  const ApiAdminLogsGet503ResponseErrorEnumTypeTransformer._();

  String encode(ApiAdminLogsGet503ResponseErrorEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a ApiAdminLogsGet503ResponseErrorEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  ApiAdminLogsGet503ResponseErrorEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'vl_unreachable': return ApiAdminLogsGet503ResponseErrorEnum.vlUnreachable;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [ApiAdminLogsGet503ResponseErrorEnumTypeTransformer] instance.
  static ApiAdminLogsGet503ResponseErrorEnumTypeTransformer? _instance;
}


