// lib/components/charts/series_display.dart
//
// Display-name algorithm shared by the chart legend, series toggles,
// data table headers and the Latest card — ported 1:1 from the Vue app
// (components/gov-chat-frontend/src/components/charts/MarketPriceChart.vue,
// baseSeriesName / countryTag / dispName). Parity spec §2.
//
// Vue-compat guardrail (spec §v4.3): these helpers live in ONE file and
// are referenced by tests — never re-derive names at call sites.

/// Strip regional/converted brackets, benchmark parentheses and
/// trailing detail — the base commodity name used for collisions and
/// for the ES/EN localization dictionaries.
String baseSeriesName(String name) {
  var s = name;
  s = s.replaceFirst(
    RegExp(r'\s*\[(regional|converted[^\]]*)\]', caseSensitive: false),
    '',
  );
  s = s.replaceFirst(
    RegExp(
      r'\s*\([^)]*(?:intl|international|benchmark|fob|cif)[^)]*\)',
      caseSensitive: false,
    ),
    '',
  );
  s = s.split(',')[0].trim();
  // An opening paren whose closer was cut off by the comma split —
  // drop the dangling fragment.
  if ('('.allMatches(s).length > ')'.allMatches(s).length) {
    s = s.replaceFirst(RegExp(r'\s*\([^)]*$'), '').trim();
  }
  return s.isEmpty ? name : s;
}

/// Country tag from the FULL series name (first match wins).
String countryTag(String name) {
  if (RegExp(r'intl benchmark|US Gulf', caseSensitive: false).hasMatch(name)) {
    return 'intl';
  }
  if (name.contains('San Salvador') || name.contains('El Salvador')) {
    return 'SV';
  }
  if (name.contains('Guatemala')) return 'GT';
  if (name.contains('Nicaragua')) return 'NIC';
  if (name.contains('Honduras')) return 'HN';
  if (name.contains('Costa Rica')) return 'CR';
  if (name.contains('Brazil')) return 'BR';
  if (name.contains('Middle East')) return 'ME';
  return '';
}

/// Display name: base name, country-tagged ONLY on base-name collisions
/// within [allNames] (the category's full series list).
String displayName(String name, List<String> allNames) {
  final base = baseSeriesName(name);
  final othersShareBase = allNames
      .where((n) => n != name)
      .any((n) => baseSeriesName(n) == base);
  if (othersShareBase) {
    final tag = countryTag(name);
    return tag.isEmpty ? base : '$base ($tag)';
  }
  return base;
}

/// Chip country tag for acronym codes (web: chipCountryTag — an ordered,
/// case-insensitive table distinct from [countryTag]).
String chipCountryTag(String name) {
  final up = name.toUpperCase();
  const table = [
    ['EL SALVADOR', 'SV'],
    ['SAN SALVADOR', 'SV'],
    ['GUATEMALA', 'GT'],
    ['NICARAGUA', 'NI'],
    ['HONDURAS', 'HN'],
    ['COSTA RICA', 'CR'],
    ['BRAZIL', 'BR'],
    ['US GULF', 'US'],
    ['UNITED STATES', 'US'],
    ['MIDDLE EAST', 'ME'],
    ['WORLD', 'INT'],
    ['INTL', 'INT'],
    ['BENCHMARK', 'INT'],
  ];
  for (final entry in table) {
    if (up.contains(entry[0])) return entry[1];
  }
  return '';
}

/// Acronym chip code for ONE series (web: commodityCode) — first word of
/// the base name, letters only, first 3 chars, uppercase ('???' when
/// empty); the chip country tag is appended when one matches.
String commodityCode(String name) {
  final short = baseSeriesName(name);
  final first = short
      .split(RegExp(r'\s+'))
      .firstWhere((w) => w.isNotEmpty, orElse: () => '');
  final letters = first.replaceAll(RegExp(r'[^A-Za-z]'), '');
  final capped = letters.length > 3 ? letters.substring(0, 3) : letters;
  final base = capped.isEmpty ? '???' : capped.toUpperCase();
  final tag = chipCountryTag(name);
  return tag.isEmpty ? base : '$base-$tag';
}

/// Final chip codes for a whole category (web: the chips computed) —
/// when a code repeats, tagless duplicates gain their country tag, and
/// any remaining collisions get numeric suffixes (`CODE-2`, `CODE-3`…).
List<String> commodityCodes(List<String> names) {
  final codes = names.map(commodityCode).toList();
  final counts = <String, int>{};
  for (final c in codes) {
    counts[c] = (counts[c] ?? 0) + 1;
  }
  final seen = <String, int>{};
  return List.generate(names.length, (i) {
    var code = codes[i];
    if ((counts[code] ?? 0) > 1 && !code.contains('-')) {
      final tag = chipCountryTag(names[i]);
      if (tag.isNotEmpty) code = '$code-$tag';
    }
    final n = (seen[code] ?? 0) + 1;
    seen[code] = n;
    if (n > 1) code = '$code-$n';
    return code;
  });
}
