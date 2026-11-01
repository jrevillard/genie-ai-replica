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

// tests for QueryContext
void main() {
  // final instance = QueryContext();

  group('test QueryContext', () {
    // The ENGLISH label of the category — the SSOT every filter label is spoken in (the hierarchy's own `nameEN`). It is forwarded to the retriever as is: a label that matches no chunk scopes the query to nothing.
    // String categoryLabel
    test('to test the property `categoryLabel`', () async {
      // TODO
    });

    // The legacy PLURAL spelling of categoryLabel (the upstream OPEA field). Honoured like the singular when present; a bare string is read as ONE label. Clients of this API should send the singular.
    // List<String> categoryLabels (default value: const [])
    test('to test the property `categoryLabels`', () async {
      // TODO
    });

    // ENGLISH service labels. A bare string is also accepted and read as ONE label (never as a sequence of characters, never as an empty scope).
    // List<String> serviceLabels (default value: const [])
    test('to test the property `serviceLabels`', () async {
      // TODO
    });

    // String language (default value: 'EN')
    test('to test the property `language`', () async {
      // TODO
    });


  });

}
