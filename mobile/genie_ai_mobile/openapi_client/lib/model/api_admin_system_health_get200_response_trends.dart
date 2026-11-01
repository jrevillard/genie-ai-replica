//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiAdminSystemHealthGet200ResponseTrends {
  /// Returns a new [ApiAdminSystemHealthGet200ResponseTrends] instance.
  ApiAdminSystemHealthGet200ResponseTrends({
    this.uptime,
    this.responseTime,
    this.errorRate,
    this.activeUsers,
  });

  num? uptime;

  num? responseTime;

  num? errorRate;

  num? activeUsers;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiAdminSystemHealthGet200ResponseTrends &&
    other.uptime == uptime &&
    other.responseTime == responseTime &&
    other.errorRate == errorRate &&
    other.activeUsers == activeUsers;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (uptime == null ? 0 : uptime!.hashCode) +
    (responseTime == null ? 0 : responseTime!.hashCode) +
    (errorRate == null ? 0 : errorRate!.hashCode) +
    (activeUsers == null ? 0 : activeUsers!.hashCode);

  @override
  String toString() => 'ApiAdminSystemHealthGet200ResponseTrends[uptime=$uptime, responseTime=$responseTime, errorRate=$errorRate, activeUsers=$activeUsers]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.uptime != null) {
      json[r'uptime'] = this.uptime;
    } else {
      json[r'uptime'] = null;
    }
    if (this.responseTime != null) {
      json[r'responseTime'] = this.responseTime;
    } else {
      json[r'responseTime'] = null;
    }
    if (this.errorRate != null) {
      json[r'errorRate'] = this.errorRate;
    } else {
      json[r'errorRate'] = null;
    }
    if (this.activeUsers != null) {
      json[r'activeUsers'] = this.activeUsers;
    } else {
      json[r'activeUsers'] = null;
    }
    return json;
  }

  /// Returns a new [ApiAdminSystemHealthGet200ResponseTrends] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiAdminSystemHealthGet200ResponseTrends? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiAdminSystemHealthGet200ResponseTrends(
        uptime: json[r'uptime'] == null
            ? null
            : num.parse('${json[r'uptime']}'),
        responseTime: json[r'responseTime'] == null
            ? null
            : num.parse('${json[r'responseTime']}'),
        errorRate: json[r'errorRate'] == null
            ? null
            : num.parse('${json[r'errorRate']}'),
        activeUsers: json[r'activeUsers'] == null
            ? null
            : num.parse('${json[r'activeUsers']}'),
      );
    }
    return null;
  }

  static List<ApiAdminSystemHealthGet200ResponseTrends> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiAdminSystemHealthGet200ResponseTrends>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiAdminSystemHealthGet200ResponseTrends.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiAdminSystemHealthGet200ResponseTrends> mapFromJson(dynamic json) {
    final map = <String, ApiAdminSystemHealthGet200ResponseTrends>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiAdminSystemHealthGet200ResponseTrends.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiAdminSystemHealthGet200ResponseTrends-objects as value to a dart map
  static Map<String, List<ApiAdminSystemHealthGet200ResponseTrends>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiAdminSystemHealthGet200ResponseTrends>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiAdminSystemHealthGet200ResponseTrends.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

