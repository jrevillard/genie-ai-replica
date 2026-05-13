//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiQueriesQueryIdFeedbackPost200Response {
  /// Returns a new [ApiQueriesQueryIdFeedbackPost200Response] instance.
  ApiQueriesQueryIdFeedbackPost200Response({
    this.key,
    this.userId,
    this.sessionId,
    this.timestamp,
    this.isAnswered,
    this.categoryId,
    this.serviceId,
    this.responseTime,
    this.contextOption,
    this.text,
    this.response,
    this.feedback,
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? key;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? userId;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? sessionId;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? timestamp;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  bool? isAnswered;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? categoryId;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? serviceId;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? responseTime;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? contextOption;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? text;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? response;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  ApiQueriesQueryIdFeedbackPost200ResponseFeedback? feedback;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiQueriesQueryIdFeedbackPost200Response &&
    other.key == key &&
    other.userId == userId &&
    other.sessionId == sessionId &&
    other.timestamp == timestamp &&
    other.isAnswered == isAnswered &&
    other.categoryId == categoryId &&
    other.serviceId == serviceId &&
    other.responseTime == responseTime &&
    other.contextOption == contextOption &&
    other.text == text &&
    other.response == response &&
    other.feedback == feedback;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (key == null ? 0 : key!.hashCode) +
    (userId == null ? 0 : userId!.hashCode) +
    (sessionId == null ? 0 : sessionId!.hashCode) +
    (timestamp == null ? 0 : timestamp!.hashCode) +
    (isAnswered == null ? 0 : isAnswered!.hashCode) +
    (categoryId == null ? 0 : categoryId!.hashCode) +
    (serviceId == null ? 0 : serviceId!.hashCode) +
    (responseTime == null ? 0 : responseTime!.hashCode) +
    (contextOption == null ? 0 : contextOption!.hashCode) +
    (text == null ? 0 : text!.hashCode) +
    (response == null ? 0 : response!.hashCode) +
    (feedback == null ? 0 : feedback!.hashCode);

  @override
  String toString() => 'ApiQueriesQueryIdFeedbackPost200Response[key=$key, userId=$userId, sessionId=$sessionId, timestamp=$timestamp, isAnswered=$isAnswered, categoryId=$categoryId, serviceId=$serviceId, responseTime=$responseTime, contextOption=$contextOption, text=$text, response=$response, feedback=$feedback]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.key != null) {
      json[r'_key'] = this.key;
    } else {
      json[r'_key'] = null;
    }
    if (this.userId != null) {
      json[r'userId'] = this.userId;
    } else {
      json[r'userId'] = null;
    }
    if (this.sessionId != null) {
      json[r'sessionId'] = this.sessionId;
    } else {
      json[r'sessionId'] = null;
    }
    if (this.timestamp != null) {
      json[r'timestamp'] = this.timestamp;
    } else {
      json[r'timestamp'] = null;
    }
    if (this.isAnswered != null) {
      json[r'isAnswered'] = this.isAnswered;
    } else {
      json[r'isAnswered'] = null;
    }
    if (this.categoryId != null) {
      json[r'categoryId'] = this.categoryId;
    } else {
      json[r'categoryId'] = null;
    }
    if (this.serviceId != null) {
      json[r'serviceId'] = this.serviceId;
    } else {
      json[r'serviceId'] = null;
    }
    if (this.responseTime != null) {
      json[r'responseTime'] = this.responseTime;
    } else {
      json[r'responseTime'] = null;
    }
    if (this.contextOption != null) {
      json[r'contextOption'] = this.contextOption;
    } else {
      json[r'contextOption'] = null;
    }
    if (this.text != null) {
      json[r'text'] = this.text;
    } else {
      json[r'text'] = null;
    }
    if (this.response != null) {
      json[r'response'] = this.response;
    } else {
      json[r'response'] = null;
    }
    if (this.feedback != null) {
      json[r'feedback'] = this.feedback;
    } else {
      json[r'feedback'] = null;
    }
    return json;
  }

  /// Returns a new [ApiQueriesQueryIdFeedbackPost200Response] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiQueriesQueryIdFeedbackPost200Response? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiQueriesQueryIdFeedbackPost200Response(
        key: mapValueOfType<String>(json, r'_key'),
        userId: mapValueOfType<String>(json, r'userId'),
        sessionId: mapValueOfType<String>(json, r'sessionId'),
        timestamp: mapValueOfType<String>(json, r'timestamp'),
        isAnswered: mapValueOfType<bool>(json, r'isAnswered'),
        categoryId: mapValueOfType<String>(json, r'categoryId'),
        serviceId: mapValueOfType<String>(json, r'serviceId'),
        responseTime: mapValueOfType<int>(json, r'responseTime'),
        contextOption: mapValueOfType<String>(json, r'contextOption'),
        text: mapValueOfType<String>(json, r'text'),
        response: mapValueOfType<String>(json, r'response'),
        feedback: ApiQueriesQueryIdFeedbackPost200ResponseFeedback.fromJson(json[r'feedback']),
      );
    }
    return null;
  }

  static List<ApiQueriesQueryIdFeedbackPost200Response> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiQueriesQueryIdFeedbackPost200Response>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiQueriesQueryIdFeedbackPost200Response.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiQueriesQueryIdFeedbackPost200Response> mapFromJson(dynamic json) {
    final map = <String, ApiQueriesQueryIdFeedbackPost200Response>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiQueriesQueryIdFeedbackPost200Response.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiQueriesQueryIdFeedbackPost200Response-objects as value to a dart map
  static Map<String, List<ApiQueriesQueryIdFeedbackPost200Response>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiQueriesQueryIdFeedbackPost200Response>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiQueriesQueryIdFeedbackPost200Response.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

