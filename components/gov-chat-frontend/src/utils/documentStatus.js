// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// W6 / EPIC-6 / CAP-5 — the shared document-status vocabulary.
//
// WHY THIS IS SHARED: the admin document list (AdminDashboard.vue) and the
// OKF artifacts view (components/okf/ArtifactsView.vue) both render a
// dataprep status, and they MUST agree — a bundle that reads "Ingested" in
// one surface and "Pending" in the other is the same class of lie this wave
// exists to remove. The mapping lived inline in AdminDashboard.vue's
// getStatusVariant/getDisplayStatus; it is extracted here so the second
// consumer cannot drift from it.
//
// THE STORED VALUE IS CAPITALISED. doc-repo persists 'Pending' / 'Ingested'
// / 'Retracted' (fileController.js:149-170), while the QUERY param is
// lower-case and the service compares case-insensitively
// (fileService.js:671). Every lookup here normalises, so a case change on
// either side cannot blank a pill.
//
// SCOPE — WHAT THIS DOES NOT CHANGE: the crawl-job statuses ('Crawling',
// 'Crawl Failed', 'Crawl Killed', 'Crawl Scheduled') stay in
// AdminDashboard.vue, where they still take precedence over the dataprep
// status. They are a DIFFERENT vocabulary and the artifacts view never has a
// crawl job. 'killed' as a DATAPREP status stays unmapped exactly as it is
// today (it renders the 'info' variant) — remapping it would change an
// existing rendering, which the wave's no-regression inventory forbids.
//
// FileDetailsDialog.vue is a THIRD surface, and it is deliberately NOT wired
// here: its status mapper takes the DISPLAY string (which already carries
// the crawl arms) and answers with a different default ('pending', not
// 'info'; 'killed' → 'error', not 'info'). Sharing this module with it
// would change existing renderings, which is out of scope for this wave.

/** The dataprep status → DsStatusTag variant mapping. */
export const DATAPREP_STATUS_VARIANTS = {
  pending: 'pending',
  ingesting: 'info',
  ingested: 'success',
  'ingested with warnings': 'warning',
  'ingestion error': 'error',
  retracted: 'info'
};

/**
 * The dataprep status → catalogue leaf mapping. The key suffixes resolve
 * under `admin.documents.*` (the keys the document list already ships) — the
 * artifacts view reuses the same leaves rather than shipping a second set of
 * words for the same states. The fallback is the English label, used both as
 * the translate() fallback and as the label of a surface that does not
 * translate the status.
 */
export const DATAPREP_STATUS_KEYS = {
  pending: { key: 'statusPending', fallback: 'Pending' },
  ingesting: { key: 'statusIngesting', fallback: 'Ingesting' },
  ingested: { key: 'statusIngested', fallback: 'Ingested' },
  'ingested with warnings': { key: 'statusWarning', fallback: 'Ingested with Warnings' },
  'ingestion error': { key: 'statusError', fallback: 'Ingestion Error' },
  retracted: { key: 'statusRetracted', fallback: 'Retracted' }
};

/** Normalise a stored status to its comparable form ('' when absent). */
export function normalizeStatus(status) {
  return status ? String(status).toLowerCase().trim() : '';
}

/**
 * The DsStatusTag variant for a dataprep status.
 * @param {string} status - the stored status, any case
 * @returns {string} one of success|error|warning|info|pending
 */
export function statusVariant(status) {
  return DATAPREP_STATUS_VARIANTS[normalizeStatus(status)] || 'info';
}

/**
 * The i18n key suffix for a dataprep status, or null when the status is not
 * one the catalogue knows. A null means "no catalogue leaf" — the caller
 * renders the raw status (honest, and rare: the only unmapped dataprep
 * status is 'killed').
 * @param {string} status - the stored status, any case
 * @returns {string|null} the suffix under `admin.documents.`
 */
export function statusKey(status) {
  const entry = DATAPREP_STATUS_KEYS[normalizeStatus(status)];
  return entry ? entry.key : null;
}

/**
 * The displayed state of a document/artifacts row: the catalogue's English
 * label when the status is known, the raw status when it is not, 'Unknown'
 * when there is no status at all.
 * @param {string} status - the stored status, any case
 * @returns {string}
 */
export function displayStatus(status) {
  const entry = DATAPREP_STATUS_KEYS[normalizeStatus(status)];
  if (entry) return entry.fallback;
  const raw = String(status || '').trim();
  return raw || 'Unknown';
}
