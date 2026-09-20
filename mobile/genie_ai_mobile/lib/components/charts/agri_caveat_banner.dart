// lib/components/charts/agri_caveat_banner.dart
import 'package:flutter/material.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';

/// On-screen data caveats for the agri charts (user requirement):
/// regional references, inflation-adjusted estimates, annual-only data,
/// single-market coverage and cache freshness are shown as visible chips,
/// with an expandable "About this data" panel — never buried in tooltips.
class AgriCaveatBanner extends StatelessWidget {
  const AgriCaveatBanner({super.key, required this.data});

  /// The chart payload map (legacy shape) carrying caveat fields:
  /// caveats, coverage, estimation, dataSource, lastUpdated.
  final Map<String, dynamic>? data;

  static const Map<String, Map<String, String>> _labels = {
    'REGIONAL_DATA': {'en': 'Regional data', 'es': 'Datos regionales'},
    'ESTIMATED_CPI': {
      'en': 'Inflation-adjusted estimate',
      'es': 'Estimación ajustada por inflación',
    },
    'GAP_YEARS': {'en': 'Missing years', 'es': 'Años faltantes'},
    'ANNUAL_ONLY': {'en': 'Annual data', 'es': 'Datos anuales'},
    'SINGLE_MARKET': {'en': 'Single market', 'es': 'Mercado único'},
    'COMMUNITY_DATA': {'en': 'Community data', 'es': 'Datos comunitarios'},
    'CURATED_STAT': {'en': 'Curated statistic', 'es': 'Estadística curada'},
    'PROXY_INDEX': {'en': 'Proxy index', 'es': 'Índice proxy'},
    'STALE_CACHE': {'en': 'Cached data', 'es': 'Datos en caché'},
  };

  String _t(Map<String, String> m) {
    final lang = I18nService().currentLocale.languageCode == 'es' ? 'es' : 'en';
    return m[lang] ?? m['en']!;
  }

  /// Freshness pill (Vue parity): "Bundled snapshot" / "Saved data — X old"
  /// / "Updated X ago". Returns (label, isWarning) or null when the payload
  /// carries no fetch timestamp.
  (String, bool)? _freshnessChip() {
    final fetchedAt = (data?['fetchedAt'] ?? data?['lastUpdated']) as String?;
    if (fetchedAt == null || fetchedAt.isEmpty) return null;
    final fetched = DateTime.tryParse(fetchedAt);
    final seeded = data?['seeded'] == true;
    final stale = data?['stale'] == true;
    final isEs = I18nService().currentLocale.languageCode == 'es';
    if (seeded) {
      return (isEs ? 'Instantánea incluida' : 'Bundled snapshot', true);
    }
    String age;
    if (fetched != null) {
      final hours = DateTime.now().difference(fetched).inMinutes / 60.0;
      age = hours < 1
          ? '${(hours * 60).round().clamp(1, 59)} min'
          : hours < 48
          ? '${hours.round()} h'
          : '${(hours / 24).round()} d';
    } else {
      age = '';
    }
    if (stale) {
      return (
        isEs ? 'Datos guardados — hace $age' : 'Saved data — $age old',
        true,
      );
    }
    return (isEs ? 'Actualizado hace $age' : 'Updated $age ago', false);
  }

  List<(String, String)> _chips() {
    final out = <(String, String)>[];
    final caveats = (data?['caveats'] as List?) ?? [];
    for (final c in caveats) {
      if (c is! Map) continue;
      final code = c['code'] as String? ?? '';
      final params = (c['params'] as Map?) ?? {};
      var label = _t(_labels[code] ?? {code: code});
      if (code == 'REGIONAL_DATA' && params['country'] != null) {
        label = '$label: ${params['country']}';
      }
      if (code == 'ESTIMATED_CPI' && params['years'] != null) {
        label = '$label (${params['years']})';
      }
      if (code == 'ANNUAL_ONLY' && params['lastYear'] != null) {
        label = '$label (${params['lastYear']})';
      }
      out.add((code, label));
    }
    return out;
  }

  @override
  Widget build(BuildContext context) {
    final chips = _chips();
    final theme = Theme.of(context);
    final fresh = _freshnessChip();
    if (chips.isEmpty && fresh == null && data?['coverage'] == null) {
      return const SizedBox.shrink();
    }

    return Container(
      margin: const EdgeInsets.only(top: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: 6,
            runSpacing: 4,
            children: [
              // Freshness pill first (Vue parity: warning when seeded/
              // stale, success when freshly updated).
              if (fresh != null)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: (fresh.$2 ? Colors.amber : Colors.green).withValues(
                      alpha: 0.15,
                    ),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    fresh.$1,
                    style: theme.textTheme.bodySmall?.copyWith(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: fresh.$2
                          ? (theme.brightness == Brightness.dark
                                ? Colors.amber.shade300
                                : Colors.amber.shade800)
                          : (theme.brightness == Brightness.dark
                                ? Colors.green.shade300
                                : Colors.green.shade700),
                    ),
                  ),
                ),
              ...chips.map(
                (c) => Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color:
                        (c.$1 == 'ESTIMATED_CPI' || c.$1 == 'PROXY_INDEX'
                                ? Colors.amber
                                : theme.colorScheme.secondary)
                            .withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    c.$2,
                    style: theme.textTheme.bodySmall?.copyWith(
                      fontSize: 11,
                      color: theme.colorScheme.onSurface,
                    ),
                  ),
                ),
              ),
            ],
          ),
          Theme(
            data: theme.copyWith(dividerColor: Colors.transparent),
            child: ExpansionTile(
              tilePadding: EdgeInsets.zero,
              dense: true,
              visualDensity: VisualDensity.compact,
              title: Text(
                I18nService().currentLocale.languageCode == 'es'
                    ? 'Sobre estos datos'
                    : 'About this data',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.primary,
                ),
              ),
              children: [
                if (data?['dataSource'] != null)
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      '${I18nService().currentLocale.languageCode == 'es' ? 'Fuente' : 'Source'}: ${data!['dataSource']}',
                      style: theme.textTheme.bodySmall,
                    ),
                  ),
                if (data?['coverage'] != null)
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      '${I18nService().currentLocale.languageCode == 'es' ? 'Cobertura' : 'Coverage'}: ${data!['coverage']}',
                      style: theme.textTheme.bodySmall,
                    ),
                  ),
                if (data?['estimation'] != null)
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      '${I18nService().currentLocale.languageCode == 'es' ? 'Estimaciones' : 'Estimates'}: ${data!['estimation']}',
                      style: theme.textTheme.bodySmall,
                    ),
                  ),
                const SizedBox(height: 4),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
