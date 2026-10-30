//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class QueriesStreamPostRequest {
  /// Returns a new [QueriesStreamPostRequest] instance.
  QueriesStreamPostRequest({
    required this.sessionId,
    this.messages = const [],
    this.context,
  });

  String sessionId;

  List<QueriesStreamPostRequestMessagesInner> messages;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  QueryContext? context;

  @override
  bool operator ==(Object other) => identical(this, other) || other is QueriesStreamPostRequest &&
    other.sessionId == sessionId &&
    _deepEquality.equals(other.messages, messages) &&
    other.context == context;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (sessionId.hashCode) +
    (messages.hashCode) +
    (context == null ? 0 : context!.hashCode);

  @override
  String toString() => 'QueriesStreamPostRequest[sessionId=$sessionId, messages=$messages, context=$context]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'sessionId'] = this.sessionId;
      json[r'messages'] = this.messages;
    if (this.context != null) {
      json[r'context'] = this.context;
    } else {
      json[r'context'] = null;
    }
    return json;
  }

  /// Returns a new [QueriesStreamPostRequest] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static QueriesStreamPostRequest? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        assert(json.containsKey(r'sessionId'), 'Required key "QueriesStreamPostRequest[sessionId]" is missing from JSON.');
        assert(json[r'sessionId'] != null, 'Required key "QueriesStreamPostRequest[sessionId]" has a null value in JSON.');
        return true;
      }());

      return QueriesStreamPostRequest(
        sessionId: mapValueOfType<String>(json, r'sessionId')!,
        messages: QueriesStreamPostRequestMessagesInner.listFromJson(json[r'messages']),
        context: QueryContext.fromJson(json[r'context']),
      );
    }
    return null;
  }

  static List<QueriesStreamPostRequest> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <QueriesStreamPostRequest>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = QueriesStreamPostRequest.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, QueriesStreamPostRequest> mapFromJson(dynamic json) {
    final map = <String, QueriesStreamPostRequest>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = QueriesStreamPostRequest.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of QueriesStreamPostRequest-objects as value to a dart map
  static Map<String, List<QueriesStreamPostRequest>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<QueriesStreamPostRequest>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = QueriesStreamPostRequest.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'sessionId',
  };
}

