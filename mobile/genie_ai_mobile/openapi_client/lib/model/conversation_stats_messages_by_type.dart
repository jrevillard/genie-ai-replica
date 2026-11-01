//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ConversationStatsMessagesByType {
  /// Returns a new [ConversationStatsMessagesByType] instance.
  ConversationStatsMessagesByType({
    this.user,
    this.assistant,
  });

  /// Number of user messages
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? user;

  /// Number of assistant messages
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? assistant;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ConversationStatsMessagesByType &&
    other.user == user &&
    other.assistant == assistant;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (user == null ? 0 : user!.hashCode) +
    (assistant == null ? 0 : assistant!.hashCode);

  @override
  String toString() => 'ConversationStatsMessagesByType[user=$user, assistant=$assistant]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.user != null) {
      json[r'user'] = this.user;
    } else {
      json[r'user'] = null;
    }
    if (this.assistant != null) {
      json[r'assistant'] = this.assistant;
    } else {
      json[r'assistant'] = null;
    }
    return json;
  }

  /// Returns a new [ConversationStatsMessagesByType] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ConversationStatsMessagesByType? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ConversationStatsMessagesByType(
        user: mapValueOfType<int>(json, r'user'),
        assistant: mapValueOfType<int>(json, r'assistant'),
      );
    }
    return null;
  }

  static List<ConversationStatsMessagesByType> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ConversationStatsMessagesByType>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ConversationStatsMessagesByType.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ConversationStatsMessagesByType> mapFromJson(dynamic json) {
    final map = <String, ConversationStatsMessagesByType>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ConversationStatsMessagesByType.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ConversationStatsMessagesByType-objects as value to a dart map
  static Map<String, List<ConversationStatsMessagesByType>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ConversationStatsMessagesByType>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ConversationStatsMessagesByType.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

