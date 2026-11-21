import 'package:flutter_test/flutter_test.dart';
import 'package:openapi/api.dart';

/// The live concept-card contract the mobile browser depends on (#1939):
/// the OKF server serves `links` as author-link OBJECTS
/// (`{to_concept_id, label}` — the shape the link-accept route writes), not
/// the strings the old spec declared. The generated client crashed on the
/// first object element (`_Map<String, dynamic> is not a subtype of String`)
/// and took the whole card render down — this pins the parse against the
/// exact payload a serving repo answers (f9e08ce2, 2026-11-19 probe).
void main() {
  test('ConceptCard parses object author links as served by okf-server', () {
    final card = ConceptCard.fromJson({
      'repo_id': 'f9e08ce2-ddb4-4654-b59e-a27fdabfcb70',
      'concept_id': '50-years-of-solar-system-exploration-tagged-sec19-part-4',
      'graph_name': 'OKF_solar-system_v1',
      'bundle_version': null,
      'title': '50 Years of Solar System Exploration — part 4',
      'labels': ['Voyager'],
      'summary': 'Naugle and the out-of-ecliptic tension.',
      'body': '# Body\nmarkdown',
      'links': [
        {
          'to_concept_id':
              '50-years-of-solar-system-exploration-tagged-sec19-part-2',
          'label': 'Voyager 1 Saturn Encounter',
        },
      ],
      'sources': <Map<String, dynamic>>[],
    });

    expect(card, isNotNull);
    expect(
      card!.conceptId,
      '50-years-of-solar-system-exploration-tagged-sec19-part-4',
    );
    expect(card.links, hasLength(1));
    final link = card.links.single;
    expect(
      link.toConceptId,
      '50-years-of-solar-system-exploration-tagged-sec19-part-2',
    );
    expect(link.label, 'Voyager 1 Saturn Encounter');
  });

  test('ConceptCard tolerates the legacy frontmatter link shape', () {
    final card = ConceptCard.fromJson({
      'repo_id': 'r1',
      'concept_id': 'c1',
      'title': 'T',
      'links': [
        {'target': 'other-concept.md', 'label': 'Other'},
      ],
    });

    expect(card, isNotNull);
    final link = card!.links.single;
    expect(link.target, 'other-concept.md');
    expect(link.label, 'Other');
  });

  test('ConceptCard keeps parsing when a link row lacks every field', () {
    final card = ConceptCard.fromJson({
      'repo_id': 'r1',
      'concept_id': 'c1',
      'title': 'T',
      'links': <Map<String, dynamic>>[<String, dynamic>{}],
    });

    expect(card, isNotNull);
    expect(card!.links, hasLength(1));
  });
}
