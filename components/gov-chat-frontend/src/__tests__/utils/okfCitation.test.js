'use strict';

const { isOkfConceptSource, okfConceptBadge, OKF_CONCEPT_SOURCE } = require('../../utils/okfCitation');

describe('okfCitation', () => {
  it('names the marker chatqna puts on an OKF-sourced citation', () => {
    expect(OKF_CONCEPT_SOURCE).toBe('okf-concept');
  });

  it('recognises the marker', () => {
    expect(isOkfConceptSource({ source: 'okf-concept' })).toBe(true);
  });

  it('recognises the raw streamed shape and the mapped shape alike', () => {
    // RAW — snake_case, as chatqna sends it.
    expect(isOkfConceptSource({ document_id: 'hadith-nawawi-36', concept_id: 'hadith-nawawi-36' })).toBe(true);
    // MAPPED — camelCase, what the store passes around.
    expect(isOkfConceptSource({ id: 'hadith-nawawi-36', conceptId: 'hadith-nawawi-36' })).toBe(true);
  });

  it('never mistakes a repository document for a concept', () => {
    expect(isOkfConceptSource(null)).toBe(false);
    expect(isOkfConceptSource(undefined)).toBe(false);
    expect(isOkfConceptSource({ id: 'doc-1', title: 'Guide' })).toBe(false);
    expect(isOkfConceptSource({ source: null, conceptId: null })).toBe(false);
    // An empty concept id is not a concept.
    expect(isOkfConceptSource({ concept_id: '' })).toBe(false);
  });

  it('badges the family, not a file extension', () => {
    expect(okfConceptBadge()).toEqual({ label: 'OKF', tone: 'accent' });
  });
});
