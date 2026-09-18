//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiQueriesPostRequest {
  /// Returns a new [ApiQueriesPostRequest] instance.
  ApiQueriesPostRequest({
    required this.sessionId,
    this.text,
    this.messages = const [],
    this.context,
    this.contextOption = const ApiQueriesPostRequestContextOptionEnum._('single-message'),
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
  List<ApiQueriesPostRequestMessagesInner> messages;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  ApiQueriesPostRequestContext? context;

  /// Query mode (defaults to env or single-message)
  ApiQueriesPostRequestContextOptionEnum contextOption;

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
  bool operator ==(Object other) => identical(this, other) || other is ApiQueriesPostRequest &&
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
  String toString() => 'ApiQueriesPostRequest[sessionId=$sessionId, text=$text, messages=$messages, context=$context, contextOption=$contextOption, categoryId=$categoryId, serviceId=$serviceId, timestamp=$timestamp]';

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

  /// Returns a new [ApiQueriesPostRequest] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiQueriesPostRequest? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        assert(json.containsKey(r'sessionId'), 'Required key "ApiQueriesPostRequest[sessionId]" is missing from JSON.');
        assert(json[r'sessionId'] != null, 'Required key "ApiQueriesPostRequest[sessionId]" has a null value in JSON.');
        return true;
      }());

      return ApiQueriesPostRequest(
        sessionId: mapValueOfType<String>(json, r'sessionId')!,
        text: mapValueOfType<String>(json, r'text'),
        messages: ApiQueriesPostRequestMessagesInner.listFromJson(json[r'messages']),
        context: ApiQueriesPostRequestContext.fromJson(json[r'context']),
        contextOption: ApiQueriesPostRequestContextOptionEnum.fromJson(json[r'contextOption']) ?? const ApiQueriesPostRequestContextOptionEnum._('single-message'),
        categoryId: mapValueOfType<String>(json, r'categoryId'),
        serviceId: mapValueOfType<String>(json, r'serviceId'),
        timestamp: mapDateTime(json, r'timestamp', r''),
      );
    }
    return null;
  }

  static List<ApiQueriesPostRequest> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiQueriesPostRequest>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiQueriesPostRequest.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiQueriesPostRequest> mapFromJson(dynamic json) {
    final map = <String, ApiQueriesPostRequest>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiQueriesPostRequest.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiQueriesPostRequest-objects as value to a dart map
  static Map<String, List<ApiQueriesPostRequest>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiQueriesPostRequest>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiQueriesPostRequest.listFromJson(entry.value, growable: growable,);
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
class ApiQueriesPostRequestContextOptionEnum {
  /// Instantiate a new enum with the provided [value].
  const ApiQueriesPostRequestContextOptionEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const singleMessage = ApiQueriesPostRequestContextOptionEnum._(r'single-message');
  static const conversationWithContextLabels = ApiQueriesPostRequestContextOptionEnum._(r'conversation-with-context-labels');

  /// List of all possible values in this [enum][ApiQueriesPostRequestContextOptionEnum].
  static const values = <ApiQueriesPostRequestContextOptionEnum>[
    singleMessage,
    conversationWithContextLabels,
  ];

  static ApiQueriesPostRequestContextOptionEnum? fromJson(dynamic value) => ApiQueriesPostRequestContextOptionEnumTypeTransformer().decode(value);

  static List<ApiQueriesPostRequestContextOptionEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiQueriesPostRequestContextOptionEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiQueriesPostRequestContextOptionEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [ApiQueriesPostRequestContextOptionEnum] to String,
/// and [decode] dynamic data back to [ApiQueriesPostRequestContextOptionEnum].
class ApiQueriesPostRequestContextOptionEnumTypeTransformer {
  factory ApiQueriesPostRequestContextOptionEnumTypeTransformer() => _instance ??= const ApiQueriesPostRequestContextOptionEnumTypeTransformer._();

  const ApiQueriesPostRequestContextOptionEnumTypeTransformer._();

  String encode(ApiQueriesPostRequestContextOptionEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a ApiQueriesPostRequestContextOptionEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  ApiQueriesPostRequestContextOptionEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'single-message': return ApiQueriesPostRequestContextOptionEnum.singleMessage;
        case r'conversation-with-context-labels': return ApiQueriesPostRequestContextOptionEnum.conversationWithContextLabels;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [ApiQueriesPostRequestContextOptionEnumTypeTransformer] instance.
  static ApiQueriesPostRequestContextOptionEnumTypeTransformer? _instance;
}


