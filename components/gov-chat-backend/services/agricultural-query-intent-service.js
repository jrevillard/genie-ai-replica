/**
 * Lightweight agricultural query analysis for hybrid retrieval (taxonomy_filters)
 * and comparative (multi-region) hints. Does not call an LLM — uses patterns + vocabulary.
 * Normalized labels must align with dataprep / agri_metadata vocabularies where possible.
 */

const KNOWN_COUNTRIES = [
  'Lesotho',
  'South Africa',
  'Tanzania',
  'Kenya',
  'Uganda',
  'Zambia',
  'Zimbabwe',
  'Botswana',
  'Eswatini',
  'Mozambique',
  'Malawi'
];

/** Terms -> tax_crop_names style (subset of controlled vocabulary) */
const CROP_TERMS = [
  { re: /\bmaize\b|\bcorn\b|\bmealies\b/i, value: 'Maize' },
  { re: /\bbananas?\b/i, value: 'Banana' },
  { re: /\bred beans\b|\bkidney beans\b|\bbeans\b|\blegumes\b|\bphaseolus\b/i, value: 'Beans' },
  { re: /\bwheat\b/i, value: 'Wheat' },
  { re: /\bsorghum\b/i, value: 'Sorghum' }
];

const VARIETAL_TERMS = [{ re: /\bred beans\b|\bkidney beans\b/i, value: 'Red Beans' }];

function findCountries(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }
  const lower = text.toLowerCase();
  const found = new Set();
  for (const c of KNOWN_COUNTRIES) {
    if (lower.includes(c.toLowerCase())) {
      found.add(c);
    }
  }
  return [...found];
}

function findCropNames(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }
  const out = new Set();
  for (const { re, value } of CROP_TERMS) {
    if (re.test(text)) {
      out.add(value);
    }
  }
  return [...out];
}

function findVarietals(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }
  const out = new Set();
  for (const { re, value } of VARIETAL_TERMS) {
    if (re.test(text)) {
      out.add(value);
    }
  }
  return [...out];
}

/**
 * Build optional taxonomy_filters for Arango retriever (see genieai_retriever_arangodb._taxonomy_filter_inner).
 *
 * IMPORTANT: Inferred crop/country filters are NOT applied by default. The retriever uses them as hard AND
 * predicates on chunk tax_* fields; most ingested documents only have labels / partial taxonomy, so
 * e.g. crop_names: ["Maize"] from the word "maize" would return zero chunks and empty RAG context.
 *
 * Set AGRI_INFER_TAXONOMY_FILTERS=true only when chunk metadata is fully populated (agri_metadata tax_*).
 * Explicit filters from the client (context.taxonomy_filters) are still merged in query-service.js.
 *
 * @param {string} queryText - Last user message
 * @returns {{ taxonomy_filters: object|null, comparative_regions: string[], isComparative: boolean }}
 */
function extractAgriculturalIntent(queryText) {
  const comparative_regions = findCountries(queryText);
  const cropNames = findCropNames(queryText);
  const varietals = findVarietals(queryText);
  const isComparative = comparative_regions.length >= 2;

  const inferFilters = String(process.env.AGRI_INFER_TAXONOMY_FILTERS || '').toLowerCase() === 'true';

  let taxonomy_filters = null;
  if (inferFilters) {
    const tf = {};
    if (comparative_regions.length === 1) {
      tf.countries = comparative_regions;
    }
    if (cropNames.length > 0) {
      tf.crop_names = cropNames;
    }
    if (varietals.length > 0) {
      tf.varietals = varietals;
    }
    taxonomy_filters = Object.keys(tf).length ? tf : null;
  }

  return {
    taxonomy_filters,
    comparative_regions: comparative_regions.length > 0 ? comparative_regions : null,
    isComparative
  };
}

module.exports = {
  extractAgriculturalIntent,
  KNOWN_COUNTRIES
};
