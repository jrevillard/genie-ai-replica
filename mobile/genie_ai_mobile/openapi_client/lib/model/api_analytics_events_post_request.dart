//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiAnalyticsEventsPostRequest {
  /// Returns a new [ApiAnalyticsEventsPostRequest] instance.
  ApiAnalyticsEventsPostRequest({
    required this.eventType,
    this.eventData,
  });

  /// Type of event (e.g., pageView, buttonClick)
  String eventType;

  /// Additional event data
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Object? eventData;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiAnalyticsEventsPostRequest &&
    other.eventType == eventType &&
    other.eventData == eventData;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (eventType.hashCode) +
    (eventData == null ? 0 : eventData!.hashCode);

  @override
  String toString() => 'ApiAnalyticsEventsPostRequest[eventType=$eventType, eventData=$eventData]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'eventType'] = this.eventType;
    if (this.eventData != null) {
      json[r'eventData'] = this.eventData;
    } else {
      json[r'eventData'] = null;
    }
    return json;
  }

  /// Returns a new [ApiAnalyticsEventsPostRequest] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiAnalyticsEventsPostRequest? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        assert(json.containsKey(r'eventType'), 'Required key "ApiAnalyticsEventsPostRequest[eventType]" is missing from JSON.');
        assert(json[r'eventType'] != null, 'Required key "ApiAnalyticsEventsPostRequest[eventType]" has a null value in JSON.');
        return true;
      }());

      return ApiAnalyticsEventsPostRequest(
        eventType: mapValueOfType<String>(json, r'eventType')!,
        eventData: mapValueOfType<Object>(json, r'eventData'),
      );
    }
    return null;
  }

  static List<ApiAnalyticsEventsPostRequest> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiAnalyticsEventsPostRequest>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiAnalyticsEventsPostRequest.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiAnalyticsEventsPostRequest> mapFromJson(dynamic json) {
    final map = <String, ApiAnalyticsEventsPostRequest>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiAnalyticsEventsPostRequest.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiAnalyticsEventsPostRequest-objects as value to a dart map
  static Map<String, List<ApiAnalyticsEventsPostRequest>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiAnalyticsEventsPostRequest>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiAnalyticsEventsPostRequest.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'eventType',
  };
}

