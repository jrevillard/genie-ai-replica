/**
 * News relevance gate — every surfaced item must relate to economics or
 * agriculture (user requirement 2026-09-18: "Jay Music y Jimmy Bad Boy…"
 * style entertainment headlines must never appear).
 *
 * Applied at ingest (GDELT + all RSS adapters) and again in the news
 * builder so legacy/seeded junk is filtered at serve time too.
 */
const RELEVANT = [
  // agriculture (EN)
  /wheat|maize|maiz|corn|fertiliz|harvest|crop|farm|agricultur|coffee|sugar|rice|beans|livestock|cattle|poultry|tilapia|honey|apiar|drought|rainfall|seed|irrigat|soil|pest|ndvi|food security|grain/i,
  // economics (EN)
  /price|inflation|market|trade|export|import|tariff|econom|sanction|dollar|peso|quintal|cost|supply|commodity|subsid|loan|credit|wage|gdp|recession|debt|budget|tax/i,
  // agricultura (ES)
  /trigo|fertiliz|cosecha|cultiv|agr[ií]col|agricultor|caf[eé]|arroz|frijol|ganader|ganado|corral|tilapia|miel|sequ[ií]a|lluvia|semilla|riego|suelo|plaga|seguridad alimentaria|granos|c[aá]mara agro/i,
  // economía (ES)
  /precio|inflaci[oó]n|mercado|comercio|exportaci|importaci|arancel|econ[oó]m|sanci[oó]n|d[oó]lar|quintal|costo|suministro|subsidio|cr[eé]dito|salario|pib|recesi[oó]n|deuda|presupuesto|impuesto/i
];

/**
 * @param {{title?:string, snippet?:string, description?:string}} item
 * @returns {boolean} true when the item mentions an agriculture/economics topic
 */
function isRelevantNews(item) {
  const text = `${(item && item.title) || ''} ${(item && (item.snippet || item.description)) || ''}`;
  return RELEVANT.some((re) => re.test(text));
}

module.exports = { isRelevantNews };
