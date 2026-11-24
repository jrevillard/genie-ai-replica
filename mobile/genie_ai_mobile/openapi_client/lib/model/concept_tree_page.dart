//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ConceptTreePage {
  /// Returns a new [ConceptTreePage] instance.
  ConceptTreePage({
    required this.total,
    required this.offset,
    required this.limit,
    this.concepts = const [],
  });

  /// Total concept count, independent of paging.
  int total;

  int offset;

  int limit;

  List<ConceptTreeRow> concepts;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ConceptTreePage &&
    other.total == total &&
    other.offset == offset &&
    other.limit == limit &&
    _deepEquality.equals(other.concepts, concepts);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (total.hashCode) +
    (offset.hashCode) +
    (limit.hashCode) +
    (concepts.hashCode);

  @override
  String toString() => 'ConceptTreePage[total=$total, offset=$offset, limit=$limit, concepts=$concepts]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'total'] = this.total;
      json[r'offset'] = this.offset;
      json[r'limit'] = this.limit;
      json[r'concepts'] = this.concepts;
    return json;
  }

  /// Returns a new [ConceptTreePage] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ConceptTreePage? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        assert(json.containsKey(r'total'), 'Required key "ConceptTreePage[total]" is missing from JSON.');
        assert(json[r'total'] != null, 'Required key "ConceptTreePage[total]" has a null value in JSON.');
        assert(json.containsKey(r'offset'), 'Required key "ConceptTreePage[offset]" is missing from JSON.');
        assert(json[r'offset'] != null, 'Required key "ConceptTreePage[offset]" has a null value in JSON.');
        assert(json.containsKey(r'limit'), 'Required key "ConceptTreePage[limit]" is missing from JSON.');
        assert(json[r'limit'] != null, 'Required key "ConceptTreePage[limit]" has a null value in JSON.');
        assert(json.containsKey(r'concepts'), 'Required key "ConceptTreePage[concepts]" is missing from JSON.');
        assert(json[r'concepts'] != null, 'Required key "ConceptTreePage[concepts]" has a null value in JSON.');
        return true;
      }());

      return ConceptTreePage(
        total: mapValueOfType<int>(json, r'total')!,
        offset: mapValueOfType<int>(json, r'offset')!,
        limit: mapValueOfType<int>(json, r'limit')!,
        concepts: ConceptTreeRow.listFromJson(json[r'concepts']),
      );
    }
    return null;
  }

  static List<ConceptTreePage> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ConceptTreePage>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ConceptTreePage.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ConceptTreePage> mapFromJson(dynamic json) {
    final map = <String, ConceptTreePage>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ConceptTreePage.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ConceptTreePage-objects as value to a dart map
  static Map<String, List<ConceptTreePage>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ConceptTreePage>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ConceptTreePage.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'total',
    'offset',
    'limit',
    'concepts',
  };
}

