//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiServiceCategoriesCategoryIdTranslationsGet200ResponseInner {
  /// Returns a new [ApiServiceCategoriesCategoryIdTranslationsGet200ResponseInner] instance.
  ApiServiceCategoriesCategoryIdTranslationsGet200ResponseInner({
    this.lang,
    this.text,
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? lang;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? text;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiServiceCategoriesCategoryIdTranslationsGet200ResponseInner &&
    other.lang == lang &&
    other.text == text;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (lang == null ? 0 : lang!.hashCode) +
    (text == null ? 0 : text!.hashCode);

  @override
  String toString() => 'ApiServiceCategoriesCategoryIdTranslationsGet200ResponseInner[lang=$lang, text=$text]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.lang != null) {
      json[r'lang'] = this.lang;
    } else {
      json[r'lang'] = null;
    }
    if (this.text != null) {
      json[r'text'] = this.text;
    } else {
      json[r'text'] = null;
    }
    return json;
  }

  /// Returns a new [ApiServiceCategoriesCategoryIdTranslationsGet200ResponseInner] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiServiceCategoriesCategoryIdTranslationsGet200ResponseInner? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ApiServiceCategoriesCategoryIdTranslationsGet200ResponseInner(
        lang: mapValueOfType<String>(json, r'lang'),
        text: mapValueOfType<String>(json, r'text'),
      );
    }
    return null;
  }

  static List<ApiServiceCategoriesCategoryIdTranslationsGet200ResponseInner> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiServiceCategoriesCategoryIdTranslationsGet200ResponseInner>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiServiceCategoriesCategoryIdTranslationsGet200ResponseInner.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiServiceCategoriesCategoryIdTranslationsGet200ResponseInner> mapFromJson(dynamic json) {
    final map = <String, ApiServiceCategoriesCategoryIdTranslationsGet200ResponseInner>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiServiceCategoriesCategoryIdTranslationsGet200ResponseInner.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiServiceCategoriesCategoryIdTranslationsGet200ResponseInner-objects as value to a dart map
  static Map<String, List<ApiServiceCategoriesCategoryIdTranslationsGet200ResponseInner>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiServiceCategoriesCategoryIdTranslationsGet200ResponseInner>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiServiceCategoriesCategoryIdTranslationsGet200ResponseInner.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

