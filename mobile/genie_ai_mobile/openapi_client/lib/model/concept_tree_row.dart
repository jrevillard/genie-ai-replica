//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ConceptTreeRow {
  /// Returns a new [ConceptTreeRow] instance.
  ConceptTreeRow({
    required this.conceptId,
    this.title,
    this.isIndex,
    this.indexStatus,
    this.links = const [],
  });

  String conceptId;

  String? title;

  /// Index/root marker for the tree's bold rows.
  bool? isIndex;

  /// Graph drain status the status dot renders.
  String? indexStatus;

  /// Outgoing author links, as concept ids.
  List<String> links;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ConceptTreeRow &&
    other.conceptId == conceptId &&
    other.title == title &&
    other.isIndex == isIndex &&
    other.indexStatus == indexStatus &&
    _deepEquality.equals(other.links, links);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (conceptId.hashCode) +
    (title == null ? 0 : title!.hashCode) +
    (isIndex == null ? 0 : isIndex!.hashCode) +
    (indexStatus == null ? 0 : indexStatus!.hashCode) +
    (links.hashCode);

  @override
  String toString() => 'ConceptTreeRow[conceptId=$conceptId, title=$title, isIndex=$isIndex, indexStatus=$indexStatus, links=$links]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'concept_id'] = this.conceptId;
    if (this.title != null) {
      json[r'title'] = this.title;
    } else {
      json[r'title'] = null;
    }
    if (this.isIndex != null) {
      json[r'is_index'] = this.isIndex;
    } else {
      json[r'is_index'] = null;
    }
    if (this.indexStatus != null) {
      json[r'index_status'] = this.indexStatus;
    } else {
      json[r'index_status'] = null;
    }
      json[r'links'] = this.links;
    return json;
  }

  /// Returns a new [ConceptTreeRow] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ConceptTreeRow? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        assert(json.containsKey(r'concept_id'), 'Required key "ConceptTreeRow[concept_id]" is missing from JSON.');
        assert(json[r'concept_id'] != null, 'Required key "ConceptTreeRow[concept_id]" has a null value in JSON.');
        return true;
      }());

      return ConceptTreeRow(
        conceptId: mapValueOfType<String>(json, r'concept_id')!,
        title: mapValueOfType<String>(json, r'title'),
        isIndex: mapValueOfType<bool>(json, r'is_index'),
        indexStatus: mapValueOfType<String>(json, r'index_status'),
        links: json[r'links'] is Iterable
            ? (json[r'links'] as Iterable).cast<String>().toList(growable: false)
            : const [],
      );
    }
    return null;
  }

  static List<ConceptTreeRow> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ConceptTreeRow>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ConceptTreeRow.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ConceptTreeRow> mapFromJson(dynamic json) {
    final map = <String, ConceptTreeRow>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ConceptTreeRow.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ConceptTreeRow-objects as value to a dart map
  static Map<String, List<ConceptTreeRow>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ConceptTreeRow>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ConceptTreeRow.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'concept_id',
  };
}

