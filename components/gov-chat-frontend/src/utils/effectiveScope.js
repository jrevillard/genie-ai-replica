// src/utils/effectiveScope.js - The label filter a query's retrieval applied

/**
 * The label filter the retrieval applied for a stored query.
 *
 * Same rule as the pipeline's (genie-ai-overlay/core/label_contract.py):
 * the service labels are the filter whenever they exist (the service is the
 * narrower scope — the category must not widen it into the whole category),
 * otherwise the category filters on its own, in both spellings
 * (categoryLabel singular, categoryLabels legacy). Empty and null entries are
 * not labels, and the pipeline dedupes them.
 *
 * The single-message backend mode sends no context to the RAG at all, so the
 * labels stored on such a query are not a filter.
 *
 * @param {Object} query - A stored query record.
 * @returns {string} The labels that filtered, or '' when nothing did.
 */
export function effectiveScope(query) {
  if (!query || query.contextOption === 'single-message') return '';
  const context = query.context || {};
  const isLabel = (label) => label !== '' && label != null;
  const services = Array.isArray(context.serviceLabels) ? context.serviceLabels.filter(isLabel) : [];
  if (services.length) return [...new Set(services)].join(', ');
  const labels = [];
  if (isLabel(context.categoryLabel)) labels.push(context.categoryLabel);
  if (Array.isArray(context.categoryLabels)) labels.push(...context.categoryLabels.filter(isLabel));
  return [...new Set(labels)].join(', ');
}
