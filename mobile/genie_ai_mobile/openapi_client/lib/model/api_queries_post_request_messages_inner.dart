//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiQueriesPostRequestMessagesInner {
  /// Returns a new [ApiQueriesPostRequestMessagesInner] instance.
  ApiQueriesPostRequestMessagesInner({
    this.role,
    this.content,
  });

  ApiQueriesPostRequestMessagesInnerRoleEnum? role;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? content;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiQueriesPostRequestMessagesInner &&
    other.role == role &&
    other.content == content;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (role == null ? 0 : role!.hashCode) +
    (content == null ? 0 : content!.hashCode);

  @override
  String toString() => 'ApiQueriesPostRequestMessagesInner[role=$role, content=$content]';

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

  /// Returns a new [ApiQueriesPostRequestMessagesInner] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiQueriesPostRequestMessagesInner? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiQueriesPostRequestMessagesInner(
        role: ApiQueriesPostRequestMessagesInnerRoleEnum.fromJson(json[r'role']),
        content: mapValueOfType<String>(json, r'content'),
      );
    }
    return null;
  }

  static List<ApiQueriesPostRequestMessagesInner> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiQueriesPostRequestMessagesInner>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiQueriesPostRequestMessagesInner.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiQueriesPostRequestMessagesInner> mapFromJson(dynamic json) {
    final map = <String, ApiQueriesPostRequestMessagesInner>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiQueriesPostRequestMessagesInner.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiQueriesPostRequestMessagesInner-objects as value to a dart map
  static Map<String, List<ApiQueriesPostRequestMessagesInner>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiQueriesPostRequestMessagesInner>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiQueriesPostRequestMessagesInner.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}


class ApiQueriesPostRequestMessagesInnerRoleEnum {
  /// Instantiate a new enum with the provided [value].
  const ApiQueriesPostRequestMessagesInnerRoleEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const user = ApiQueriesPostRequestMessagesInnerRoleEnum._(r'user');
  static const assistant = ApiQueriesPostRequestMessagesInnerRoleEnum._(r'assistant');

  /// List of all possible values in this [enum][ApiQueriesPostRequestMessagesInnerRoleEnum].
  static const values = <ApiQueriesPostRequestMessagesInnerRoleEnum>[
    user,
    assistant,
  ];

  static ApiQueriesPostRequestMessagesInnerRoleEnum? fromJson(dynamic value) => ApiQueriesPostRequestMessagesInnerRoleEnumTypeTransformer().decode(value);

  static List<ApiQueriesPostRequestMessagesInnerRoleEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiQueriesPostRequestMessagesInnerRoleEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiQueriesPostRequestMessagesInnerRoleEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [ApiQueriesPostRequestMessagesInnerRoleEnum] to String,
/// and [decode] dynamic data back to [ApiQueriesPostRequestMessagesInnerRoleEnum].
class ApiQueriesPostRequestMessagesInnerRoleEnumTypeTransformer {
  factory ApiQueriesPostRequestMessagesInnerRoleEnumTypeTransformer() => _instance ??= const ApiQueriesPostRequestMessagesInnerRoleEnumTypeTransformer._();

  const ApiQueriesPostRequestMessagesInnerRoleEnumTypeTransformer._();

  String encode(ApiQueriesPostRequestMessagesInnerRoleEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a ApiQueriesPostRequestMessagesInnerRoleEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  ApiQueriesPostRequestMessagesInnerRoleEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'user': return ApiQueriesPostRequestMessagesInnerRoleEnum.user;
        case r'assistant': return ApiQueriesPostRequestMessagesInnerRoleEnum.assistant;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [ApiQueriesPostRequestMessagesInnerRoleEnumTypeTransformer] instance.
  static ApiQueriesPostRequestMessagesInnerRoleEnumTypeTransformer? _instance;
}


