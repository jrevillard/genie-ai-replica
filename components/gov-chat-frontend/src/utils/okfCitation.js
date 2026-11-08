// src/utils/okfCitation.js — the OKF-concept citation marker.
//
// chatqna's citation assembler emits an OKF-sourced citation with a
// `source: 'okf-concept'` marker, the concept slug as its `document_id`, a
// human `document_name` and the `concept_id` — because the doc-repo metadata
// lookup for such a chunk FAILS BY DESIGN: an OKF concept is not a
// repository file (content-only chunking — the concept's markdown never
// becomes a doc-repo `files` doc).
//
// The marker is therefore the ONLY thing that separates "look me up in
// doc-repo" from "I AM a concept". The frontend used to throw it away: the
// store mapped every citation to the same shape and then asked doc-repo for
// each one's metadata, which 404s once per cited concept on every
// OKF-citing query.
//
// One predicate, both call sites (the store's fetch guard and the source
// card's badge): a guard that skipped the lookup while the card still
// rendered a file-extension badge would be two truths about one citation.

/** The marker chatqna puts on an OKF-sourced citation. */
export const OKF_CONCEPT_SOURCE = 'okf-concept';

/**
 * Whether a citation is an OKF concept rather than a repository document.
 *
 * Two shapes are accepted, because two callers hold two shapes: the RAW
 * streamed citation (snake_case, as chatqna sends it) and the MAPPED source
 * the store works with (camelCase). A caller must not have to know which
 * one it is holding.
 *
 * @param {Object} doc a raw citation or a mapped source
 * @returns {Boolean}
 */
export function isOkfConceptSource(doc) {
  if (!doc) return false;
  if (doc.source === OKF_CONCEPT_SOURCE) return true;
  return Boolean(doc.conceptId || doc.concept_id);
}

/**
 * The badge of an OKF citation.
 *
 * An OKF concept has no file extension and no size, so the extension
 * fallback (`fileTypeBadge`) would render the first four characters of its
 * name — "HADI" for "hadith nawawi 36". The badge names the FAMILY instead,
 * which is the thing the citation actually is.
 *
 * @returns {{label: String, tone: String}}
 */
export function okfConceptBadge() {
  return { label: 'OKF', tone: 'accent' };
}

/**
 * W9 (concept tree browse): whether a citation may render the browse
 * affordance — a WORKING okf-concept row with repo identity. A pre-CAP-1
 * row (no repoId) or a legacy document gets no affordance anywhere, so the
 * entry is never dead. ONE definition for BOTH chat surfaces (review r0:
 * the answer-card grid and the sidebar cannot drift).
 *
 * @param {Object} doc a mapped citation row
 * @returns {Boolean}
 */
export function canBrowseSource(doc) {
  return isOkfConceptSource(doc) && !!doc.repoId && !!doc.id;
}
