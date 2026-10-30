//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class Conversation {
  /// Returns a new [Conversation] instance.
  Conversation({
    this.key,
    this.userId,
    this.title,
    this.categoryId,
    this.lastMessage,
    this.created,
    this.updated,
    this.messageCount,
    this.isStarred,
    this.isArchived,
    this.tags = const [],
  });

  /// Unique identifier
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? key;

  /// ID of the user who owns the conversation
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? userId;

  /// Conversation title
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? title;

  /// ID of the service category
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? categoryId;

  /// Preview of the last message
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? lastMessage;

  /// Creation timestamp
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  DateTime? created;

  /// Last update timestamp
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  DateTime? updated;

  /// Number of messages in the conversation
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? messageCount;

  /// Whether the conversation is starred
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  bool? isStarred;

  /// Whether the conversation is archived
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  bool? isArchived;

  /// Tags associated with the conversation
  List<String> tags;

  @override
  bool operator ==(Object other) => identical(this, other) || other is Conversation &&
    other.key == key &&
    other.userId == userId &&
    other.title == title &&
    other.categoryId == categoryId &&
    other.lastMessage == lastMessage &&
    other.created == created &&
    other.updated == updated &&
    other.messageCount == messageCount &&
    other.isStarred == isStarred &&
    other.isArchived == isArchived &&
    _deepEquality.equals(other.tags, tags);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (key == null ? 0 : key!.hashCode) +
    (userId == null ? 0 : userId!.hashCode) +
    (title == null ? 0 : title!.hashCode) +
    (categoryId == null ? 0 : categoryId!.hashCode) +
    (lastMessage == null ? 0 : lastMessage!.hashCode) +
    (created == null ? 0 : created!.hashCode) +
    (updated == null ? 0 : updated!.hashCode) +
    (messageCount == null ? 0 : messageCount!.hashCode) +
    (isStarred == null ? 0 : isStarred!.hashCode) +
    (isArchived == null ? 0 : isArchived!.hashCode) +
    (tags.hashCode);

  @override
  String toString() => 'Conversation[key=$key, userId=$userId, title=$title, categoryId=$categoryId, lastMessage=$lastMessage, created=$created, updated=$updated, messageCount=$messageCount, isStarred=$isStarred, isArchived=$isArchived, tags=$tags]';

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
    if (this.title != null) {
      json[r'title'] = this.title;
    } else {
      json[r'title'] = null;
    }
    if (this.categoryId != null) {
      json[r'categoryId'] = this.categoryId;
    } else {
      json[r'categoryId'] = null;
    }
    if (this.lastMessage != null) {
      json[r'lastMessage'] = this.lastMessage;
    } else {
      json[r'lastMessage'] = null;
    }
    if (this.created != null) {
      json[r'created'] = this.created!.toUtc().toIso8601String();
    } else {
      json[r'created'] = null;
    }
    if (this.updated != null) {
      json[r'updated'] = this.updated!.toUtc().toIso8601String();
    } else {
      json[r'updated'] = null;
    }
    if (this.messageCount != null) {
      json[r'messageCount'] = this.messageCount;
    } else {
      json[r'messageCount'] = null;
    }
    if (this.isStarred != null) {
      json[r'isStarred'] = this.isStarred;
    } else {
      json[r'isStarred'] = null;
    }
    if (this.isArchived != null) {
      json[r'isArchived'] = this.isArchived;
    } else {
      json[r'isArchived'] = null;
    }
      json[r'tags'] = this.tags;
    return json;
  }

  /// Returns a new [Conversation] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static Conversation? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return Conversation(
        key: mapValueOfType<String>(json, r'_key'),
        userId: mapValueOfType<String>(json, r'userId'),
        title: mapValueOfType<String>(json, r'title'),
        categoryId: mapValueOfType<String>(json, r'categoryId'),
        lastMessage: mapValueOfType<String>(json, r'lastMessage'),
        created: mapDateTime(json, r'created', r''),
        updated: mapDateTime(json, r'updated', r''),
        messageCount: mapValueOfType<int>(json, r'messageCount'),
        isStarred: mapValueOfType<bool>(json, r'isStarred'),
        isArchived: mapValueOfType<bool>(json, r'isArchived'),
        tags: json[r'tags'] is Iterable
            ? (json[r'tags'] as Iterable).cast<String>().toList(growable: false)
            : const [],
      );
    }
    return null;
  }

  static List<Conversation> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <Conversation>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = Conversation.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, Conversation> mapFromJson(dynamic json) {
    final map = <String, Conversation>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = Conversation.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of Conversation-objects as value to a dart map
  static Map<String, List<Conversation>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<Conversation>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = Conversation.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

