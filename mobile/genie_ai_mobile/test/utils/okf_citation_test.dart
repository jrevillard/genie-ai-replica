import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/utils/okf_citation.dart';

/// The OKF-concept citation identity (issue #2069): the mobile twin of the
/// web's `isOkfConceptSource` / `translateSources` branch. A concept row is
/// NOT a repository document — it resolves through okf-server.
void main() {
  group('isOkfConceptCitation', () {
    test('a raw chatqna citation is a concept row', () {
      expect(
        isOkfConceptCitation({
          'source': 'okf-concept',
          'document_id': 'hadith_nawawi_36',
          'document_name': 'hadith nawawi 36',
          'concept_id': 'hadith_nawawi_36',
          'repo_id': 'repo-1',
          'url': '',
        }),
        isTrue,
      );
    });

    test('a translated row (camelCase) is a concept row', () {
      expect(
        isOkfConceptCitation({
          'source': 'okf-concept',
          'id': 'hadith_nawawi_36',
          'conceptId': 'hadith_nawawi_36',
          'repoId': 'repo-1',
        }),
        isTrue,
      );
    });

    test('a row that names a concept id is a concept row', () {
      expect(isOkfConceptCitation({'concept_id': 'hadith_nawawi_36'}), isTrue);
    });

    test('a legacy document row is not a concept row', () {
      expect(
        isOkfConceptCitation({
          'document_id': 'doc-9',
          'document_name': 'Report.pdf',
          'score': 0.8,
        }),
        isFalse,
      );
    });

    test('an empty row is not a concept row', () {
      expect(isOkfConceptCitation({}), isFalse);
    });
  });

  group('the open key', () {
    test(
      'tells two repositories apart — the same concept id can live in both',
      () {
        final String first = okfConceptRef({
          'source': 'okf-concept',
          'concept_id': 'hadith_nawawi_36',
          'repo_id': 'repo-1',
        })!.openKey;
        final String second = okfConceptRef({
          'source': 'okf-concept',
          'concept_id': 'hadith_nawawi_36',
          'repo_id': 'repo-2',
        })!.openKey;
        expect(first, isNot(second));
      },
    );

    test('a legacy document row names no concept', () {
      expect(
        okfConceptRef({
          'document_id': 'hadith_nawawi_36',
          'document_name': 'Report.pdf',
        }),
        isNull,
      );
    });
  });

  group('okfConceptRef', () {
    test('reads the stable ids', () {
      final ref = okfConceptRef({
        'source': 'okf-concept',
        'concept_id': 'hadith_nawawi_36',
        'repo_id': 'repo-1',
        'bundle_version': 3,
      });
      expect(ref, isNotNull);
      expect(ref!.conceptId, 'hadith_nawawi_36');
      expect(ref.repoId, 'repo-1');
    });

    test('the concept id falls back to the citation document id', () {
      final ref = okfConceptRef({
        'source': 'okf-concept',
        'document_id': 'hadith_nawawi_36',
        'repo_id': 'repo-1',
      });
      expect(ref!.conceptId, 'hadith_nawawi_36');
    });

    test('a citation without a repo id reports it as absent', () {
      final ref = okfConceptRef({
        'source': 'okf-concept',
        'concept_id': 'hadith_nawawi_36',
      });
      expect(ref!.repoId, '');
    });

    test('a row that names no concept has no reference', () {
      expect(okfConceptRef({'source': 'okf-concept'}), isNull);
    });
  });
}
