import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/components/charts/agri_i18n.dart';

/// Parity spec §12bis (S27) — data-layer localization dictionaries ported
/// verbatim from the web's agri-i18n.js. Unknown input must fall back to
/// the input (never mistranslate); localizeMeta translates source +
/// coverage + estimation together.
void main() {
  group('localizeSeriesName (S27)', () {
    test('translates known base names to Spanish', () {
      expect(localizeSeriesName('Maize (white)', 'es'), 'Maíz (blanco)');
      expect(
        localizeSeriesName('Beans (silk red)', 'es'),
        'Frijol (rojo seda)',
      );
      expect(localizeSeriesName('Beef', 'es'), 'Carne de res');
    });

    test('unknown input returns unchanged (never mistranslates)', () {
      expect(
        localizeSeriesName('Brand New Commodity', 'es'),
        'Brand New Commodity',
      );
      expect(localizeSeriesName('Maize (white)', 'en'), 'Maize (white)');
    });
  });

  group('localizeFullName (S27)', () {
    test('translates known full names', () {
      expect(
        localizeFullName('Maize (white), San Salvador wholesale', 'es'),
        'Maíz (blanco), mayoreo San Salvador',
      );
    });

    test('unknown full names pass through unchanged', () {
      expect(
        localizeFullName('Quinoa, San Salvador wholesale', 'es'),
        'Quinoa, San Salvador wholesale',
      );
    });
  });

  group('localizeCoverage (S27)', () {
    test('canned whole-string values translate directly', () {
      expect(
        localizeCoverage('No data available yet', 'es'),
        'Aún no hay datos disponibles',
      );
    });

    test('composed market coverage segments rewrite (name, country, date)', () {
      const coverage =
          'Maize (white), San Salvador wholesale (El Salvador, through 2026-08); '
          'Maize (US #2, US Gulf intl benchmark) (United States, through 2026-08) '
          '— monthly aggregates (last observation of each month)';
      final out = localizeCoverage(coverage, 'es');
      expect(
        out,
        contains('mayoreo San Salvador (El Salvador, hasta 2026-08)'),
      );
      expect(
        out,
        contains(
          'Maíz (US #2, Golfo de EE. UU., referencia internacional) (Estados Unidos, hasta 2026-08)',
        ),
      );
      expect(
        out,
        endsWith('agregados mensuales (última observación de cada mes)'),
      );
    });
  });

  group('localizeEstimation (S27)', () {
    test('CPI template translates with and without the current-year tail', () {
      expect(
        localizeEstimation(
          '2015–2025 values are inflation-adjusted estimates (base: 2007 actual, El Salvador CPI)',
          'es',
        ),
        '2015–2025 valores son estimaciones ajustadas por inflación (base: 2007 real, IPC de El Salvador)',
      );
      expect(
        localizeEstimation(
          '2015–2025 values are inflation-adjusted estimates (base: 2007 actual, El Salvador CPI); current-year CPI projected at last known rate',
          'es',
        ),
        endsWith('IPC del año en curso proyectado a la última tasa conocida'),
      );
    });

    test('unknown estimation text passes through', () {
      expect(localizeEstimation('Some other note', 'es'), 'Some other note');
    });
  });

  group('localizeMeta (S27)', () {
    test('fixture envelope translates source+coverage+estimation together', () {
      final out = localizeMeta({
        'source': 'GENIE.AI agri service (composite)',
        'coverage':
            'Maize (white), San Salvador wholesale (El Salvador, through 2026-08) — monthly aggregates (last observation of each month)',
        'estimation':
            '2015–2025 values are inflation-adjusted estimates (base: 2007 actual, El Salvador CPI)',
        'attribution': 'Source: WFP VAM via HDX (CC BY 4.0)',
        'stale': false,
      }, 'es');
      expect(out['source'], 'Servicio agrícola de GENIE.AI (compuesto)');
      expect(out['coverage'], contains('hasta 2026-08'));
      expect(out['estimation'], contains('IPC de El Salvador'));
      expect(out['attribution'], 'Fuente: VAM del PMA vía HDX (CC BY 4.0)');
      expect(out['stale'], false);
    });

    test('en locale returns meta unchanged', () {
      final meta = {'source': 'GENIE.AI agri service (composite)'};
      expect(identical(localizeMeta(meta, 'en'), meta), isTrue);
    });
  });
}
