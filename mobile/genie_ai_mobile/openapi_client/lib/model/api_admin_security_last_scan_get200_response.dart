//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiAdminSecurityLastScanGet200Response {
  /// Returns a new [ApiAdminSecurityLastScanGet200Response] instance.
  ApiAdminSecurityLastScanGet200Response({
    this.scanTime,
    this.lastScan,
    this.vulnerabilities,
    this.vulnerabilityDetails,
    this.patternMatches = const [],
    this.patternMatchCount,
    this.failedLoginDetails = const [],
    this.suspiciousDetails = const [],
    this.status,
    this.skipped,
    this.reason,
    this.message,
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  DateTime? scanTime;

  /// Cold-start sentinel (\"Never\") returned by getLastScanDetails when no scan has been saved yet; null after the first successful run.
  String? lastScan;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  ApiAdminSecurityScanPost200ResponseDataVulnerabilities? vulnerabilities;

  /// Categorised vulnerability buckets: {critical, medium, low} arrays.
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Object? vulnerabilityDetails;

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

  ApiAdminSecurityLastScanGet200ResponseStatusEnum? status;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  bool? skipped;

  String? reason;

  /// Human-readable scan summary (only present after a run; cold-start default omits it).
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? message;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiAdminSecurityLastScanGet200Response &&
    other.scanTime == scanTime &&
    other.lastScan == lastScan &&
    other.vulnerabilities == vulnerabilities &&
    other.vulnerabilityDetails == vulnerabilityDetails &&
    _deepEquality.equals(other.patternMatches, patternMatches) &&
    other.patternMatchCount == patternMatchCount &&
    _deepEquality.equals(other.failedLoginDetails, failedLoginDetails) &&
    _deepEquality.equals(other.suspiciousDetails, suspiciousDetails) &&
    other.status == status &&
    other.skipped == skipped &&
    other.reason == reason &&
    other.message == message;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (scanTime == null ? 0 : scanTime!.hashCode) +
    (lastScan == null ? 0 : lastScan!.hashCode) +
    (vulnerabilities == null ? 0 : vulnerabilities!.hashCode) +
    (vulnerabilityDetails == null ? 0 : vulnerabilityDetails!.hashCode) +
    (patternMatches.hashCode) +
    (patternMatchCount == null ? 0 : patternMatchCount!.hashCode) +
    (failedLoginDetails.hashCode) +
    (suspiciousDetails.hashCode) +
    (status == null ? 0 : status!.hashCode) +
    (skipped == null ? 0 : skipped!.hashCode) +
    (reason == null ? 0 : reason!.hashCode) +
    (message == null ? 0 : message!.hashCode);

  @override
  String toString() => 'ApiAdminSecurityLastScanGet200Response[scanTime=$scanTime, lastScan=$lastScan, vulnerabilities=$vulnerabilities, vulnerabilityDetails=$vulnerabilityDetails, patternMatches=$patternMatches, patternMatchCount=$patternMatchCount, failedLoginDetails=$failedLoginDetails, suspiciousDetails=$suspiciousDetails, status=$status, skipped=$skipped, reason=$reason, message=$message]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.scanTime != null) {
      json[r'scanTime'] = this.scanTime!.toUtc().toIso8601String();
    } else {
      json[r'scanTime'] = null;
    }
    if (this.lastScan != null) {
      json[r'lastScan'] = this.lastScan;
    } else {
      json[r'lastScan'] = null;
    }
    if (this.vulnerabilities != null) {
      json[r'vulnerabilities'] = this.vulnerabilities;
    } else {
      json[r'vulnerabilities'] = null;
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
    if (this.message != null) {
      json[r'message'] = this.message;
    } else {
      json[r'message'] = null;
    }
    return json;
  }

  /// Returns a new [ApiAdminSecurityLastScanGet200Response] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiAdminSecurityLastScanGet200Response? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiAdminSecurityLastScanGet200Response(
        scanTime: mapDateTime(json, r'scanTime', r''),
        lastScan: mapValueOfType<String>(json, r'lastScan'),
        vulnerabilities: ApiAdminSecurityScanPost200ResponseDataVulnerabilities.fromJson(json[r'vulnerabilities']),
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
        status: ApiAdminSecurityLastScanGet200ResponseStatusEnum.fromJson(json[r'status']),
        skipped: mapValueOfType<bool>(json, r'skipped'),
        reason: mapValueOfType<String>(json, r'reason'),
        message: mapValueOfType<String>(json, r'message'),
      );
    }
    return null;
  }

  static List<ApiAdminSecurityLastScanGet200Response> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiAdminSecurityLastScanGet200Response>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiAdminSecurityLastScanGet200Response.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiAdminSecurityLastScanGet200Response> mapFromJson(dynamic json) {
    final map = <String, ApiAdminSecurityLastScanGet200Response>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiAdminSecurityLastScanGet200Response.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiAdminSecurityLastScanGet200Response-objects as value to a dart map
  static Map<String, List<ApiAdminSecurityLastScanGet200Response>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiAdminSecurityLastScanGet200Response>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiAdminSecurityLastScanGet200Response.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}


class ApiAdminSecurityLastScanGet200ResponseStatusEnum {
  /// Instantiate a new enum with the provided [value].
  const ApiAdminSecurityLastScanGet200ResponseStatusEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const completed = ApiAdminSecurityLastScanGet200ResponseStatusEnum._(r'completed');
  static const skipped = ApiAdminSecurityLastScanGet200ResponseStatusEnum._(r'skipped');

  /// List of all possible values in this [enum][ApiAdminSecurityLastScanGet200ResponseStatusEnum].
  static const values = <ApiAdminSecurityLastScanGet200ResponseStatusEnum>[
    completed,
    skipped,
  ];

  static ApiAdminSecurityLastScanGet200ResponseStatusEnum? fromJson(dynamic value) => ApiAdminSecurityLastScanGet200ResponseStatusEnumTypeTransformer().decode(value);

  static List<ApiAdminSecurityLastScanGet200ResponseStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiAdminSecurityLastScanGet200ResponseStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiAdminSecurityLastScanGet200ResponseStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [ApiAdminSecurityLastScanGet200ResponseStatusEnum] to String,
/// and [decode] dynamic data back to [ApiAdminSecurityLastScanGet200ResponseStatusEnum].
class ApiAdminSecurityLastScanGet200ResponseStatusEnumTypeTransformer {
  factory ApiAdminSecurityLastScanGet200ResponseStatusEnumTypeTransformer() => _instance ??= const ApiAdminSecurityLastScanGet200ResponseStatusEnumTypeTransformer._();

  const ApiAdminSecurityLastScanGet200ResponseStatusEnumTypeTransformer._();

  String encode(ApiAdminSecurityLastScanGet200ResponseStatusEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a ApiAdminSecurityLastScanGet200ResponseStatusEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  ApiAdminSecurityLastScanGet200ResponseStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'completed': return ApiAdminSecurityLastScanGet200ResponseStatusEnum.completed;
        case r'skipped': return ApiAdminSecurityLastScanGet200ResponseStatusEnum.skipped;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [ApiAdminSecurityLastScanGet200ResponseStatusEnumTypeTransformer] instance.
  static ApiAdminSecurityLastScanGet200ResponseStatusEnumTypeTransformer? _instance;
}


