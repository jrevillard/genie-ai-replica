import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/utils/geo_utils.dart';

Map<String, dynamic> _polygonFeature(List<List<double>> ring) => {
  'type': 'Feature',
  'geometry': {
    'type': 'Polygon',
    'coordinates': [ring],
  },
  'properties': const {},
};

void main() {
  group('computeGeojsonBbox', () {
    test('returns [minLon, minLat, maxLon, maxLat] across features', () {
      final bbox = computeGeojsonBbox([
        _polygonFeature([
          [90.0, 23.0],
          [90.5, 23.0],
          [90.5, 23.5],
        ]),
        {
          'type': 'Feature',
          'geometry': {
            'type': 'MultiPolygon',
            'coordinates': [
              [
                [
                  [89.5, 24.0],
                  [89.6, 24.1],
                ],
              ],
            ],
          },
        },
      ]);
      expect(bbox, [89.5, 23.0, 90.5, 24.1]);
    });

    test('returns null when there are no coordinates', () {
      expect(computeGeojsonBbox(const []), isNull);
      expect(
        computeGeojsonBbox([
          {'type': 'Feature'},
        ]),
        isNull,
      );
    });
  });

  group('geoLayersFromMetadata', () {
    final fields = {
      'type': 'FeatureCollection',
      'features': [
        _polygonFeature([
          [90.0, 23.0],
          [90.1, 23.0],
          [90.1, 23.1],
        ]),
      ],
    };

    test('builds a field-boundaries layer labelled with field_count', () {
      final layers = geoLayersFromMetadata({
        'field_delineation': {'field_count': 84, 'fields_geojson': fields},
      });
      expect(layers, hasLength(1));
      expect(layers.single.id, 'field-boundaries');
      expect(layers.single.label, 'Field boundaries (84)');
      expect(layers.single.features, hasLength(1));
    });

    test('builds a flood layer and keeps both when present', () {
      final layers = geoLayersFromMetadata({
        'field_delineation': {'fields_geojson': fields},
        'flood_analysis': {'flood_geojson': fields},
      });
      expect(layers.map((l) => l.id), ['field-boundaries', 'flood-areas']);
      expect(layers.first.label, 'Field boundaries (1)');
      expect(layers.last.label, 'Flood extent');
    });

    test('is empty for null, RAG-only metadata or empty collections', () {
      expect(geoLayersFromMetadata(null), isEmpty);
      expect(
        geoLayersFromMetadata({'sources': [], 'confidence_score': 0.9}),
        isEmpty,
      );
      expect(
        geoLayersFromMetadata({
          'field_delineation': {
            'fields_geojson': {'features': []},
          },
          'flood_analysis': null,
        }),
        isEmpty,
      );
    });
  });

  group('isBareMapIntent', () {
    test('matches the bare English / Banglish / Bengali forms', () {
      for (final t in [
        'show me the map',
        'Show me the map.',
        'show map',
        'open the map',
        'please show me the map',
        'manchitro dekhao',
        'মানচিত্র দেখাও',
        'আমার মানচিত্র দেখান',
        'ম্যাপ দেখাও।',
      ]) {
        expect(isBareMapIntent(t), isTrue, reason: t);
      }
    });

    test('does not match a map request that names a place, or other text', () {
      for (final t in [
        'show me the map Rangpur',
        'মানচিত্র দেখাও রংপুর',
        'map my field',
        'What is the weather this week?',
        'show me the map of the world please explain',
      ]) {
        expect(isBareMapIntent(t), isFalse, reason: t);
      }
    });
  });

  group('parseMapIntent', () {
    test('matches the English and Banglish forms (case-insensitive)', () {
      expect(parseMapIntent('show me the map Rangpur'), 'Rangpur');
      expect(parseMapIntent('Show Me The Map  Cox\'s Bazar '), "Cox's Bazar");
      expect(parseMapIntent('manchitro dekhao Sylhet'), 'Sylhet');
    });

    test('matches the Bengali forms', () {
      expect(parseMapIntent('মানচিত্র দেখাও রংপুর'), 'রংপুর');
      expect(parseMapIntent('রংপুর এর মানচিত্র দেখাও'), 'রংপুর');
      expect(parseMapIntent('ঢাকা মানচিত্র দেখান'), 'ঢাকা');
    });

    test('returns null for ordinary questions', () {
      expect(parseMapIntent('What is the weather this week in Dhaka?'), isNull);
      expect(parseMapIntent('show me the map'), isNull);
      expect(parseMapIntent('delineate fields around Bogra'), isNull);
    });
  });
}
