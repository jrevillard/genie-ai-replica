import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/services/world_bank_service.dart';

/// Integration test for market price cards
/// Verifies all 8 categories can load data
void main() {
  group('Market Cards Integration Test', () {
    late WorldBankService service;

    setUp(() {
      service = WorldBankService();
    });

    test('All market categories return data', () async {
      print('\n=== Testing All Market Categories ===\n');

      final results = await service.getAllMarketData();

      expect(results, isNotNull);
      expect(results['maize'], isNotNull);
      expect(results['cropProtection'], isNotNull);
      expect(results['vegetables'], isNotNull);
      expect(results['livestock'], isNotNull);
      expect(results['fertilizer'], isNotNull);
      expect(results['apiary'], isNotNull);
      expect(results['aquaculture'], isNotNull);
      expect(results['harvestStorage'], isNotNull);

      final categories = [
        'maize',
        'cropProtection',
        'vegetables',
        'livestock',
        'fertilizer',
        'apiary',
        'aquaculture',
        'harvestStorage',
      ];

      var successCount = 0;
      for (final category in categories) {
        final data = results[category] as Map<String, dynamic>?;
        if (data != null) {
          final timeSeries = data['data'] as List?;
          if (timeSeries != null && timeSeries.isNotEmpty) {
            successCount++;
            print('✓ $category: ${timeSeries.length} data points');
          } else {
            print('⚠ $category: No data points');
          }
        } else {
          print('✗ $category: Null');
        }
      }

      print('\n=== Summary: $successCount/8 categories have data ===\n');

      // All 8 should have data
      expect(successCount, equals(8),
          reason: 'All 8 market categories should return data');
    });

    tearDown(() {
      service.dispose();
    });
  });
}
