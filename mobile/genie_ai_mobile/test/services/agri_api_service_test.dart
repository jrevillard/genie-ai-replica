import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/services/agri_api_service.dart';

/// Parity spec §14 test 1 — data mapping (S1):
/// a 3-series / 2-unit / 1-estimated fixture envelope maps 1:1.
void main() {
  group('AgriApiService.mapMarketPricesEnvelope (S1)', () {
    final fixture = <String, dynamic>{
      'data': {
        'title': 'Maize, Beans & Grains',
        'unit': 'USD/quintal (46 kg)',
        'trend': 'up',
        'latest': 26.61,
        'series': [
          {
            'name': 'Maize (white), San Salvador wholesale',
            'unit': 'USD/quintal (46 kg)',
            'country': 'El Salvador',
            'data': [
              {'date': '2026-07-31', 'value': 26.1, 'quality': 'actual'},
              {'date': '2026-08-31', 'value': 26.61, 'quality': 'estimated'},
            ],
          },
          {
            'name': 'Maize (white), Guatemala wholesale',
            'unit': 'USD/quintal (46 kg)',
            'country': 'Guatemala',
            'data': [
              {'date': '2026-08-31', 'value': 30.2, 'quality': 'actual'},
            ],
          },
          {
            'name': 'Maize (US #2), US Gulf intl benchmark [converted to USD/quintal (46 kg)]',
            'unit': 'USD/quintal (46 kg)',
            'country': 'United States',
            'data': [
              // value arrives as int from some adapters — must coerce
              {'date': '2026-08-31', 'value': 7, 'quality': 'actual'},
            ],
          },
        ],
      },
      'meta': {
        'fetchedAt': '2026-09-19T10:00:00.000Z',
        'source': 'wfp-vam',
        'coverage': 'El Salvador, Guatemala, regional benchmarks',
        'estimation': null,
        'stale': false,
        'caveats': <dynamic>[],
      },
    };

    test('maps every series 1:1 (S1 pass-through)', () {
      final r = AgriApiService.mapMarketPricesEnvelope('grains', fixture);
      expect(r['series'], hasLength(3));
      final s0 = r['series'][0] as Map<String, dynamic>;
      expect(s0['name'], 'Maize (white), San Salvador wholesale');
      expect(s0['unit'], 'USD/quintal (46 kg)');
      expect(s0['country'], 'El Salvador');
      expect(s0['points'], hasLength(2));
      final p0 = s0['points'][1] as Map<String, dynamic>;
      expect(p0['date'], '2026-08-31');
      expect(p0['value'], 26.61);
      expect(p0['quality'], 'estimated');
    });

    test('coerces numeric values to double', () {
      final r = AgriApiService.mapMarketPricesEnvelope('grains', fixture);
      final s2 = r['series'][2] as Map<String, dynamic>;
      final p = (s2['points'][0] as Map<String, dynamic>);
      expect(p['value'], isA<double>());
      expect(p['value'], 7.0);
    });

    test('keeps envelope meta passthrough', () {
      final r = AgriApiService.mapMarketPricesEnvelope('grains', fixture);
      final meta = r['meta'] as Map<String, dynamic>;
      expect(meta['source'], 'wfp-vam');
      expect(meta['coverage'], 'El Salvador, Guatemala, regional benchmarks');
      expect(meta['stale'], false);
      // envelope-level fields ride along
      expect(r['title'], 'Maize, Beans & Grains');
      expect(r['trend'], 'up');
      expect(r['latest'], 26.61);
    });

    test('primarySeries aliases series[0] (legacy screens keep working)', () {
      final r = AgriApiService.mapMarketPricesEnvelope('grains', fixture);
      expect(r['primarySeries'], same(r['series'][0]));
    });

    test('empty envelope maps to empty series without throwing (S2)', () {
      final r = AgriApiService.mapMarketPricesEnvelope('grains', {
        'data': <String, dynamic>{},
        'meta': <String, dynamic>{},
      });
      expect(r['series'], isEmpty);
      expect(r['primarySeries'], isNull);
      expect(r['title'], isNull);
    });

    test('malformed series entries do not throw (S2 never-fail)', () {
      final r = AgriApiService.mapMarketPricesEnvelope('grains', {
        'data': {
          'series': [
            {'name': 'Broken series'},
            {
              'name': 'Partial series',
              'data': [
                {'date': '2026-08-31'},
                'not-a-map',
              ],
            },
          ],
        },
        'meta': <String, dynamic>{},
      });
      expect(r['series'], hasLength(2));
      final s1 = r['series'][1] as Map<String, dynamic>;
      // the 'not-a-map' point is dropped; only the map point survives
      expect((s1['points'] as List), hasLength(1));
      expect((s1['points'][0] as Map<String, dynamic>)['value'], isNull);
    });
  });
}
