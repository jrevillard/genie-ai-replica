/**
 * Data-layer localization for the agri Insights surfaces.
 *
 * UI chrome goes through vue-i18n (`charts.*` keys), but the DATA itself
 * arrives in English: commodity/series names come from the backend
 * (`agri-service` seriesDefs) and the envelope `meta` strings (source /
 * coverage / estimation) are composed server-side. Locale files cannot
 * carry those — they are data, not UI keys — so this module translates
 * them with exact-match dictionaries.
 *
 * Design rule: every lookup FALLS BACK TO THE INPUT when the string is
 * unknown. Backend renames or new series degrade to English rather than
 * ever mistranslating.
 */

/** Base display names (the `baseSeriesName` output the UI renders) → ES. */
const SERIES_NAMES_ES = {
  'Beans (black)': 'Frijol (negro)',
  'Beans (pinto)': 'Frijol (pinto)',
  'Beans (red)': 'Frijol (rojo)',
  'Beans (silk red)': 'Frijol (rojo seda)',
  Beef: 'Carne de res',
  Cabbage: 'Repollo',
  Carrots: 'Zanahorias',
  'Central America food lost after harvest': 'Alimentos de Centroamérica perdidos poscosecha',
  'Central America post-harvest food loss (FAO SDG 12.3.1)':
    'Pérdida poscosecha de alimentos en Centroamérica (FAO ODS 12.3.1)',
  Chicken: 'Pollo',
  'DAP (US Gulf spot)': 'DAP (contado Golfo de EE. UU.)',
  Eggs: 'Huevos',
  'Fish meal feed cost': 'Costo de harina de pescado',
  'Honey export unit value (El Salvador)': 'Valor unitario de exportación de miel (El Salvador)',
  'Honey producer price (El Salvador)': 'Precio al productor de miel (El Salvador)',
  'MOP (Brazil CFR granular)': 'MOP (Brasil CFR granular)',
  Maize: 'Maíz',
  'Maize (white)': 'Maíz (blanco)',
  'PPI pesticide & ag-chemical manufacturing': 'IPP de fabricación de plaguicidas y agroquímicos',
  'Pesticide import parity': 'Paridad de importación de plaguicidas',
  Pork: 'Cerdo',
  Rice: 'Arroz',
  'Rice (first quality)': 'Arroz (primera calidad)',
  Sorghum: 'Sorgo',
  'TSP (US Gulf)': 'TSP (Golfo de EE. UU.)',
  'Tilapia fillets': 'Filetes de tilapia',
  'Tomatoes producer price (El Salvador)': 'Precio al productor de tomate (El Salvador)',
  'Tomatoes producer price (Honduras)': 'Precio al productor de tomate (Honduras)',
  'Urea (Middle East f.o.b.)': 'Urea (Oriente Medio f.o.b.)',
  'Urea import parity': 'Paridad de importación de urea',
  Watermelons: 'Sandías',
  Wheat: 'Trigo',
  'Whole tilapia': 'Tilapia entera'
};

/** Full served series names (def names, incl. market detail + tags) → ES.
 *  Used for hover tooltips and the envelope coverage string. */
