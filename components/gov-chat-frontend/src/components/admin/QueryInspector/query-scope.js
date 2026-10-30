/**
 * The scope a stored query was filtered on, in the three states the pipeline
 * can report it. chatqna decides the labels (it sends the applied filter
 * labels in its metadata event, by the pipeline's own rule); this only
 * classifies what was stored.
 *
 * Shared by the list and the detail so the two views cannot disagree about
 * the same record.
 *
 * @param {object} query A stored query document.
 * @returns {string[]|null} The labels the retrieval filtered on — null when
 *   the record does not say: the field is absent, null, or not a list (a
 *   query saved before the field existed, a chatqna too old to report it,
 *   or a malformed record). An EMPTY list is a reported fact, not an
 *   absence: the retrieval ran unfiltered.
 */
export function scopeLabels(query) {
  const labels = query?.metadata?.filter_labels;
  return Array.isArray(labels) ? labels : null;
}

/**
 * The stored scope as display text — null when the record does not say, the
 * joined labels otherwise, with an empty list rendered as the unfiltered
 * label. One rendering for both views: a wording change here cannot diverge
 * the list cell from the detail panel.
 *
 * @param {object} query A stored query document.
 * @param {string} unfilteredLabel Translated text for the empty-list state.
 * @returns {string|null}
 */
export function scopeDisplayText(query, unfilteredLabel) {
  const labels = scopeLabels(query);
  if (labels === null) {
    return null;
  }
  return labels.join(', ') || unfilteredLabel;
}

/**
 * Whether the stored record says the turn abstained. The metadata field is
 * tri-state (true / false / absent-or-null on records that predate it);
 * only an explicit true is an abstention.
 *
 * @param {object} query A stored query document.
 * @returns {boolean}
 */
export function isAbstained(query) {
  return query?.metadata?.abstained === true;
}
