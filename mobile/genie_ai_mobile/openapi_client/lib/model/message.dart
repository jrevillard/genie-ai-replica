//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class Message {
  /// Returns a new [Message] instance.
  Message({
    this.key,
    this.conversationId,
    this.userId,
    this.content,
    this.timestamp,
    this.sender,
    this.queryId,
    this.readStatus,
    this.metadata,
  });

  /// Unique identifier
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? key;

  /// ID of the parent conversation
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? conversationId;

  /// ID of the user who sent or received the message
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? userId;

  /// Message content
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? content;

  /// Message timestamp
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  DateTime? timestamp;

  /// Sender type (user or assistant)
  MessageSenderEnum? sender;

  /// Optional ID of a related query (for assistant messages)
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? queryId;

  /// Whether the message has been read
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  bool? readStatus;

  /// Additional message metadata
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Object? metadata;

  @override
  bool operator ==(Object other) => identical(this, other) || other is Message &&
    other.key == key &&
    other.conversationId == conversationId &&
    other.userId == userId &&
    other.content == content &&
    other.timestamp == timestamp &&
    other.sender == sender &&
    other.queryId == queryId &&
    other.readStatus == readStatus &&
    other.metadata == metadata;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (key == null ? 0 : key!.hashCode) +
    (conversationId == null ? 0 : conversationId!.hashCode) +
    (userId == null ? 0 : userId!.hashCode) +
    (content == null ? 0 : content!.hashCode) +
    (timestamp == null ? 0 : timestamp!.hashCode) +
    (sender == null ? 0 : sender!.hashCode) +
    (queryId == null ? 0 : queryId!.hashCode) +
    (readStatus == null ? 0 : readStatus!.hashCode) +
    (metadata == null ? 0 : metadata!.hashCode);

  @override
  String toString() => 'Message[key=$key, conversationId=$conversationId, userId=$userId, content=$content, timestamp=$timestamp, sender=$sender, queryId=$queryId, readStatus=$readStatus, metadata=$metadata]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.key != null) {
      json[r'_key'] = this.key;
    } else {
      json[r'_key'] = null;
    }
    if (this.conversationId != null) {
      json[r'conversationId'] = this.conversationId;
    } else {
      json[r'conversationId'] = null;
    }
    if (this.userId != null) {
      json[r'userId'] = this.userId;
    } else {
      json[r'userId'] = null;
    }
    if (this.content != null) {
      json[r'content'] = this.content;
    } else {
      json[r'content'] = null;
    }
    if (this.timestamp != null) {
      json[r'timestamp'] = this.timestamp!.toUtc().toIso8601String();
    } else {
      json[r'timestamp'] = null;
    }
    if (this.sender != null) {
      json[r'sender'] = this.sender;
    } else {
      json[r'sender'] = null;
    }
    if (this.queryId != null) {
      json[r'queryId'] = this.queryId;
    } else {
      json[r'queryId'] = null;
    }
    if (this.readStatus != null) {
      json[r'readStatus'] = this.readStatus;
    } else {
      json[r'readStatus'] = null;
    }
    if (this.metadata != null) {
      json[r'metadata'] = this.metadata;
    } else {
      json[r'metadata'] = null;
    }
    return json;
  }

  /// Returns a new [Message] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static Message? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return Message(
        key: mapValueOfType<String>(json, r'_key'),
        conversationId: mapValueOfType<String>(json, r'conversationId'),
        userId: mapValueOfType<String>(json, r'userId'),
        content: mapValueOfType<String>(json, r'content'),
        timestamp: mapDateTime(json, r'timestamp', r''),
        sender: MessageSenderEnum.fromJson(json[r'sender']),
        queryId: mapValueOfType<String>(json, r'queryId'),
        readStatus: mapValueOfType<bool>(json, r'readStatus'),
        metadata: mapValueOfType<Object>(json, r'metadata'),
      );
    }
    return null;
  }

  static List<Message> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <Message>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = Message.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, Message> mapFromJson(dynamic json) {
    final map = <String, Message>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = Message.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of Message-objects as value to a dart map
  static Map<String, List<Message>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<Message>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = Message.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

/// Sender type (user or assistant)
class MessageSenderEnum {
  /// Instantiate a new enum with the provided [value].
  const MessageSenderEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const user = MessageSenderEnum._(r'user');
  static const assistant = MessageSenderEnum._(r'assistant');

  /// List of all possible values in this [enum][MessageSenderEnum].
  static const values = <MessageSenderEnum>[
    user,
    assistant,
  ];

  static MessageSenderEnum? fromJson(dynamic value) => MessageSenderEnumTypeTransformer().decode(value);

  static List<MessageSenderEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <MessageSenderEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = MessageSenderEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [MessageSenderEnum] to String,
/// and [decode] dynamic data back to [MessageSenderEnum].
class MessageSenderEnumTypeTransformer {
  factory MessageSenderEnumTypeTransformer() => _instance ??= const MessageSenderEnumTypeTransformer._();

  const MessageSenderEnumTypeTransformer._();

  String encode(MessageSenderEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a MessageSenderEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  MessageSenderEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'user': return MessageSenderEnum.user;
        case r'assistant': return MessageSenderEnum.assistant;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [MessageSenderEnumTypeTransformer] instance.
  static MessageSenderEnumTypeTransformer? _instance;
}


