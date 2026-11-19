import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/okf/okf_citation.dart';

void main() {
  group('isOkfConceptSource', () {
    test('raw chatqna shape with the okf-concept marker is an okf source', () {
      final doc = <String, dynamic>{
        'document_id': 'hadith-nawawi-36',
        'document_name': 'hadith nawawi 36',
        'url': '',
        'score': 0.42,
        'concept_id': 'hadith-nawawi-36',
        'source': 'okf-concept',
        'repo_id': 'ragas-venue-seed',
      };
      expect(isOkfConceptSource(doc), isTrue);
    });

    test('raw shape without the marker but with concept_id is an okf source', () {
      final doc = <String, dynamic>{
        'document_id': 'doc-x',
        'concept_id': 'doc-x',
      };
      expect(isOkfConceptSource(doc), isTrue);
    });

    test('mapped camelCase shape with conceptId is an okf source', () {
      final doc = <String, dynamic>{
        'id': 'doc-x',
        'title': 'Doc X',
        'conceptId': 'doc-x',
        'repoId': 'some-repo',
      };
      expect(isOkfConceptSource(doc), isTrue);
    });

    test('a plain document row is not an okf source', () {
      final doc = <String, dynamic>{
        'document_id': 'report.pdf',
        'document_name': 'report.pdf',
        'url': '/api/files/report.pdf/download',
        'score': 0.9,
      };
      expect(isOkfConceptSource(doc), isFalse);
    });

    test('null and empty docs are not okf sources', () {
      expect(isOkfConceptSource(null), isFalse);
      expect(isOkfConceptSource(<String, dynamic>{}), isFalse);
    });
  });

  group('canBrowseSource', () {
    test('okf row with repo + concept identity is browsable (both shapes)', () {
      expect(
        canBrowseSource(<String, dynamic>{
          'source': 'okf-concept',
          'concept_id': 'c1',
          'repo_id': 'r1',
        }),
        isTrue,
      );
      expect(
        canBrowseSource(<String, dynamic>{
          'conceptId': 'c1',
          'repoId': 'r1',
        }),
        isTrue,
      );
    });

    test('okf row without repo identity is not browsable (pre-CAP-1)', () {
      expect(
        canBrowseSource(<String, dynamic>{
          'source': 'okf-concept',
          'concept_id': 'c1',
        }),
        isFalse,
      );
    });

    test('okf row without concept id is not browsable', () {
      expect(
        canBrowseSource(<String, dynamic>{
          'source': 'okf-concept',
          'repo_id': 'r1',
        }),
        isFalse,
      );
    });

    test('a plain document row is never browsable', () {
      expect(
        canBrowseSource(<String, dynamic>{
          'document_id': 'report.pdf',
          'url': '/api/files/report.pdf/download',
        }),
        isFalse,
      );
    });
  });

  group('sourceBadge', () {
    test('an okf concept badges as OKF/accent (never an extension fallback)', () {
      final badge = sourceBadge(<String, dynamic>{
        'source': 'okf-concept',
        'document_name': 'hadith nawawi 36',
        'concept_id': 'hadith-nawawi-36',
      });
      expect(badge.label, 'OKF');
      expect(badge.tone, 'accent');
    });

    test('a document with an extension badges by extension', () {
      final badge = sourceBadge(<String, dynamic>{
        'document_name': 'annual-report.pdf',
        'url': '/api/files/annual-report.pdf/download',
      });
      expect(badge.label, 'PDF');
    });

    test('an extensionless document gets a generic file badge', () {
      final badge = sourceBadge(<String, dynamic>{
        'document_name': 'hadith nawawi 36',
        'url': '/api/files/xyz/download',
      });
      expect(badge.label, isNotEmpty);
      expect(badge.label, isNot('hadi'));
    });
  });

  group('shape-tolerant getters', () {
    test('citationRepoId reads repo_id and repoId', () {
      expect(
        citationRepoId(<String, dynamic>{'repo_id': 'r1'}),
        'r1',
      );
      expect(
        citationRepoId(<String, dynamic>{'repoId': 'r2'}),
        'r2',
      );
      expect(citationRepoId(<String, dynamic>{}), isNull);
    });

    test('citationConceptId reads concept_id, conceptId and id/document_id', () {
      expect(
        citationConceptId(<String, dynamic>{'concept_id': 'c1'}),
        'c1',
      );
      expect(
        citationConceptId(<String, dynamic>{'conceptId': 'c2'}),
        'c2',
      );
      expect(
        citationConceptId(<String, dynamic>{'id': 'c3'}),
        'c3',
      );
      expect(
        citationConceptId(<String, dynamic>{'document_id': 'c4'}),
        'c4',
      );
    });

    test('sourceTitle reads document_name then document_id then title', () {
      expect(
        sourceTitle(<String, dynamic>{'document_name': 'Nawawi 36'}),
        'Nawawi 36',
      );
      expect(
        sourceTitle(<String, dynamic>{'document_id': 'nawawi-36'}),
        'nawawi-36',
      );
      expect(
        sourceTitle(<String, dynamic>{'title': 'Nawawi'}),
        'Nawawi',
      );
    });
  });
}
