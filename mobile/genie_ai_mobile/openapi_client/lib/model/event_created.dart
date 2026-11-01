//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class EventCreated {
  /// Returns a new [EventCreated] instance.
  EventCreated({
    required this.id,
    required this.key,
    required this.rev,
  });

  String id;

  String key;

  String rev;

  @override
  bool operator ==(Object other) => identical(this, other) || other is EventCreated &&
    other.id == id &&
    other.key == key &&
    other.rev == rev;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (id.hashCode) +
    (key.hashCode) +
    (rev.hashCode);

  @override
  String toString() => 'EventCreated[id=$id, key=$key, rev=$rev]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'_id'] = this.id;
      json[r'_key'] = this.key;
      json[r'_rev'] = this.rev;
    return json;
  }

  /// Returns a new [EventCreated] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static EventCreated? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        assert(json.containsKey(r'_id'), 'Required key "EventCreated[_id]" is missing from JSON.');
        assert(json[r'_id'] != null, 'Required key "EventCreated[_id]" has a null value in JSON.');
        assert(json.containsKey(r'_key'), 'Required key "EventCreated[_key]" is missing from JSON.');
        assert(json[r'_key'] != null, 'Required key "EventCreated[_key]" has a null value in JSON.');
        assert(json.containsKey(r'_rev'), 'Required key "EventCreated[_rev]" is missing from JSON.');
        assert(json[r'_rev'] != null, 'Required key "EventCreated[_rev]" has a null value in JSON.');
        return true;
      }());

      return EventCreated(
        id: mapValueOfType<String>(json, r'_id')!,
        key: mapValueOfType<String>(json, r'_key')!,
        rev: mapValueOfType<String>(json, r'_rev')!,
      );
    }
    return null;
  }

  static List<EventCreated> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <EventCreated>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = EventCreated.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, EventCreated> mapFromJson(dynamic json) {
    final map = <String, EventCreated>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = EventCreated.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of EventCreated-objects as value to a dart map
  static Map<String, List<EventCreated>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<EventCreated>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = EventCreated.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    '_id',
    '_key',
    '_rev',
  };
}

