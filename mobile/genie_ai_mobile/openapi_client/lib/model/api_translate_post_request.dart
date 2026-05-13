//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ApiTranslatePostRequest {
  /// Returns a new [ApiTranslatePostRequest] instance.
  ApiTranslatePostRequest({
    this.texts = const [],
    required this.sourceLang,
    required this.targetLang,
  });

  /// An array of text strings to be translated.
  List<String> texts;

  /// The source language code (e.g., 'en', 'fr').
  String sourceLang;

  /// The target language code (e.g., 'fr', 'de', 'zh').
  String targetLang;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ApiTranslatePostRequest &&
    _deepEquality.equals(other.texts, texts) &&
    other.sourceLang == sourceLang &&
    other.targetLang == targetLang;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (texts.hashCode) +
    (sourceLang.hashCode) +
    (targetLang.hashCode);

  @override
  String toString() => 'ApiTranslatePostRequest[texts=$texts, sourceLang=$sourceLang, targetLang=$targetLang]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'texts'] = this.texts;
      json[r'source_lang'] = this.sourceLang;
      json[r'target_lang'] = this.targetLang;
    return json;
  }

  /// Returns a new [ApiTranslatePostRequest] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ApiTranslatePostRequest? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        assert(json.containsKey(r'texts'), 'Required key "ApiTranslatePostRequest[texts]" is missing from JSON.');
        assert(json[r'texts'] != null, 'Required key "ApiTranslatePostRequest[texts]" has a null value in JSON.');
        assert(json.containsKey(r'source_lang'), 'Required key "ApiTranslatePostRequest[source_lang]" is missing from JSON.');
        assert(json[r'source_lang'] != null, 'Required key "ApiTranslatePostRequest[source_lang]" has a null value in JSON.');
        assert(json.containsKey(r'target_lang'), 'Required key "ApiTranslatePostRequest[target_lang]" is missing from JSON.');
        assert(json[r'target_lang'] != null, 'Required key "ApiTranslatePostRequest[target_lang]" has a null value in JSON.');
        return true;
      }());

      return ApiTranslatePostRequest(
        texts: json[r'texts'] is Iterable
            ? (json[r'texts'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        sourceLang: mapValueOfType<String>(json, r'source_lang')!,
        targetLang: mapValueOfType<String>(json, r'target_lang')!,
      );
    }
    return null;
  }

  static List<ApiTranslatePostRequest> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ApiTranslatePostRequest>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ApiTranslatePostRequest.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ApiTranslatePostRequest> mapFromJson(dynamic json) {
    final map = <String, ApiTranslatePostRequest>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ApiTranslatePostRequest.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ApiTranslatePostRequest-objects as value to a dart map
  static Map<String, List<ApiTranslatePostRequest>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ApiTranslatePostRequest>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ApiTranslatePostRequest.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'texts',
    'source_lang',
    'target_lang',
  };
}

