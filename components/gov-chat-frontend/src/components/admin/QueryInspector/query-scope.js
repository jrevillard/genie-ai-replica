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