const FULL_NAMES_ES = {
  'Beans (black), Guatemala La Terminal [regional]': 'Frijol (negro), La Terminal de Guatemala [regional]',
  'Beans (pinto), Nicaragua national average [regional]': 'Frijol (pinto), promedio nacional de Nicaragua [regional]',
  'Beans (red), Nicaragua national average [regional]': 'Frijol (rojo), promedio nacional de Nicaragua [regional]',
  'Beans (red), San Salvador wholesale': 'Frijol (rojo), mayoreo San Salvador',
  'Beans (silk red), San Salvador wholesale': 'Frijol (rojo seda), mayoreo San Salvador',
  'Beef (intl benchmark)': 'Carne de res (referencia internacional)',
  'Cabbage, Guatemala La Terminal wholesale [regional]': 'Repollo, mayoreo La Terminal de Guatemala [regional]',
  'Carrots, Guatemala La Terminal wholesale [regional]': 'Zanahorias, mayoreo La Terminal de Guatemala [regional]',
  'Central America food lost after harvest, before retail (share of food harvest by mass) (FAO SDG 12.3.1)':
    'Alimentos de Centroamérica perdidos poscosecha, antes del comercio minorista (proporción de la cosecha en masa) (FAO ODS 12.3.1)',
  'Central America post-harvest food loss (FAO SDG 12.3.1)':
    'Pérdida poscosecha de alimentos en Centroamérica (FAO ODS 12.3.1)',
  'Chicken (Brazil wholesale, intl benchmark)': 'Pollo (mayoreo Brasil, referencia internacional)',
  'Chicken, Nicaragua national average [regional]': 'Pollo, promedio nacional de Nicaragua [regional]',
  'DAP (US Gulf spot)': 'DAP (contado Golfo de EE. UU.)',
  'Eggs, Nicaragua national average [regional]': 'Huevos, promedio nacional de Nicaragua [regional]',
  'Fish meal feed cost (intl benchmark)': 'Costo de harina de pescado (referencia internacional)',
  'Honey export unit value (El Salvador)': 'Valor unitario de exportación de miel (El Salvador)',
  'Honey producer price (El Salvador)': 'Precio al productor de miel (El Salvador)',
  'MOP (Brazil CFR granular)': 'MOP (Brasil CFR granular)',
  'Maize (US #2, US Gulf intl benchmark)': 'Maíz (US #2, Golfo de EE. UU., referencia internacional)',
  'Maize (white), Guatemala City (La Terminal) [regional]':
    'Maíz (blanco), Ciudad de Guatemala (La Terminal) [regional]',
  'Maize (white), Nicaragua national average [regional]': 'Maíz (blanco), promedio nacional de Nicaragua [regional]',
  'Maize (white), San Salvador wholesale': 'Maíz (blanco), mayoreo San Salvador',
  'PPI pesticide & ag-chemical manufacturing': 'IPP de fabricación de plaguicidas y agroquímicos',
  'Pesticide import parity (El Salvador CIF)': 'Paridad de importación de plaguicidas (CIF El Salvador)',
  'Pork, Nicaragua national average [regional]': 'Cerdo, promedio nacional de Nicaragua [regional]',
  'Rice (first quality), Guatemala La Terminal [regional]':
    'Arroz (primera calidad), La Terminal de Guatemala [regional]',
  'Rice (intl benchmark)': 'Arroz (referencia internacional)',
  'Rice, San Salvador wholesale': 'Arroz, mayoreo San Salvador',
  'Sorghum (intl benchmark)': 'Sorgo (referencia internacional)',
  'Sorghum, Nicaragua national average [regional]': 'Sorgo, promedio nacional de Nicaragua [regional]',
  'Sorghum, San Salvador wholesale': 'Sorgo, mayoreo San Salvador',
  'TSP (US Gulf)': 'TSP (Golfo de EE. UU.)',
  'Tilapia fillets, Honduras exports (FOB) [regional]':
    'Filetes de tilapia, exportaciones de Honduras (FOB) [regional]',
  'Tomatoes producer price (El Salvador)': 'Precio al productor de tomate (El Salvador)',
  'Tomatoes producer price (Honduras) [regional]': 'Precio al productor de tomate (Honduras) [regional]',
  'Urea (Middle East f.o.b.)': 'Urea (Oriente Medio f.o.b.)',
  'Urea import parity (El Salvador CIF)': 'Paridad de importación de urea (CIF El Salvador)',
  'Watermelons, Guatemala La Terminal wholesale [regional]': 'Sandías, mayoreo La Terminal de Guatemala [regional]',
  'Wheat (intl benchmark)': 'Trigo (referencia internacional)',
  'Whole tilapia, Costa Rica exports (FOB) [regional]': 'Tilapia entera, exportaciones de Costa Rica (FOB) [regional]'
};

