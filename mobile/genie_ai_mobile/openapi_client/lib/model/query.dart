//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class Query {
  /// Returns a new [Query] instance.
  Query({
    this.key,
    this.userId,
    this.sessionId,
    this.text,
    this.isAnswered,
    this.timestamp,
    this.categoryId,
    this.feedback,
  });

  /// Unique identifier
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? key;

  /// ID of the user
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? userId;

  /// ID of the session
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? sessionId;

  /// Query text
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? text;

  /// Whether the query has been answered
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  bool? isAnswered;

  /// Query timestamp
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  DateTime? timestamp;

  /// Category ID
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
  ApiQueriesQueryIdFeedbackPost200ResponseFeedback? feedback;

  @override
  bool operator ==(Object other) => identical(this, other) || other is Query &&
    other.key == key &&
    other.userId == userId &&
    other.sessionId == sessionId &&
    other.text == text &&
    other.isAnswered == isAnswered &&
    other.timestamp == timestamp &&
    other.categoryId == categoryId &&
    other.feedback == feedback;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (key == null ? 0 : key!.hashCode) +
    (userId == null ? 0 : userId!.hashCode) +
    (sessionId == null ? 0 : sessionId!.hashCode) +
    (text == null ? 0 : text!.hashCode) +
    (isAnswered == null ? 0 : isAnswered!.hashCode) +
    (timestamp == null ? 0 : timestamp!.hashCode) +
    (categoryId == null ? 0 : categoryId!.hashCode) +
    (feedback == null ? 0 : feedback!.hashCode);

  @override
  String toString() => 'Query[key=$key, userId=$userId, sessionId=$sessionId, text=$text, isAnswered=$isAnswered, timestamp=$timestamp, categoryId=$categoryId, feedback=$feedback]';

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
    if (this.text != null) {
      json[r'text'] = this.text;
    } else {
      json[r'text'] = null;
    }
    if (this.isAnswered != null) {
      json[r'isAnswered'] = this.isAnswered;
    } else {
      json[r'isAnswered'] = null;
    }
    if (this.timestamp != null) {
      json[r'timestamp'] = this.timestamp!.toUtc().toIso8601String();
    } else {
      json[r'timestamp'] = null;
    }
    if (this.categoryId != null) {
      json[r'categoryId'] = this.categoryId;
    } else {
      json[r'categoryId'] = null;
    }
    if (this.feedback != null) {
      json[r'feedback'] = this.feedback;
    } else {
      json[r'feedback'] = null;
    }
    return json;
  }

  /// Returns a new [Query] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static Query? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return Query(
        key: mapValueOfType<String>(json, r'_key'),
        userId: mapValueOfType<String>(json, r'userId'),
        sessionId: mapValueOfType<String>(json, r'sessionId'),
        text: mapValueOfType<String>(json, r'text'),
        isAnswered: mapValueOfType<bool>(json, r'isAnswered'),
        timestamp: mapDateTime(json, r'timestamp', r''),
        categoryId: mapValueOfType<String>(json, r'categoryId'),
        feedback: ApiQueriesQueryIdFeedbackPost200ResponseFeedback.fromJson(json[r'feedback']),
      );
    }
    return null;
  }

  static List<Query> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <Query>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = Query.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, Query> mapFromJson(dynamic json) {
    final map = <String, Query>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = Query.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of Query-objects as value to a dart map
  static Map<String, List<Query>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<Query>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = Query.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

