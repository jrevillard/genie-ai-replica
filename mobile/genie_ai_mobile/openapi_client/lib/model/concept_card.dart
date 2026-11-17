//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ConceptCard {
  /// Returns a new [ConceptCard] instance.
  ConceptCard({
    required this.repoId,
    required this.conceptId,
    this.graphName,
    this.bundleVersion,
    required this.title,
    this.labels = const [],
    this.summary,
    this.body,
    this.links = const [],
    this.sources = const [],
  });

  String repoId;

  String conceptId;

  String? graphName;

  String? bundleVersion;

  String title;

  List<String> labels;

  String? summary;

  /// The concept document body — markdown, never raw HTML.
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? body;

  /// Outgoing author links, as concept ids.
  List<String> links;

  /// CAP-4 originating-document identities.
  List<ConceptCardSource> sources;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ConceptCard &&
    other.repoId == repoId &&
    other.conceptId == conceptId &&
    other.graphName == graphName &&
    other.bundleVersion == bundleVersion &&
    other.title == title &&
    _deepEquality.equals(other.labels, labels) &&
    other.summary == summary &&
    other.body == body &&
    _deepEquality.equals(other.links, links) &&
    _deepEquality.equals(other.sources, sources);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (repoId.hashCode) +
    (conceptId.hashCode) +
    (graphName == null ? 0 : graphName!.hashCode) +
    (bundleVersion == null ? 0 : bundleVersion!.hashCode) +
    (title.hashCode) +
    (labels.hashCode) +
    (summary == null ? 0 : summary!.hashCode) +
    (body == null ? 0 : body!.hashCode) +
    (links.hashCode) +
    (sources.hashCode);

  @override
  String toString() => 'ConceptCard[repoId=$repoId, conceptId=$conceptId, graphName=$graphName, bundleVersion=$bundleVersion, title=$title, labels=$labels, summary=$summary, body=$body, links=$links, sources=$sources]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'repo_id'] = this.repoId;
      json[r'concept_id'] = this.conceptId;
    if (this.graphName != null) {
      json[r'graph_name'] = this.graphName;
    } else {
      json[r'graph_name'] = null;
    }
    if (this.bundleVersion != null) {
      json[r'bundle_version'] = this.bundleVersion;
    } else {
      json[r'bundle_version'] = null;
    }
      json[r'title'] = this.title;
      json[r'labels'] = this.labels;
    if (this.summary != null) {
      json[r'summary'] = this.summary;
    } else {
      json[r'summary'] = null;
    }
    if (this.body != null) {
      json[r'body'] = this.body;
    } else {
      json[r'body'] = null;
    }
      json[r'links'] = this.links;
      json[r'sources'] = this.sources;
    return json;
  }

  /// Returns a new [ConceptCard] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ConceptCard? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        assert(json.containsKey(r'repo_id'), 'Required key "ConceptCard[repo_id]" is missing from JSON.');
        assert(json[r'repo_id'] != null, 'Required key "ConceptCard[repo_id]" has a null value in JSON.');
        assert(json.containsKey(r'concept_id'), 'Required key "ConceptCard[concept_id]" is missing from JSON.');
        assert(json[r'concept_id'] != null, 'Required key "ConceptCard[concept_id]" has a null value in JSON.');
        assert(json.containsKey(r'title'), 'Required key "ConceptCard[title]" is missing from JSON.');
        assert(json[r'title'] != null, 'Required key "ConceptCard[title]" has a null value in JSON.');
        return true;
      }());

      return ConceptCard(
        repoId: mapValueOfType<String>(json, r'repo_id')!,
        conceptId: mapValueOfType<String>(json, r'concept_id')!,
        graphName: mapValueOfType<String>(json, r'graph_name'),
        bundleVersion: mapValueOfType<String>(json, r'bundle_version'),
        title: mapValueOfType<String>(json, r'title')!,
        labels: json[r'labels'] is Iterable
            ? (json[r'labels'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        summary: mapValueOfType<String>(json, r'summary'),
        body: mapValueOfType<String>(json, r'body'),
        links: json[r'links'] is Iterable
            ? (json[r'links'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        sources: ConceptCardSource.listFromJson(json[r'sources']),
      );
    }
    return null;
  }

  static List<ConceptCard> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ConceptCard>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ConceptCard.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ConceptCard> mapFromJson(dynamic json) {
    final map = <String, ConceptCard>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ConceptCard.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ConceptCard-objects as value to a dart map
  static Map<String, List<ConceptCard>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ConceptCard>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ConceptCard.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'repo_id',
    'concept_id',
    'title',
  };
}

