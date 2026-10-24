// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
//
// SINGLE SOURCE OF TRUTH for the OKF frontmatter vocabulary.
//
// Both vocabularies below were copied into several places and had drifted apart
// from what the product actually writes and what the tests assert.
//
// ── type ──────────────────────────────────────────────────────────────────────
// The bundle root is written with type 'index' (crawl-conversion-service) and
// may carry the authorial type 'BundleRoot' (David's convention).
// concept-meta-service recognises both AS the index by IDENTITY — path
// 'index.md' or concept_id 'index' — and deliberately does not let the
// authorial type block detection (see the comment at concept-meta-service.js:
//154-157). But every enum that validated the type knew only the five content
// types, so autocorrect raised INVALID_TYPE on the product's OWN reserved page
// with no remedy offered. A dead end for the curator. BUG-11 / !1077.
//
// ── status ────────────────────────────────────────────────────────────────────
// `active|draft|retired' lived in AUTOCORRECT_STATUS_ENUM; 'draft|stable|
// deprecated' lived in conformance-service and LIFECYCLE_STATUSES. There is no
// spec document declaring either — the tests and the live corpus are the truth,
// and both say the SAME list:
//
//   • conformance-service.test.js asserts draft|stable|deprecated are VALID.
//   • concept-meta-service.test.js carries an explicit REGRESSION test that
//     `status: 'retired'' falls back to 'draft' — retired is NOT valid.
//   • parser-service.test.js / ingest-service.test.js both exercise
//     `status: 'stable''.
//   • Live corpus (2,979 concepts, measured): frontmatter.status is 2,860
//     draft / 5 stable / 114 absent. `active' and `retired' occur ZERO times.
//
// So the two lists were the same field read two ways, and autocorrect was the
// one reading it wrongly — it rejected the `stable' the corpus actually
// contains and accepted the `active'/`retired' that nothing produces. That is
// the defect this module fixes.
//
// ONE field, ONE vocabulary. `lifecycle_status' is derived from the same
// `status' value (concept-meta-service.js:122), so it uses the same list rather
// than a second one that can drift again.

/** Types an author may assign to a concept page. */
const CONTENT_TYPES = ['topic', 'entity', 'process', 'event', 'source'];

/**
 * The reserved type the bundle root carries. Recognised, never inferred, and
 * never autocorrected away — the root is identified by identity
 * (path === 'index.md' || concept_id === 'index'), not by its type.
 */
const RESERVED_INDEX_TYPES = ['index', 'BundleRoot'];

/** Everything the product will accept as a `type` value. */
const ALL_TYPES = [...CONTENT_TYPES, ...RESERVED_INDEX_TYPES];

/**
 * Everything the product will accept as a `status` value — the author-declared
 * frontmatter status, and equally the source of the derived `lifecycle_status`.
 */
const STATUS_VALUES = ['draft', 'stable', 'deprecated'];

/** True when `type` is a value the product itself produces. */
function isKnownType(type) {
  return ALL_TYPES.includes(type);
}

/** True when `type` is author-reserved (the index) rather than a content type. */
function isReservedType(type) {
  return RESERVED_INDEX_TYPES.includes(type);
}

module.exports = {
  CONTENT_TYPES,
  RESERVED_INDEX_TYPES,
  ALL_TYPES,
  STATUS_VALUES,
  isKnownType,
  isReservedType
};
