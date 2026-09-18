//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class QueriesPostRequestMessagesInner {
  /// Returns a new [QueriesPostRequestMessagesInner] instance.
  QueriesPostRequestMessagesInner({
    this.role,
    this.content,
  });

  QueriesPostRequestMessagesInnerRoleEnum? role;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? content;

  @override
  bool operator ==(Object other) => identical(this, other) || other is QueriesPostRequestMessagesInner &&
    other.role == role &&
    other.content == content;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (role == null ? 0 : role!.hashCode) +
    (content == null ? 0 : content!.hashCode);

  @override
  String toString() => 'QueriesPostRequestMessagesInner[role=$role, content=$content]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.role != null) {
      json[r'role'] = this.role;
    } else {
      json[r'role'] = null;
    }
    if (this.content != null) {
      json[r'content'] = this.content;
    } else {
      json[r'content'] = null;
    }
    return json;
  }

  /// Returns a new [QueriesPostRequestMessagesInner] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static QueriesPostRequestMessagesInner? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return QueriesPostRequestMessagesInner(
        role: QueriesPostRequestMessagesInnerRoleEnum.fromJson(json[r'role']),
        content: mapValueOfType<String>(json, r'content'),
      );
    }
    return null;
  }

  static List<QueriesPostRequestMessagesInner> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <QueriesPostRequestMessagesInner>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = QueriesPostRequestMessagesInner.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, QueriesPostRequestMessagesInner> mapFromJson(dynamic json) {
    final map = <String, QueriesPostRequestMessagesInner>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = QueriesPostRequestMessagesInner.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of QueriesPostRequestMessagesInner-objects as value to a dart map
  static Map<String, List<QueriesPostRequestMessagesInner>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<QueriesPostRequestMessagesInner>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = QueriesPostRequestMessagesInner.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}


enum QueriesPostRequestMessagesInnerRoleEnum {
  user._(r'user'),
  assistant._(r'assistant'),
  ;

  /// Instantiate a new enum with the provided value.
  const QueriesPostRequestMessagesInnerRoleEnum._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [QueriesPostRequestMessagesInnerRoleEnum] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static QueriesPostRequestMessagesInnerRoleEnum? fromJson(dynamic value) => QueriesPostRequestMessagesInnerRoleEnumTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [QueriesPostRequestMessagesInnerRoleEnum]
  /// that were successfully decoded from the passed [JSON][json].
  static List<QueriesPostRequestMessagesInnerRoleEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <QueriesPostRequestMessagesInnerRoleEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = QueriesPostRequestMessagesInnerRoleEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [QueriesPostRequestMessagesInnerRoleEnum] to String,
/// and [decode] dynamic data back to [QueriesPostRequestMessagesInnerRoleEnum].
class QueriesPostRequestMessagesInnerRoleEnumTypeTransformer {
  factory QueriesPostRequestMessagesInnerRoleEnumTypeTransformer() => _instance ??= const QueriesPostRequestMessagesInnerRoleEnumTypeTransformer._();

  const QueriesPostRequestMessagesInnerRoleEnumTypeTransformer._();

  String encode(QueriesPostRequestMessagesInnerRoleEnum data) => data._value;

  /// Returns the instance of [QueriesPostRequestMessagesInnerRoleEnum] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  QueriesPostRequestMessagesInnerRoleEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data is QueriesPostRequestMessagesInnerRoleEnum) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'user': return QueriesPostRequestMessagesInnerRoleEnum.user;
        case r'assistant': return QueriesPostRequestMessagesInnerRoleEnum.assistant;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static QueriesPostRequestMessagesInnerRoleEnumTypeTransformer? _instance;
}


