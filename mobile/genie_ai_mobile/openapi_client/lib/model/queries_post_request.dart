//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class QueriesPostRequest {
  /// Returns a new [QueriesPostRequest] instance.
  QueriesPostRequest({
    required this.sessionId,
    this.text,
    this.messages = const [],
    this.context,
    this.contextOption = const QueriesPostRequestContextOptionEnum._('single-message'),
    this.categoryId,
    this.serviceId,
    this.timestamp,
  });

  /// ID of the current session
  String sessionId;

  /// The query text (required for single-message mode)
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? text;

  /// Full conversation history (required for conversation mode)
  List<QueriesPostRequestMessagesInner> messages;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  QueriesPostRequestContext? context;

  /// Query mode (defaults to env or single-message)
  QueriesPostRequestContextOptionEnum contextOption;

  /// Category ID for the query
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? categoryId;

  /// Service ID for the query
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? serviceId;

  /// Timestamp for the query (defaults to now)
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  DateTime? timestamp;

  @override
  bool operator ==(Object other) => identical(this, other) || other is QueriesPostRequest &&
    other.sessionId == sessionId &&
    other.text == text &&
    _deepEquality.equals(other.messages, messages) &&
    other.context == context &&
    other.contextOption == contextOption &&
    other.categoryId == categoryId &&
    other.serviceId == serviceId &&
    other.timestamp == timestamp;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (sessionId.hashCode) +
    (text == null ? 0 : text!.hashCode) +
    (messages.hashCode) +
    (context == null ? 0 : context!.hashCode) +
    (contextOption.hashCode) +
    (categoryId == null ? 0 : categoryId!.hashCode) +
    (serviceId == null ? 0 : serviceId!.hashCode) +
    (timestamp == null ? 0 : timestamp!.hashCode);

  @override
  String toString() => 'QueriesPostRequest[sessionId=$sessionId, text=$text, messages=$messages, context=$context, contextOption=$contextOption, categoryId=$categoryId, serviceId=$serviceId, timestamp=$timestamp]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'sessionId'] = this.sessionId;
    if (this.text != null) {
      json[r'text'] = this.text;
    } else {
      json[r'text'] = null;
    }
      json[r'messages'] = this.messages;
    if (this.context != null) {
      json[r'context'] = this.context;
    } else {
      json[r'context'] = null;
    }
      json[r'contextOption'] = this.contextOption;
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
    if (this.timestamp != null) {
      json[r'timestamp'] = this.timestamp!.toUtc().toIso8601String();
    } else {
      json[r'timestamp'] = null;
    }
    return json;
  }

  /// Returns a new [QueriesPostRequest] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static QueriesPostRequest? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        assert(json.containsKey(r'sessionId'), 'Required key "QueriesPostRequest[sessionId]" is missing from JSON.');
        assert(json[r'sessionId'] != null, 'Required key "QueriesPostRequest[sessionId]" has a null value in JSON.');
        return true;
      }());

      return QueriesPostRequest(
        sessionId: mapValueOfType<String>(json, r'sessionId')!,
        text: mapValueOfType<String>(json, r'text'),
        messages: QueriesPostRequestMessagesInner.listFromJson(json[r'messages']),
        context: QueriesPostRequestContext.fromJson(json[r'context']),
        contextOption: QueriesPostRequestContextOptionEnum.fromJson(json[r'contextOption']) ?? const QueriesPostRequestContextOptionEnum._('single-message'),
        categoryId: mapValueOfType<String>(json, r'categoryId'),
        serviceId: mapValueOfType<String>(json, r'serviceId'),
        timestamp: mapDateTime(json, r'timestamp', r''),
      );
    }
    return null;
  }

  static List<QueriesPostRequest> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <QueriesPostRequest>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = QueriesPostRequest.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, QueriesPostRequest> mapFromJson(dynamic json) {
    final map = <String, QueriesPostRequest>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = QueriesPostRequest.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of QueriesPostRequest-objects as value to a dart map
  static Map<String, List<QueriesPostRequest>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<QueriesPostRequest>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = QueriesPostRequest.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'sessionId',
  };
}

/// Query mode (defaults to env or single-message)
enum QueriesPostRequestContextOptionEnum {
  singleMessage._(r'single-message'),
  conversationWithContextLabels._(r'conversation-with-context-labels'),
  ;

  /// Instantiate a new enum with the provided value.
  const QueriesPostRequestContextOptionEnum._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [QueriesPostRequestContextOptionEnum] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static QueriesPostRequestContextOptionEnum? fromJson(dynamic value) => QueriesPostRequestContextOptionEnumTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [QueriesPostRequestContextOptionEnum]
  /// that were successfully decoded from the passed [JSON][json].
  static List<QueriesPostRequestContextOptionEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <QueriesPostRequestContextOptionEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = QueriesPostRequestContextOptionEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [QueriesPostRequestContextOptionEnum] to String,
/// and [decode] dynamic data back to [QueriesPostRequestContextOptionEnum].
class QueriesPostRequestContextOptionEnumTypeTransformer {
  factory QueriesPostRequestContextOptionEnumTypeTransformer() => _instance ??= const QueriesPostRequestContextOptionEnumTypeTransformer._();

  const QueriesPostRequestContextOptionEnumTypeTransformer._();

  String encode(QueriesPostRequestContextOptionEnum data) => data._value;

  /// Returns the instance of [QueriesPostRequestContextOptionEnum] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  QueriesPostRequestContextOptionEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data is QueriesPostRequestContextOptionEnum) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'single-message': return QueriesPostRequestContextOptionEnum.singleMessage;
        case r'conversation-with-context-labels': return QueriesPostRequestContextOptionEnum.conversationWithContextLabels;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static QueriesPostRequestContextOptionEnumTypeTransformer? _instance;
}


