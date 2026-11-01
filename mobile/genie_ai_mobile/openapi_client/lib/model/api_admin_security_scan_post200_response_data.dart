//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiAdminSecurityScanPost200ResponseData {
  /// Returns a new [ApiAdminSecurityScanPost200ResponseData] instance.
  ApiAdminSecurityScanPost200ResponseData({
    this.scanTime,
    this.vulnerabilities,
    this.status,
    this.skipped,
    this.reason,
    this.vulnerabilityDetails,
    this.patternMatches = const [],
    this.patternMatchCount,
    this.failedLoginDetails = const [],
    this.suspiciousDetails = const [],
    this.message,
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  DateTime? scanTime;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  ApiAdminSecurityScanPost200ResponseDataVulnerabilities? vulnerabilities;

  ApiAdminSecurityScanPost200ResponseDataStatusEnum? status;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  bool? skipped;

  String? reason;

  /// Categorised vulnerability buckets: {critical, medium, low} arrays.
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Object? vulnerabilityDetails;

  /// All pattern-match rows (signature hits + bare-phrase hits).
  List<Object> patternMatches;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? patternMatchCount;

  List<Object> failedLoginDetails;

  List<Object> suspiciousDetails;

  /// Human-readable scan summary; distinguishes skipped vs completed.
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? message;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiAdminSecurityScanPost200ResponseData &&
    other.scanTime == scanTime &&
    other.vulnerabilities == vulnerabilities &&
    other.status == status &&
    other.skipped == skipped &&
    other.reason == reason &&
    other.vulnerabilityDetails == vulnerabilityDetails &&
    _deepEquality.equals(other.patternMatches, patternMatches) &&
    other.patternMatchCount == patternMatchCount &&
    _deepEquality.equals(other.failedLoginDetails, failedLoginDetails) &&
    _deepEquality.equals(other.suspiciousDetails, suspiciousDetails) &&
    other.message == message;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (scanTime == null ? 0 : scanTime!.hashCode) +
    (vulnerabilities == null ? 0 : vulnerabilities!.hashCode) +
    (status == null ? 0 : status!.hashCode) +
    (skipped == null ? 0 : skipped!.hashCode) +
    (reason == null ? 0 : reason!.hashCode) +
    (vulnerabilityDetails == null ? 0 : vulnerabilityDetails!.hashCode) +
    (patternMatches.hashCode) +
    (patternMatchCount == null ? 0 : patternMatchCount!.hashCode) +
    (failedLoginDetails.hashCode) +
    (suspiciousDetails.hashCode) +
    (message == null ? 0 : message!.hashCode);

  @override
  String toString() => 'ApiAdminSecurityScanPost200ResponseData[scanTime=$scanTime, vulnerabilities=$vulnerabilities, status=$status, skipped=$skipped, reason=$reason, vulnerabilityDetails=$vulnerabilityDetails, patternMatches=$patternMatches, patternMatchCount=$patternMatchCount, failedLoginDetails=$failedLoginDetails, suspiciousDetails=$suspiciousDetails, message=$message]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.scanTime != null) {
      json[r'scanTime'] = this.scanTime!.toUtc().toIso8601String();
    } else {
      json[r'scanTime'] = null;
    }
    if (this.vulnerabilities != null) {
      json[r'vulnerabilities'] = this.vulnerabilities;
    } else {
      json[r'vulnerabilities'] = null;
    }
    if (this.status != null) {
      json[r'status'] = this.status;
    } else {
      json[r'status'] = null;
    }
    if (this.skipped != null) {
      json[r'skipped'] = this.skipped;
    } else {
      json[r'skipped'] = null;
    }
    if (this.reason != null) {
      json[r'reason'] = this.reason;
    } else {
      json[r'reason'] = null;
    }
    if (this.vulnerabilityDetails != null) {
      json[r'vulnerabilityDetails'] = this.vulnerabilityDetails;
    } else {
      json[r'vulnerabilityDetails'] = null;
    }
      json[r'patternMatches'] = this.patternMatches;
    if (this.patternMatchCount != null) {
      json[r'patternMatchCount'] = this.patternMatchCount;
    } else {
      json[r'patternMatchCount'] = null;
    }
      json[r'failedLoginDetails'] = this.failedLoginDetails;
      json[r'suspiciousDetails'] = this.suspiciousDetails;
    if (this.message != null) {
      json[r'message'] = this.message;
    } else {
      json[r'message'] = null;
    }
    return json;
  }

  /// Returns a new [ApiAdminSecurityScanPost200ResponseData] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiAdminSecurityScanPost200ResponseData? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiAdminSecurityScanPost200ResponseData(
        scanTime: mapDateTime(json, r'scanTime', r''),
        vulnerabilities: ApiAdminSecurityScanPost200ResponseDataVulnerabilities.fromJson(json[r'vulnerabilities']),
        status: ApiAdminSecurityScanPost200ResponseDataStatusEnum.fromJson(json[r'status']),
        skipped: mapValueOfType<bool>(json, r'skipped'),
        reason: mapValueOfType<String>(json, r'reason'),
        vulnerabilityDetails: mapValueOfType<Object>(json, r'vulnerabilityDetails'),
        patternMatches: json[r'patternMatches'] is Iterable
            ? (json[r'patternMatches'] as Iterable).cast<Object>().toList(growable: false)
            : const [],
        patternMatchCount: mapValueOfType<int>(json, r'patternMatchCount'),
        failedLoginDetails: json[r'failedLoginDetails'] is Iterable
            ? (json[r'failedLoginDetails'] as Iterable).cast<Object>().toList(growable: false)
            : const [],
        suspiciousDetails: json[r'suspiciousDetails'] is Iterable
            ? (json[r'suspiciousDetails'] as Iterable).cast<Object>().toList(growable: false)
            : const [],
        message: mapValueOfType<String>(json, r'message'),
      );
    }
    return null;
  }

  static List<ApiAdminSecurityScanPost200ResponseData> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiAdminSecurityScanPost200ResponseData>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiAdminSecurityScanPost200ResponseData.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiAdminSecurityScanPost200ResponseData> mapFromJson(dynamic json) {
    final map = <String, ApiAdminSecurityScanPost200ResponseData>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiAdminSecurityScanPost200ResponseData.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiAdminSecurityScanPost200ResponseData-objects as value to a dart map
  static Map<String, List<ApiAdminSecurityScanPost200ResponseData>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiAdminSecurityScanPost200ResponseData>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiAdminSecurityScanPost200ResponseData.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}