/** Full served series names (def names, incl. market detail + tags) → FR. */
const FULL_NAMES_FR = {
  'Beans (black), Guatemala La Terminal [regional]': 'Haricot (noir), La Terminal du Guatemala [régional]',
  'Beans (pinto), Nicaragua national average [regional]': 'Haricot (pinto), moyenne nationale du Nicaragua [régional]',
  'Beans (red), Nicaragua national average [regional]': 'Haricot (rouge), moyenne nationale du Nicaragua [régional]',
  'Beans (red), San Salvador wholesale': 'Haricot (rouge), vente en gros San Salvador',
  'Beans (silk red), San Salvador wholesale': 'Haricot (rouge soyeux), vente en gros San Salvador',
  'Beef (intl benchmark)': 'Bœuf (référence internationale)',
  'Cabbage, Guatemala La Terminal wholesale [regional]': 'Chou, vente en gros La Terminal du Guatemala [régional]',
  'Carrots, Guatemala La Terminal wholesale [regional]': 'Carottes, vente en gros La Terminal du Guatemala [régional]',
  'Central America food lost after harvest, before retail (share of food harvest by mass) (FAO SDG 12.3.1)':
    'Amérique centrale — pertes alimentaires après récolte, avant le commerce de détail (part de la récolte en masse) (FAO ODD 12.3.1)',
  'Central America post-harvest food loss (FAO SDG 12.3.1)':
    'Amérique centrale — pertes alimentaires post-récolte (FAO ODD 12.3.1)',
  'Chicken (Brazil wholesale, intl benchmark)': 'Poulet (Brésil vente en gros, référence internationale)',
  'Chicken, Nicaragua national average [regional]': 'Poulet, moyenne nationale du Nicaragua [régional]',
  'DAP (US Gulf spot)': 'DAP (comptant Golfe des États-Unis)',
  'Eggs, Nicaragua national average [regional]': 'Œufs, moyenne nationale du Nicaragua [régional]',
  'Fish meal feed cost (intl benchmark)': 'Coût de la farine de poisson (référence internationale)',
  'Honey export unit value (El Salvador)': "Valeur unitaire d'exportation du miel (El Salvador)",
  'Honey producer price (El Salvador)': 'Prix au producteur de miel (El Salvador)',
  'MOP (Brazil CFR granular)': 'MOP (Brésil CFR granulé)',
  'Maize (US #2, US Gulf intl benchmark)': 'Maïs (US #2, Golfe des États-Unis, référence internationale)',
  'Maize (white), Guatemala City (La Terminal) [regional]': 'Maïs (blanc), Ville de Guatemala (La Terminal) [régional]',
  'Maize (white), Nicaragua national average [regional]': 'Maïs (blanc), moyenne nationale du Nicaragua [régional]',
  'Maize (white), San Salvador wholesale': 'Maïs (blanc), vente en gros San Salvador',
  'PPI pesticide & ag-chemical manufacturing': 'IPP fabrication de pesticides et agrochimiques',
  'Pesticide import parity (El Salvador CIF)': "Parité d'importation de pesticides (CIF El Salvador)",
  'Pork, Nicaragua national average [regional]': 'Porc, moyenne nationale du Nicaragua [régional]',
  'Rice (first quality), Guatemala La Terminal [regional]':
    'Riz (première qualité), La Terminal du Guatemala [régional]',
  'Rice (intl benchmark)': 'Riz (référence internationale)',
  'Rice, San Salvador wholesale': 'Riz, vente en gros San Salvador',
  'Sorghum (intl benchmark)': 'Sorgho (référence internationale)',
  'Sorghum, Nicaragua national average [regional]': 'Sorgho, moyenne nationale du Nicaragua [régional]',
  'Sorghum, San Salvador wholesale': 'Sorgho, vente en gros San Salvador',
  'TSP (US Gulf)': 'TSP (Golfe des États-Unis)',
  'Tilapia fillets, Honduras exports (FOB) [regional]': 'Filets de tilapia, Exportations du Honduras (FOB) [régional]',
  'Tomatoes producer price (El Salvador)': 'Prix au producteur de tomates (El Salvador)',
  'Tomatoes producer price (Honduras) [regional]': 'Prix au producteur de tomates (Honduras) [régional]',
  'Urea (Middle East f.o.b.)': 'Urée (Moyen-Orient f.o.b.)',
  'Urea import parity (El Salvador CIF)': "Parité d'importation d'urée (CIF El Salvador)",
  'Watermelons, Guatemala La Terminal wholesale [regional]':
    'Pastèques, vente en gros La Terminal du Guatemala [régional]',
  'Wheat (intl benchmark)': 'Blé (référence internationale)',
  'Whole tilapia, Costa Rica exports (FOB) [regional]':
    'Tilapia entière, moyennes nationales du Costa Rica (FOB) [régional]'
};

