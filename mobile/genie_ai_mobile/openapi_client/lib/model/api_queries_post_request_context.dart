//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiQueriesPostRequestContext {
  /// Returns a new [ApiQueriesPostRequestContext] instance.
  ApiQueriesPostRequestContext({
    this.categoryLabel,
    this.serviceLabels = const [],
    this.language = 'EN',
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? categoryLabel;

  List<String> serviceLabels;

  String language;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiQueriesPostRequestContext &&
    other.categoryLabel == categoryLabel &&
    _deepEquality.equals(other.serviceLabels, serviceLabels) &&
    other.language == language;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (categoryLabel == null ? 0 : categoryLabel!.hashCode) +
    (serviceLabels.hashCode) +
    (language.hashCode);

  @override
  String toString() => 'ApiQueriesPostRequestContext[categoryLabel=$categoryLabel, serviceLabels=$serviceLabels, language=$language]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.categoryLabel != null) {
      json[r'categoryLabel'] = this.categoryLabel;
    } else {
      json[r'categoryLabel'] = null;
    }
      json[r'serviceLabels'] = this.serviceLabels;
      json[r'language'] = this.language;
    return json;
  }

  /// Returns a new [ApiQueriesPostRequestContext] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiQueriesPostRequestContext? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiQueriesPostRequestContext(
        categoryLabel: mapValueOfType<String>(json, r'categoryLabel'),
        serviceLabels: json[r'serviceLabels'] is Iterable
            ? (json[r'serviceLabels'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        language: mapValueOfType<String>(json, r'language') ?? 'EN',
      );
    }
    return null;
  }

  static List<ApiQueriesPostRequestContext> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiQueriesPostRequestContext>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiQueriesPostRequestContext.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiQueriesPostRequestContext> mapFromJson(dynamic json) {
    final map = <String, ApiQueriesPostRequestContext>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiQueriesPostRequestContext.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiQueriesPostRequestContext-objects as value to a dart map
  static Map<String, List<ApiQueriesPostRequestContext>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiQueriesPostRequestContext>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiQueriesPostRequestContext.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

