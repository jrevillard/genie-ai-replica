// lib/components/charts/agri_i18n.dart
//
// Data-layer localization for the agri Insights surfaces — ported 1:1
// from components/gov-chat-frontend/src/utils/agri-i18n.js (parity spec
// §12bis / S27).
//
// UI chrome goes through the I18nService (`market.*` keys), but the DATA
// itself arrives in English: commodity/series names come from the backend
// and the envelope `meta` strings (source / coverage / estimation /
// attribution) are composed server-side. Locale files cannot carry those
// — they are data, not UI keys — so this module translates them with
// exact-match dictionaries.
//
// Design rule: every lookup FALLS BACK TO THE INPUT when the string is
// unknown. Backend renames or new series degrade to English rather than
// ever mistranslating.

/// Base display names (the `baseSeriesName` output the UI renders) → ES.
const Map<String, String> _seriesNamesEs = {
  'Beans (black)': 'Frijol (negro)',
  'Beans (pinto)': 'Frijol (pinto)',
  'Beans (red)': 'Frijol (rojo)',
  'Beans (silk red)': 'Frijol (rojo seda)',
  'Beef': 'Carne de res',
  'Cabbage': 'Repollo',
  'Carrots': 'Zanahorias',
  'Central America food lost after harvest':
      'Alimentos de Centroamérica perdidos poscosecha',
  'Central America post-harvest food loss (FAO SDG 12.3.1)':
      'Pérdida poscosecha de alimentos en Centroamérica (FAO ODS 12.3.1)',
  'Chicken': 'Pollo',
  'DAP (US Gulf spot)': 'DAP (contado Golfo de EE. UU.)',
  'Eggs': 'Huevos',
  'Fish meal feed cost': 'Costo de harina de pescado',
  'Honey export unit value (El Salvador)':
      'Valor unitario de exportación de miel (El Salvador)',
  'Honey producer price (El Salvador)':
      'Precio al productor de miel (El Salvador)',
  'MOP (Brazil CFR granular)': 'MOP (Brasil CFR granular)',
  'Maize': 'Maíz',
  'Maize (white)': 'Maíz (blanco)',
  'PPI pesticide & ag-chemical manufacturing':
      'IPP de fabricación de plaguicidas y agroquímicos',
  'Pesticide import parity': 'Paridad de importación de plaguicidas',
  'Pork': 'Cerdo',
  'Rice': 'Arroz',
  'Rice (first quality)': 'Arroz (primera calidad)',
  'Sorghum': 'Sorgo',
  'TSP (US Gulf)': 'TSP (Golfo de EE. UU.)',
  'Tilapia fillets': 'Filetes de tilapia',
  'Tomatoes producer price (El Salvador)':
      'Precio al productor de tomate (El Salvador)',
  'Tomatoes producer price (Honduras)':
      'Precio al productor de tomate (Honduras)',
  'Urea (Middle East f.o.b.)': 'Urea (Oriente Medio f.o.b.)',
  'Urea import parity': 'Paridad de importación de urea',
  'Watermelons': 'Sandías',
  'Wheat': 'Trigo',
  'Whole tilapia': 'Tilapia entera',
};