/** Full served series names (def names, incl. market detail + tags) → PT-BR. */
const FULL_NAMES_PT = {
  'Beans (black), Guatemala La Terminal [regional]': 'Feijão (preto), La Terminal da Guatemala [regional]',
  'Beans (pinto), Nicaragua national average [regional]': 'Feijão (pinto), média nacional da Nicarágua [regional]',
  'Beans (red), Nicaragua national average [regional]': 'Feijão (vermelho), média nacional da Nicarágua [regional]',
  'Beans (red), San Salvador wholesale': 'Feijão (vermelho), atacado San Salvador',
  'Beans (silk red), San Salvador wholesale': 'Feijão (vermelho seda), atacado San Salvador',
  'Beef (intl benchmark)': 'Carne bovina (referência internacional)',
  'Cabbage, Guatemala La Terminal wholesale [regional]': 'Repolho, atacado La Terminal da Guatemala [regional]',
  'Carrots, Guatemala La Terminal wholesale [regional]': 'Cenouras, atacado La Terminal da Guatemala [regional]',
  'Central America food lost after harvest, before retail (share of food harvest by mass) (FAO SDG 12.3.1)':
    'América Central — perdas de alimentos pós-colheita, antes do varejo (proporção da colheita em massa) (FAO ODS 12.3.1)',
  'Central America post-harvest food loss (FAO SDG 12.3.1)':
    'América Central — perdas pós-colheita de alimentos (FAO ODS 12.3.1)',
  'Chicken (Brazil wholesale, intl benchmark)': 'Frango (atacado Brasil, referência internacional)',
  'Chicken, Nicaragua national average [regional]': 'Frango, média nacional da Nicarágua [regional]',
  'DAP (US Gulf spot)': 'DAP (à vista Golfo dos EUA)',
  'Eggs, Nicaragua national average [regional]': 'Ovos, média nacional da Nicarágua [regional]',
  'Fish meal feed cost (intl benchmark)': 'Custo de farinha de peixe (referência internacional)',
  'Honey export unit value (El Salvador)': 'Valor unitário de exportação de mel (El Salvador)',
  'Honey producer price (El Salvador)': 'Preço ao produtor de mel (El Salvador)',
  'MOP (Brazil CFR granular)': 'MOP (Brasil CFR granular)',
  'Maize (US #2, US Gulf intl benchmark)': 'Milho (US #2, Golfo dos EUA, referência internacional)',
  'Maize (white), Guatemala City (La Terminal) [regional]':
    'Milho (branco), Cidade da Guatemala (La Terminal) [regional]',
  'Maize (white), Nicaragua national average [regional]': 'Milho (branco), média nacional da Nicarágua [regional]',
  'Maize (white), San Salvador wholesale': 'Milho (branco), atacado San Salvador',
  'PPI pesticide & ag-chemical manufacturing': 'IPP de fabricação de agrotóxicos e agroquímicos',
  'Pesticide import parity (El Salvador CIF)': 'Paridade de importação de agrotóxicos (CIF El Salvador)',
  'Pork, Nicaragua national average [regional]': 'Suíno, média nacional da Nicarágua [regional]',
  'Rice (first quality), Guatemala La Terminal [regional]':
    'Arroz (primeira qualidade), La Terminal da Guatemala [regional]',
  'Rice (intl benchmark)': 'Arroz (referência internacional)',
  'Rice, San Salvador wholesale': 'Arroz, atacado San Salvador',
  'Sorghum (intl benchmark)': 'Sorgo (referência internacional)',
  'Sorghum, Nicaragua national average [regional]': 'Sorgo, média nacional da Nicarágua [regional]',
  'Sorghum, San Salvador wholesale': 'Sorgo, atacado San Salvador',
  'TSP (US Gulf)': 'TSP (Golfo dos EUA)',
  'Tilapia fillets, Honduras exports (FOB) [regional]': 'Filés de tilápia, exportações de Honduras (FOB) [regional]',
  'Tomatoes producer price (El Salvador)': 'Preço ao produtor de tomate (El Salvador)',
  'Tomatoes producer price (Honduras) [regional]': 'Preço ao produtor de tomate (Honduras) [regional]',
  'Urea (Middle East f.o.b.)': 'Ureia (Oriente Médio f.o.b.)',
  'Urea import parity (El Salvador CIF)': 'Paridade de importação de ureia (CIF El Salvador)',
  'Watermelons, Guatemala La Terminal wholesale [regional]': 'Melancias, atacado La Terminal da Guatemala [regional]',
  'Wheat (intl benchmark)': 'Trigo (referência internacional)',
  'Whole tilapia, Costa Rica exports (FOB) [regional]': 'Tilapia inteira, exportações de Costa Rica (FOB) [regional]'
};

