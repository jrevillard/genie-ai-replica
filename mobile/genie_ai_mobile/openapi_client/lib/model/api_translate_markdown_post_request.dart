//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiTranslateMarkdownPostRequest {
  /// Returns a new [ApiTranslateMarkdownPostRequest] instance.
  ApiTranslateMarkdownPostRequest({
    required this.markdown,
    required this.sourceLang,
    required this.targetLang,
  });

  /// The markdown content to be translated.
  String markdown;

  /// The source language code (e.g., 'en', 'fr').
  String sourceLang;

  /// The target language code (e.g., 'fr', 'de', 'zh').
  String targetLang;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiTranslateMarkdownPostRequest &&
    other.markdown == markdown &&
    other.sourceLang == sourceLang &&
    other.targetLang == targetLang;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (markdown.hashCode) +
    (sourceLang.hashCode) +
    (targetLang.hashCode);

  @override
  String toString() => 'ApiTranslateMarkdownPostRequest[markdown=$markdown, sourceLang=$sourceLang, targetLang=$targetLang]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'markdown'] = this.markdown;
      json[r'source_lang'] = this.sourceLang;
      json[r'target_lang'] = this.targetLang;
    return json;
  }

  /// Returns a new [ApiTranslateMarkdownPostRequest] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiTranslateMarkdownPostRequest? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        assert(json.containsKey(r'markdown'), 'Required key "ApiTranslateMarkdownPostRequest[markdown]" is missing from JSON.');
        assert(json[r'markdown'] != null, 'Required key "ApiTranslateMarkdownPostRequest[markdown]" has a null value in JSON.');
        assert(json.containsKey(r'source_lang'), 'Required key "ApiTranslateMarkdownPostRequest[source_lang]" is missing from JSON.');
        assert(json[r'source_lang'] != null, 'Required key "ApiTranslateMarkdownPostRequest[source_lang]" has a null value in JSON.');
        assert(json.containsKey(r'target_lang'), 'Required key "ApiTranslateMarkdownPostRequest[target_lang]" is missing from JSON.');
        assert(json[r'target_lang'] != null, 'Required key "ApiTranslateMarkdownPostRequest[target_lang]" has a null value in JSON.');
        return true;
      }());

      return ApiTranslateMarkdownPostRequest(
        markdown: mapValueOfType<String>(json, r'markdown')!,
        sourceLang: mapValueOfType<String>(json, r'source_lang')!,
        targetLang: mapValueOfType<String>(json, r'target_lang')!,
      );
    }
    return null;
  }

  static List<ApiTranslateMarkdownPostRequest> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiTranslateMarkdownPostRequest>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiTranslateMarkdownPostRequest.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiTranslateMarkdownPostRequest> mapFromJson(dynamic json) {
    final map = <String, ApiTranslateMarkdownPostRequest>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiTranslateMarkdownPostRequest.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiTranslateMarkdownPostRequest-objects as value to a dart map
  static Map<String, List<ApiTranslateMarkdownPostRequest>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiTranslateMarkdownPostRequest>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiTranslateMarkdownPostRequest.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'markdown',
    'source_lang',
    'target_lang',
  };
}

