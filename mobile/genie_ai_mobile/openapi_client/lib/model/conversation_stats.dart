//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ConversationStats {
  /// Returns a new [ConversationStats] instance.
  ConversationStats({
    this.totalConversations,
    this.totalMessages,
    this.avgMessagesPerConversation,
    this.starredCount,
    this.archivedCount,
    this.conversationsByCategory = const [],
    this.messagesByType,
  });

  /// Total number of conversations
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? totalConversations;

  /// Number of messages
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? totalMessages;

  /// Average number of messages per conversation
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  num? avgMessagesPerConversation;

  /// Number of starred conversations
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? starredCount;

  /// Number of archived conversations
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? archivedCount;

  List<ConversationStatsConversationsByCategoryInner> conversationsByCategory;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  ConversationStatsMessagesByType? messagesByType;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ConversationStats &&
    other.totalConversations == totalConversations &&
    other.totalMessages == totalMessages &&
    other.avgMessagesPerConversation == avgMessagesPerConversation &&
    other.starredCount == starredCount &&
    other.archivedCount == archivedCount &&
    _deepEquality.equals(other.conversationsByCategory, conversationsByCategory) &&
    other.messagesByType == messagesByType;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (totalConversations == null ? 0 : totalConversations!.hashCode) +
    (totalMessages == null ? 0 : totalMessages!.hashCode) +
    (avgMessagesPerConversation == null ? 0 : avgMessagesPerConversation!.hashCode) +
    (starredCount == null ? 0 : starredCount!.hashCode) +
    (archivedCount == null ? 0 : archivedCount!.hashCode) +
    (conversationsByCategory.hashCode) +
    (messagesByType == null ? 0 : messagesByType!.hashCode);

  @override
  String toString() => 'ConversationStats[totalConversations=$totalConversations, totalMessages=$totalMessages, avgMessagesPerConversation=$avgMessagesPerConversation, starredCount=$starredCount, archivedCount=$archivedCount, conversationsByCategory=$conversationsByCategory, messagesByType=$messagesByType]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.totalConversations != null) {
      json[r'totalConversations'] = this.totalConversations;
    } else {
      json[r'totalConversations'] = null;
    }
    if (this.totalMessages != null) {
      json[r'totalMessages'] = this.totalMessages;
    } else {
      json[r'totalMessages'] = null;
    }
    if (this.avgMessagesPerConversation != null) {
      json[r'avgMessagesPerConversation'] = this.avgMessagesPerConversation;
    } else {
      json[r'avgMessagesPerConversation'] = null;
    }
    if (this.starredCount != null) {
      json[r'starredCount'] = this.starredCount;
    } else {
      json[r'starredCount'] = null;
    }
    if (this.archivedCount != null) {
      json[r'archivedCount'] = this.archivedCount;
    } else {
      json[r'archivedCount'] = null;
    }
      json[r'conversationsByCategory'] = this.conversationsByCategory;
    if (this.messagesByType != null) {
      json[r'messagesByType'] = this.messagesByType;
    } else {
      json[r'messagesByType'] = null;
    }
    return json;
  }

  /// Returns a new [ConversationStats] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ConversationStats? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ConversationStats(
        totalConversations: mapValueOfType<int>(json, r'totalConversations'),
        totalMessages: mapValueOfType<int>(json, r'totalMessages'),
        avgMessagesPerConversation: num.parse('${json[r'avgMessagesPerConversation']}'),
        starredCount: mapValueOfType<int>(json, r'starredCount'),
        archivedCount: mapValueOfType<int>(json, r'archivedCount'),
        conversationsByCategory: ConversationStatsConversationsByCategoryInner.listFromJson(json[r'conversationsByCategory']),
        messagesByType: ConversationStatsMessagesByType.fromJson(json[r'messagesByType']),
      );
    }
    return null;
  }

  static List<ConversationStats> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ConversationStats>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ConversationStats.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ConversationStats> mapFromJson(dynamic json) {
    final map = <String, ConversationStats>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ConversationStats.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ConversationStats-objects as value to a dart map
  static Map<String, List<ConversationStats>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ConversationStats>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ConversationStats.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