/** Locale → full-names dictionary map. */
export const FULL_NAMES_BY_LOCALE = {
  es: FULL_NAMES_ES,
  fr: FULL_NAMES_FR,
  pt: FULL_NAMES_PT
};

const COUNTRIES_ES = {
  Brazil: 'Brasil',
  'US Gulf': 'Golfo de EE. UU.',
  'Middle East': 'Oriente Medio',
  World: 'Mundo',
  'United States': 'Estados Unidos'
};

const SOURCES_ES = {
  'GENIE.AI agri service (composite)': 'Servicio agrícola de GENIE.AI (compuesto)',
  'WFP VAM via HDX (NASA MODIS)': 'VAM del PMA vía HDX (NASA MODIS)',
  'Curated advisories + OIRSA + iNaturalist': 'Alertas curadas + OIRSA + iNaturalist'
};

/** Whole-string canned coverage values, and the phrase fragments the
 *  composed coverage strings are built from. */
const COVERAGE_ES = {
  'No data available yet': 'Aún no hay datos disponibles',
  'No data fetched yet — awaiting first successful prefetch':
    'Aún no se han obtenido datos — esperando la primera descarga exitosa',
  'No NDVI data available': 'No hay datos de NDVI disponibles',
  'Seasonal advisories (curated), OIRSA regional news and community sightings from the last 90 days — no live official alert feed exists for Central America':
    'Alertas estacionales (curadas), noticias regionales de OIRSA y avistamientos comunitarios de los últimos 90 días — no existe un canal oficial de alertas en vivo para Centroamérica',
  ' — monthly aggregates (last observation of each month)': ' — agregados mensuales (última observación de cada mes)'
};

const ATTRIBUTION_ES = {
  'Source: WFP VAM via HDX (CC BY 4.0)': 'Fuente: VAM del PMA vía HDX (CC BY 4.0)'
};

/** UI locale ('en' | 'es') → BCP47 tag for Intl date formatting. */
export function agriDateLocale(locale) {
  return locale === 'es' ? 'es-SV' : 'en-US';
}

/** Localize a base display name. Unknown → input (never mistranslates). */
export function localizeSeriesName(baseName, locale) {
  if (locale !== 'es') return baseName;
  return SERIES_NAMES_ES[baseName] || baseName;
}

/**
 * Full-name lookup with a converted-tag retry: served benchmark names can
 * carry a technical ' [converted USD/mt to QQ]' suffix — look the human
 * part up and re-attach the tag untranslated.
 */