/// Full served series names (def names, incl. market detail + tags) → ES.
/// Used for hover tooltips and the envelope coverage string.
const Map<String, String> _fullNamesEs = {
  'Beans (black), Guatemala La Terminal [regional]':
      'Frijol (negro), La Terminal de Guatemala [regional]',
  'Beans (pinto), Nicaragua national average [regional]':
      'Frijol (pinto), promedio nacional de Nicaragua [regional]',
  'Beans (red), Nicaragua national average [regional]':
      'Frijol (rojo), promedio nacional de Nicaragua [regional]',
  'Beans (red), San Salvador wholesale': 'Frijol (rojo), mayoreo San Salvador',
  'Beans (silk red), San Salvador wholesale':
      'Frijol (rojo seda), mayoreo San Salvador',
  'Beef (intl benchmark)': 'Carne de res (referencia internacional)',
  'Cabbage, Guatemala La Terminal wholesale [regional]':
      'Repollo, mayoreo La Terminal de Guatemala [regional]',
  'Carrots, Guatemala La Terminal wholesale [regional]':
      'Zanahorias, mayoreo La Terminal de Guatemala [regional]',
  'Central America food lost after harvest, before retail (share of food harvest by mass) (FAO SDG 12.3.1)':
      'Alimentos de Centroamérica perdidos poscosecha, antes del comercio minorista (proporción de la cosecha en masa) (FAO ODS 12.3.1)',
  'Central America post-harvest food loss (FAO SDG 12.3.1)':
      'Pérdida poscosecha de alimentos en Centroamérica (FAO ODS 12.3.1)',
  'Chicken (Brazil wholesale, intl benchmark)':
      'Pollo (mayoreo Brasil, referencia internacional)',
  'Chicken, Nicaragua national average [regional]':
      'Pollo, promedio nacional de Nicaragua [regional]',
  'DAP (US Gulf spot)': 'DAP (contado Golfo de EE. UU.)',
  'Eggs, Nicaragua national average [regional]':
      'Huevos, promedio nacional de Nicaragua [regional]',
  'Fish meal feed cost (intl benchmark)':
      'Costo de harina de pescado (referencia internacional)',
  'Honey export unit value (El Salvador)':
      'Valor unitario de exportación de miel (El Salvador)',
  'Honey producer price (El Salvador)':
      'Precio al productor de miel (El Salvador)',
  'MOP (Brazil CFR granular)': 'MOP (Brasil CFR granular)',
  'Maize (US #2, US Gulf intl benchmark)':
      'Maíz (US #2, Golfo de EE. UU., referencia internacional)',
  'Maize (white), Guatemala City (La Terminal) [regional]':
      'Maíz (blanco), Ciudad de Guatemala (La Terminal) [regional]',
  'Maize (white), Nicaragua national average [regional]':
      'Maíz (blanco), promedio nacional de Nicaragua [regional]',
  'Maize (white), San Salvador wholesale':
      'Maíz (blanco), mayoreo San Salvador',
  'PPI pesticide & ag-chemical manufacturing':
      'IPP de fabricación de plaguicidas y agroquímicos',
  'Pesticide import parity (El Salvador CIF)':
      'Paridad de importación de plaguicidas (CIF El Salvador)',
  'Pork, Nicaragua national average [regional]':
      'Cerdo, promedio nacional de Nicaragua [regional]',
  'Rice (first quality), Guatemala La Terminal [regional]':
      'Arroz (primera calidad), La Terminal de Guatemala [regional]',
  'Rice (intl benchmark)': 'Arroz (referencia internacional)',
  'Rice, San Salvador wholesale': 'Arroz, mayoreo San Salvador',
  'Sorghum (intl benchmark)': 'Sorgo (referencia internacional)',
  'Sorghum, Nicaragua national average [regional]':
      'Sorgo, promedio nacional de Nicaragua [regional]',
  'Sorghum, San Salvador wholesale': 'Sorgo, mayoreo San Salvador',
  'TSP (US Gulf)': 'TSP (Golfo de EE. UU.)',
  'Tilapia fillets, Honduras exports (FOB) [regional]':
      'Filetes de tilapia, exportaciones de Honduras (FOB) [regional]',
  'Tomatoes producer price (El Salvador)':
      'Precio al productor de tomate (El Salvador)',
  'Tomatoes producer price (Honduras) [regional]':
      'Precio al productor de tomate (Honduras) [regional]',
  'Urea (Middle East f.o.b.)': 'Urea (Oriente Medio f.o.b.)',
  'Urea import parity (El Salvador CIF)':
      'Paridad de importación de urea (CIF El Salvador)',
  'Watermelons, Guatemala La Terminal wholesale [regional]':
      'Sandías, mayoreo La Terminal de Guatemala [regional]',
  'Wheat (intl benchmark)': 'Trigo (referencia internacional)',
  'Whole tilapia, Costa Rica exports (FOB) [regional]':
      'Tilapia entera, exportaciones de Costa Rica (FOB) [regional]',
};

const Map<String, String> _countriesEs = {
  'Brazil': 'Brasil',
  'US Gulf': 'Golfo de EE. UU.',
  'Middle East': 'Oriente Medio',
  'World': 'Mundo',
  'United States': 'Estados Unidos',
};

const Map<String, String> _sourcesEs = {
  'GENIE.AI agri service (composite)':
      'Servicio agrícola de GENIE.AI (compuesto)',
  'WFP VAM via HDX (NASA MODIS)': 'VAM del PMA vía HDX (NASA MODIS)',
  'Curated advisories + OIRSA + iNaturalist':
      'Alertas curadas + OIRSA + iNaturalist',
};

/// Whole-string canned coverage values, and the phrase fragments the
/// composed coverage strings are built from.
const Map<String, String> _coverageEs = {
  'No data available yet': 'Aún no hay datos disponibles',
  'No data fetched yet — awaiting first successful prefetch':
      'Aún no se han obtenido datos — esperando la primera descarga exitosa',
  'No NDVI data available': 'No hay datos de NDVI disponibles',
  'Seasonal advisories (curated), OIRSA regional news and community sightings from the last 90 days — no live official alert feed exists for Central America':
      'Alertas estacionales (curadas), noticias regionales de OIRSA y avistamientos comunitarios de los últimos 90 días — no existe un canal oficial de alertas en vivo para Centroamérica',
  ' — monthly aggregates (last observation of each month)':
      ' — agregados mensuales (última observación de cada mes)',
};