class ApiAdminSecurityScanPost200ResponseDataStatusEnum {
  /// Instantiate a new enum with the provided [value].
  const ApiAdminSecurityScanPost200ResponseDataStatusEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const completed = ApiAdminSecurityScanPost200ResponseDataStatusEnum._(r'completed');
  static const skipped = ApiAdminSecurityScanPost200ResponseDataStatusEnum._(r'skipped');

  /// List of all possible values in this [enum][ApiAdminSecurityScanPost200ResponseDataStatusEnum].
  static const values = <ApiAdminSecurityScanPost200ResponseDataStatusEnum>[
    completed,
    skipped,
  ];

  static ApiAdminSecurityScanPost200ResponseDataStatusEnum? fromJson(dynamic value) => ApiAdminSecurityScanPost200ResponseDataStatusEnumTypeTransformer().decode(value);

  static List<ApiAdminSecurityScanPost200ResponseDataStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiAdminSecurityScanPost200ResponseDataStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiAdminSecurityScanPost200ResponseDataStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [ApiAdminSecurityScanPost200ResponseDataStatusEnum] to String,
/// and [decode] dynamic data back to [ApiAdminSecurityScanPost200ResponseDataStatusEnum].
class ApiAdminSecurityScanPost200ResponseDataStatusEnumTypeTransformer {
  factory ApiAdminSecurityScanPost200ResponseDataStatusEnumTypeTransformer() => _instance ??= const ApiAdminSecurityScanPost200ResponseDataStatusEnumTypeTransformer._();

  const ApiAdminSecurityScanPost200ResponseDataStatusEnumTypeTransformer._();

  String encode(ApiAdminSecurityScanPost200ResponseDataStatusEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a ApiAdminSecurityScanPost200ResponseDataStatusEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  ApiAdminSecurityScanPost200ResponseDataStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'completed': return ApiAdminSecurityScanPost200ResponseDataStatusEnum.completed;
        case r'skipped': return ApiAdminSecurityScanPost200ResponseDataStatusEnum.skipped;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [ApiAdminSecurityScanPost200ResponseDataStatusEnumTypeTransformer] instance.
  static ApiAdminSecurityScanPost200ResponseDataStatusEnumTypeTransformer? _instance;
}


