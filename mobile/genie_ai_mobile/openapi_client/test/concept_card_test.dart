//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

import 'package:openapi/api.dart';
import 'package:test/test.dart';

// tests for ConceptCard
void main() {
  // final instance = ConceptCard();

  group('test ConceptCard', () {
    // String repoId
    test('to test the property `repoId`', () async {
      // TODO
    });

    // String conceptId
    test('to test the property `conceptId`', () async {
      // TODO
    });

    // String graphName
    test('to test the property `graphName`', () async {
      // TODO
    });

    // String bundleVersion
    test('to test the property `bundleVersion`', () async {
      // TODO
    });

    // String title
    test('to test the property `title`', () async {
      // TODO
    });

    // List<String> labels (default value: const [])
    test('to test the property `labels`', () async {
      // TODO
    });

    // String summary
    test('to test the property `summary`', () async {
      // TODO
    });

    // The concept document body — markdown, never raw HTML.
    // String body
    test('to test the property `body`', () async {
      // TODO
    });

    // Outgoing author links as SERVED — the meta row's field copied verbatim, so rows carry the author-link OBJECT shape ({to_concept_id, label}; legacy rows may carry {target, label} with a .md path). NOT a bare-string array: the 2026-11-19 mobile crash was exactly this lie (the generated Dart client cast the object row to String and threw mid-render).
    // List<ConceptCardLink> links (default value: const [])
    test('to test the property `links`', () async {
      // TODO
    });

    // CAP-4 originating-document identities.
    // List<ConceptCardSource> sources (default value: const [])
    test('to test the property `sources`', () async {
      // TODO
    });


  });

}