const Map<String, String> _attributionEs = {
  'Source: WFP VAM via HDX (CC BY 4.0)':
      'Fuente: VAM del PMA vía HDX (CC BY 4.0)',
};

/// UI locale ('en' | 'es') → BCP47 tag for date formatting (intl).
String agriDateLocale(String locale) => locale == 'es' ? 'es-SV' : 'en-US';

/// Localize a base display name. Unknown → input (never mistranslates).
String localizeSeriesName(String baseName, String locale) {
  if (locale != 'es') return baseName;
  return _seriesNamesEs[baseName] ?? baseName;
}

/// Full-name lookup with a converted-tag retry: served benchmark names can
/// carry a technical ' [converted USD/mt to QQ]' suffix — look the human
/// part up and re-attach the tag untranslated.
String _lookupFullName(String name) {
  final direct = _fullNamesEs[name];
  if (direct != null) return direct;
  final m = RegExp(r'^(.*?)\s*\[converted[^\]]*\]\s*$').firstMatch(name);
  if (m != null) {
    final human = _fullNamesEs[m.group(1)!];
    if (human != null) {
      return human + name.substring(m.group(1)!.length);
    }
  }
  return name;
}

/// Localize a full served series name. Unknown → input.
String localizeFullName(String fullName, String locale) {
  if (locale != 'es') return fullName;
  return _fullNamesEs[fullName] ?? fullName;
}

/// Localize the composed market-coverage string:
///   "NAME (COUNTRY, through DATE); ... — monthly aggregates (...)"
/// Each segment is rewritten as "NAME (PAÍS, hasta FECHA)"; the name part
/// goes through the full-name dictionary, the country through the country
/// dictionary. Unknown pieces pass through unchanged.
String localizeCoverage(String? coverage, String locale) {
  if (coverage == null || coverage.isEmpty || locale != 'es') {
    return coverage ?? '';
  }
  var out = _coverageEs[coverage] ?? coverage;
  // Whole-string matches (canned values) are done — segment rewriting only
  // applies to the composed market format (contains ", through ").
  if (!out.contains(', through ')) return out;

  final suffixRe = RegExp(
    r'(\s—\smonthly aggregates \(last observation of each month\))$',
  );
  var suffix = '';
  final suffixMatch = suffixRe.firstMatch(out);
  if (suffixMatch != null) {
    suffix = ' — agregados mensuales (última observación de cada mes)';
    out = out.substring(0, suffixMatch.start);
  }
  final segments = out.split('; ');
  final segmentRe = RegExp(r'^(.*)\s*\((.*),\s*through\s+(.*?)\)$');
  final translated = segments
      .map((seg) {
        final m = segmentRe.firstMatch(seg);
        if (m == null) return seg;
        final rawName = m.group(1)!;
        final country = m.group(2)!;
        final date = m.group(3)!;
        final c = _countriesEs[country.trim()] ?? country.trim();
        final n = _lookupFullName(rawName.trim());
        return '$n ($c, hasta $date)';
      })
      .join('; ');
  return '$translated$suffix';
}

/// Localize the CPI-estimation disclosure:
///   "2015–2025 values are inflation-adjusted estimates (base: 2007
///   actual, El Salvador CPI)[; current-year ...]"
String localizeEstimation(String? estimation, String locale) {
  if (estimation == null || estimation.isEmpty || locale != 'es') {
    return estimation ?? '';
  }
  final m = RegExp(
    r'^(\S+) values are inflation-adjusted estimates \(base: (.+) actual, El Salvador CPI\)(; current-year CPI projected at last known rate)?$',
  ).firstMatch(estimation);
  if (m == null) return estimation;
  final range = m.group(1)!;
  final baseYears = m.group(2)!;
  final partial = m.group(3);
  final tail = partial != null
      ? '; IPC del año en curso proyectado a la última tasa conocida'
      : '';
  return '$range valores son estimaciones ajustadas por inflación (base: $baseYears real, IPC de El Salvador)$tail';
}

/// Localize an envelope `meta` object (source/coverage/estimation/
/// attribution). Returns a shallow copy; unknown values pass through.
Map<String, dynamic> localizeMeta(Map<String, dynamic>? meta, String locale) {
  if (meta == null || locale != 'es') return meta ?? {};
  final out = Map<String, dynamic>.of(meta);
  final source = out['source'] as String?;
  if (source != null) out['source'] = _sourcesEs[source] ?? source;
  final coverage = out['coverage'] as String?;
  if (coverage != null) out['coverage'] = localizeCoverage(coverage, locale);
  final estimation = out['estimation'] as String?;
  if (estimation != null) {
    out['estimation'] = localizeEstimation(estimation, locale);
  }
  final attribution = out['attribution'] as String?;
  if (attribution != null) {
    out['attribution'] = _attributionEs[attribution] ?? attribution;
  }
  return out;
}
