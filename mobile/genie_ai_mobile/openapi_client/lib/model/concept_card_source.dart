//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ConceptCardSource {
  /// Returns a new [ConceptCardSource] instance.
  ConceptCardSource({
    this.kind,
    this.fileId,
    this.fileName,
    this.resource,
    this.missing,
  });

  String? kind;

  String? fileId;

  String? fileName;

  String? resource;

  bool? missing;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ConceptCardSource &&
    other.kind == kind &&
    other.fileId == fileId &&
    other.fileName == fileName &&
    other.resource == resource &&
    other.missing == missing;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (kind == null ? 0 : kind!.hashCode) +
    (fileId == null ? 0 : fileId!.hashCode) +
    (fileName == null ? 0 : fileName!.hashCode) +
    (resource == null ? 0 : resource!.hashCode) +
    (missing == null ? 0 : missing!.hashCode);

  @override
  String toString() => 'ConceptCardSource[kind=$kind, fileId=$fileId, fileName=$fileName, resource=$resource, missing=$missing]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.kind != null) {
      json[r'kind'] = this.kind;
    } else {
      json[r'kind'] = null;
    }
    if (this.fileId != null) {
      json[r'file_id'] = this.fileId;
    } else {
      json[r'file_id'] = null;
    }
    if (this.fileName != null) {
      json[r'file_name'] = this.fileName;
    } else {
      json[r'file_name'] = null;
    }
    if (this.resource != null) {
      json[r'resource'] = this.resource;
    } else {
      json[r'resource'] = null;
    }
    if (this.missing != null) {
      json[r'missing'] = this.missing;
    } else {
      json[r'missing'] = null;
    }
    return json;
  }

  /// Returns a new [ConceptCardSource] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ConceptCardSource? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return ConceptCardSource(
        kind: mapValueOfType<String>(json, r'kind'),
        fileId: mapValueOfType<String>(json, r'file_id'),
        fileName: mapValueOfType<String>(json, r'file_name'),
        resource: mapValueOfType<String>(json, r'resource'),
        missing: mapValueOfType<bool>(json, r'missing'),
      );
    }
    return null;
  }

  static List<ConceptCardSource> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ConceptCardSource>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ConceptCardSource.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ConceptCardSource> mapFromJson(dynamic json) {
    final map = <String, ConceptCardSource>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ConceptCardSource.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ConceptCardSource-objects as value to a dart map
  static Map<String, List<ConceptCardSource>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ConceptCardSource>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ConceptCardSource.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

