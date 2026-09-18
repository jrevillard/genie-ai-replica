//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiLoggerConfigurePostRequest {
  /// Returns a new [ApiLoggerConfigurePostRequest] instance.
  ApiLoggerConfigurePostRequest({
    this.level,
    this.errorMaxSize,
    this.combinedMaxSize,
    this.errorMaxFiles,
    this.combinedMaxFiles,
    this.zippedArchive,
  });

  /// Logging level to apply
  ApiLoggerConfigurePostRequestLevelEnum? level;

  /// Maximum size of error log files before rotation
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? errorMaxSize;

  /// Maximum size of combined log files before rotation
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? combinedMaxSize;

  /// Maximum number of days to keep error log files
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? errorMaxFiles;

  /// Maximum number of days to keep combined log files
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? combinedMaxFiles;

  /// Whether to compress rotated log files
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  bool? zippedArchive;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiLoggerConfigurePostRequest &&
    other.level == level &&
    other.errorMaxSize == errorMaxSize &&
    other.combinedMaxSize == combinedMaxSize &&
    other.errorMaxFiles == errorMaxFiles &&
    other.combinedMaxFiles == combinedMaxFiles &&
    other.zippedArchive == zippedArchive;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (level == null ? 0 : level!.hashCode) +
    (errorMaxSize == null ? 0 : errorMaxSize!.hashCode) +
    (combinedMaxSize == null ? 0 : combinedMaxSize!.hashCode) +
    (errorMaxFiles == null ? 0 : errorMaxFiles!.hashCode) +
    (combinedMaxFiles == null ? 0 : combinedMaxFiles!.hashCode) +
    (zippedArchive == null ? 0 : zippedArchive!.hashCode);

  @override
  String toString() => 'ApiLoggerConfigurePostRequest[level=$level, errorMaxSize=$errorMaxSize, combinedMaxSize=$combinedMaxSize, errorMaxFiles=$errorMaxFiles, combinedMaxFiles=$combinedMaxFiles, zippedArchive=$zippedArchive]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.level != null) {
      json[r'level'] = this.level;
    } else {
      json[r'level'] = null;
    }
    if (this.errorMaxSize != null) {
      json[r'errorMaxSize'] = this.errorMaxSize;
    } else {
      json[r'errorMaxSize'] = null;
    }
    if (this.combinedMaxSize != null) {
      json[r'combinedMaxSize'] = this.combinedMaxSize;
    } else {
      json[r'combinedMaxSize'] = null;
    }
    if (this.errorMaxFiles != null) {
      json[r'errorMaxFiles'] = this.errorMaxFiles;
    } else {
      json[r'errorMaxFiles'] = null;
    }
    if (this.combinedMaxFiles != null) {
      json[r'combinedMaxFiles'] = this.combinedMaxFiles;
    } else {
      json[r'combinedMaxFiles'] = null;
    }
    if (this.zippedArchive != null) {
      json[r'zippedArchive'] = this.zippedArchive;
    } else {
      json[r'zippedArchive'] = null;
    }
    return json;
  }

  /// Returns a new [ApiLoggerConfigurePostRequest] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiLoggerConfigurePostRequest? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiLoggerConfigurePostRequest(
        level: ApiLoggerConfigurePostRequestLevelEnum.fromJson(json[r'level']),
        errorMaxSize: mapValueOfType<String>(json, r'errorMaxSize'),
        combinedMaxSize: mapValueOfType<String>(json, r'combinedMaxSize'),
        errorMaxFiles: mapValueOfType<String>(json, r'errorMaxFiles'),
        combinedMaxFiles: mapValueOfType<String>(json, r'combinedMaxFiles'),
        zippedArchive: mapValueOfType<bool>(json, r'zippedArchive'),
      );
    }
    return null;
  }

  static List<ApiLoggerConfigurePostRequest> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiLoggerConfigurePostRequest>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiLoggerConfigurePostRequest.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiLoggerConfigurePostRequest> mapFromJson(dynamic json) {
    final map = <String, ApiLoggerConfigurePostRequest>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiLoggerConfigurePostRequest.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiLoggerConfigurePostRequest-objects as value to a dart map
  static Map<String, List<ApiLoggerConfigurePostRequest>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiLoggerConfigurePostRequest>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiLoggerConfigurePostRequest.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

/// Logging level to apply
class ApiLoggerConfigurePostRequestLevelEnum {
  /// Instantiate a new enum with the provided [value].
  const ApiLoggerConfigurePostRequestLevelEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const error = ApiLoggerConfigurePostRequestLevelEnum._(r'error');
  static const warn = ApiLoggerConfigurePostRequestLevelEnum._(r'warn');
  static const info = ApiLoggerConfigurePostRequestLevelEnum._(r'info');
  static const debug = ApiLoggerConfigurePostRequestLevelEnum._(r'debug');

  /// List of all possible values in this [enum][ApiLoggerConfigurePostRequestLevelEnum].
  static const values = <ApiLoggerConfigurePostRequestLevelEnum>[
    error,
    warn,
    info,
    debug,
  ];

  static ApiLoggerConfigurePostRequestLevelEnum? fromJson(dynamic value) => ApiLoggerConfigurePostRequestLevelEnumTypeTransformer().decode(value);

  static List<ApiLoggerConfigurePostRequestLevelEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiLoggerConfigurePostRequestLevelEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiLoggerConfigurePostRequestLevelEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [ApiLoggerConfigurePostRequestLevelEnum] to String,
/// and [decode] dynamic data back to [ApiLoggerConfigurePostRequestLevelEnum].
class ApiLoggerConfigurePostRequestLevelEnumTypeTransformer {
  factory ApiLoggerConfigurePostRequestLevelEnumTypeTransformer() => _instance ??= const ApiLoggerConfigurePostRequestLevelEnumTypeTransformer._();

  const ApiLoggerConfigurePostRequestLevelEnumTypeTransformer._();

  String encode(ApiLoggerConfigurePostRequestLevelEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a ApiLoggerConfigurePostRequestLevelEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  ApiLoggerConfigurePostRequestLevelEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'error': return ApiLoggerConfigurePostRequestLevelEnum.error;
        case r'warn': return ApiLoggerConfigurePostRequestLevelEnum.warn;
        case r'info': return ApiLoggerConfigurePostRequestLevelEnum.info;
        case r'debug': return ApiLoggerConfigurePostRequestLevelEnum.debug;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [ApiLoggerConfigurePostRequestLevelEnumTypeTransformer] instance.
  static ApiLoggerConfigurePostRequestLevelEnumTypeTransformer? _instance;
}


