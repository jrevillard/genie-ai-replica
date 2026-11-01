//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class QueryContext {
  /// Returns a new [QueryContext] instance.
  QueryContext({
    this.categoryLabel,
    this.categoryLabels = const [],
    this.serviceLabels = const [],
    this.language = 'EN',
  });

  /// The ENGLISH label of the category — the SSOT every filter label is spoken in (the hierarchy's own `nameEN`). It is forwarded to the retriever as is: a label that matches no chunk scopes the query to nothing.
  String? categoryLabel;

  /// The legacy PLURAL spelling of categoryLabel (the upstream OPEA field). Honoured like the singular when present; a bare string is read as ONE label. Clients of this API should send the singular.
  List<String> categoryLabels;

  /// ENGLISH service labels. A bare string is also accepted and read as ONE label (never as a sequence of characters, never as an empty scope).
  List<String> serviceLabels;

  String language;

  @override
  bool operator ==(Object other) => identical(this, other) || other is QueryContext &&
    other.categoryLabel == categoryLabel &&
    _deepEquality.equals(other.categoryLabels, categoryLabels) &&
    _deepEquality.equals(other.serviceLabels, serviceLabels) &&
    other.language == language;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (categoryLabel == null ? 0 : categoryLabel!.hashCode) +
    (categoryLabels.hashCode) +
    (serviceLabels.hashCode) +
    (language.hashCode);

  @override
  String toString() => 'QueryContext[categoryLabel=$categoryLabel, categoryLabels=$categoryLabels, serviceLabels=$serviceLabels, language=$language]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.categoryLabel != null) {
      json[r'categoryLabel'] = this.categoryLabel;
    } else {
      json[r'categoryLabel'] = null;
    }
      json[r'categoryLabels'] = this.categoryLabels;
      json[r'serviceLabels'] = this.serviceLabels;
      json[r'language'] = this.language;
    return json;
  }

  /// Returns a new [QueryContext] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static QueryContext? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return QueryContext(
        categoryLabel: mapValueOfType<String>(json, r'categoryLabel'),
        categoryLabels: json[r'categoryLabels'] is Iterable
            ? (json[r'categoryLabels'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        serviceLabels: json[r'serviceLabels'] is Iterable
            ? (json[r'serviceLabels'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        language: mapValueOfType<String>(json, r'language') ?? 'EN',
      );
    }
    return null;
  }

  static List<QueryContext> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <QueryContext>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = QueryContext.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, QueryContext> mapFromJson(dynamic json) {
    final map = <String, QueryContext>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = QueryContext.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of QueryContext-objects as value to a dart map
  static Map<String, List<QueryContext>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<QueryContext>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = QueryContext.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