function lookupFullName(name) {
  if (FULL_NAMES_ES[name]) return FULL_NAMES_ES[name];
  const m = name.match(/^(.*?)\s*\[converted[^\]]*\]\s*$/);
  if (m && FULL_NAMES_ES[m[1]]) return FULL_NAMES_ES[m[1]] + name.slice(m[1].length);
  return name;
}

/** Localize a full served series name by locale.
 *  Single-arg form defaults to Spanish for backward compatibility. */
export function displayName(name, locale) {
  const dict = locale ? FULL_NAMES_BY_LOCALE[locale] : FULL_NAMES_ES;
  if (!dict) return name;
  if (dict[name]) return dict[name];
  const m = name.match(/^([A-Z][A-Za-z]+(?: \([^)]+\))?)/);
  if (m && dict[m[1]]) return dict[m[1]] + name.slice(m[1].length);
  return dict[name] || name;
}

/** Localize a full served series name. Unknown → input. */
export function localizeFullName(fullName, locale) {
  return displayName(fullName, locale);
}

/**
 * Localize the composed market-coverage string:
 *   "NAME (COUNTRY, through DATE); ... — monthly aggregates (...)"
 * Each segment is rewritten as "NAME (PAÍS, hasta FECHA)"; the name part
 * goes through the full-name dictionary, the country through the country
 * dictionary. Unknown pieces pass through unchanged.
 */
export function localizeCoverage(coverage, locale) {
  if (!coverage || locale !== 'es') return coverage;
  let out = COVERAGE_ES[coverage] || coverage;
  // Whole-string matches (canned values) are done — segment rewriting only
  // applies to the composed market format (contains ", through ").
  if (!out.includes(', through ')) return out;

  const suffixMatch = out.match(/(\s—\smonthly aggregates \(last observation of each month\))$/);
  let suffix = '';
  if (suffixMatch) {
    suffix = ' — agregados mensuales (última observación de cada mes)';
    out = out.slice(0, suffixMatch.index);
  }
  const segments = out.split('; ');
  const translated = segments.map((seg) => {
    // Greedy name group lands on the LAST '(' (the country segment);
    // trim() clears the space the backtracking leaves behind.
    const m = seg.match(/^(.*)\s*\((.*),\s*through\s+(.*?)\)$/);
    if (!m) return seg;
    const [, rawName, country, date] = m;
    const c = COUNTRIES_ES[country.trim()] || country.trim();
    const n = lookupFullName(rawName.trim());
    return `${n} (${c}, hasta ${date})`;
  });
  return translated.join('; ') + suffix;
}

/**
 * Localize the CPI-estimation disclosure:
 *   "2015–2025 values are inflation-adjusted estimates (base: 2007 actual, El Salvador CPI)[; current-year ...]"
 */
export function localizeEstimation(estimation, locale) {
  if (!estimation || locale !== 'es') return estimation;
  const m = estimation.match(
    /^(\S+) values are inflation-adjusted estimates \(base: (.+) actual, El Salvador CPI\)(; current-year CPI projected at last known rate)?$/
  );
  if (!m) return estimation;
  const [, range, baseYears, partial] = m;
  const tail = partial ? '; IPC del año en curso proyectado a la última tasa conocida' : '';
  return `${range} valores son estimaciones ajustadas por inflación (base: ${baseYears} real, IPC de El Salvador)${tail}`;
}

/** Localize an envelope `meta` object (source/coverage/estimation/attribution). */
export function localizeMeta(meta, locale) {
  if (!meta || locale !== 'es') return meta;
  const out = { ...meta };
  if (out.source) out.source = SOURCES_ES[out.source] || out.source;
  if (out.coverage) out.coverage = localizeCoverage(out.coverage, locale);
  if (out.estimation) out.estimation = localizeEstimation(out.estimation, locale);
  if (out.attribution) out.attribution = ATTRIBUTION_ES[out.attribution] || out.attribution;
  return out;
}
