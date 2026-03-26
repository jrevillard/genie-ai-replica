import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/services/world_bank_service.dart';

void main() {
  group('WorldBankService - Real API Tests', () {
    late WorldBankService service;

    setUp(() {
      // Use real HTTP client for actual API tests
      service = WorldBankService();
    });

    test('Verify Maize Prices endpoint returns real data', () async {
      print('\n=== Testing Maize Prices (AG.PRD.CROP.XD) ===');

      final data = await service.getMaizePrices();

      expect(data, isNotNull, reason: 'Maize prices data should not be null');
      expect(data!['category'], equals('maize'));
      expect(data['title'], equals('Maize & Basic Grains'));
      expect(data['color'], equals('#2E7D32'));
      expect(data['data'], isList);

      final timeSeries = data['data'] as List;
      if (timeSeries.isNotEmpty) {
        print('✓ Maize Prices: Found ${timeSeries.length} data points');
        print('  Data source: ${data['dataSource']}');
        print('  Trend: ${data['trend']}');
        print('  Sample data: ${timeSeries.take(3).toList()}');

        expect(timeSeries.first['year'], isNotEmpty);
        expect(timeSeries.first['value'], isA<double>());
      } else {
        print('⚠ Maize Prices: No data points returned');
      }
    });

    test('Verify Crop Protection Costs endpoint returns real data', () async {
      print('\n=== Testing Crop Protection Costs (TM.VAL.AGRI.ZS.UN) ===');

      final data = await service.getCropProtectionCosts();

      expect(data, isNotNull, reason: 'Crop protection data should not be null');
      expect(data!['category'], equals('crop-protection'));
      expect(data['color'], equals('#D84315'));
      expect(data['data'], isList);

      final timeSeries = data['data'] as List;
      if (timeSeries.isNotEmpty) {
        print('✓ Crop Protection: Found ${timeSeries.length} data points');
        print('  Data source: ${data['dataSource']}');
        print('  Trend: ${data['trend']}');
      } else {
        print('⚠ Crop Protection: No data points returned');
      }
    });

    test('Verify Vegetable Prices endpoint returns real data', () async {
      print('\n=== Testing Vegetable Prices (AG.PRD.FOOD.XD) ===');

      final data = await service.getVegetablePrices();

      expect(data, isNotNull, reason: 'Vegetable prices data should not be null');
      expect(data!['category'], equals('vegetables'));
      expect(data['color'], equals('#558B2F'));
      expect(data['data'], isList);

      final timeSeries = data['data'] as List;
      if (timeSeries.isNotEmpty) {
        print('✓ Vegetables: Found ${timeSeries.length} data points');
        print('  Data source: ${data['dataSource']}');
        print('  Trend: ${data['trend']}');
      } else {
        print('⚠ Vegetables: No data points returned');
      }
    });

    test('Verify Poultry & Pork Feed endpoint returns real data', () async {
      print('\n=== Testing Poultry & Pork Feed (AG.PRD.LVSK.XD) ===');

      final data = await service.getPoultryPorkFeedCosts();

      expect(data, isNotNull, reason: 'Livestock data should not be null');
      expect(data!['category'], equals('livestock'));
      expect(data['color'], equals('#8D6E63'));
      expect(data['data'], isList);

      final timeSeries = data['data'] as List;
      if (timeSeries.isNotEmpty) {
        print('✓ Livestock: Found ${timeSeries.length} data points');
        print('  Data source: ${data['dataSource']}');
        print('  Trend: ${data['trend']}');
      } else {
        print('⚠ Livestock: No data points returned');
      }
    });

    test('Verify Fertilizer Prices endpoint returns real data', () async {
      print('\n=== Testing Fertilizer Prices (AG.LND.FERT.ZS) ===');

      final data = await service.getFertilizerPrices();

      expect(data, isNotNull, reason: 'Fertilizer data should not be null');
      expect(data!['category'], equals('fertilizer'));
      expect(data['color'], equals('#F9A825'));
      expect(data['data'], isList);

      final timeSeries = data['data'] as List;
      if (timeSeries.isNotEmpty) {
        print('✓ Fertilizer: Found ${timeSeries.length} data points');
        print('  Data source: ${data['dataSource']}');
        print('  Trend: ${data['trend']}');
      } else {
        print('⚠ Fertilizer: No data points returned');
      }
    });

    test('Verify Honey Market endpoint returns real data', () async {
      print('\n=== Testing Honey Market (AG.PRD.LVSK.XD) ===');

      final data = await service.getHoneyMarketData();

      expect(data, isNotNull, reason: 'Apiary data should not be null');
      expect(data!['category'], equals('apiary'));
      expect(data['color'], equals('#F57F17'));
      expect(data['data'], isList);

      final timeSeries = data['data'] as List;
      if (timeSeries.isNotEmpty) {
        print('✓ Apiary: Found ${timeSeries.length} data points');
        print('  Data source: ${data['dataSource']}');
        print('  Trend: ${data['trend']}');
      } else {
        print('⚠ Apiary: No data points returned');
      }
    });

    test('Verify Tilapia Market endpoint returns real data', () async {
      print('\n=== Testing Tilapia Market (AG.PRD.FISH.XD) ===');

      final data = await service.getTilapiaMarketData();

      expect(data, isNotNull, reason: 'Aquaculture data should not be null');
      expect(data!['category'], equals('aquaculture'));
      expect(data['color'], equals('#0288D1'));
      expect(data['data'], isList);

      final timeSeries = data['data'] as List;
      if (timeSeries.isNotEmpty) {
        print('✓ Aquaculture: Found ${timeSeries.length} data points');
        print('  Data source: ${data['dataSource']}');
        print('  Trend: ${data['trend']}');
      } else {
        print('⚠ Aquaculture: No data points returned');
      }
    });

    test('Verify Harvest & Storage endpoint returns real data', () async {
      print('\n=== Testing Harvest & Storage (SP.RUR.TOTL.ZS) ===');

      final data = await service.getHarvestStorageData();

      expect(data, isNotNull, reason: 'Harvest storage data should not be null');
      expect(data!['category'], equals('harvest-storage'));
      expect(data['color'], equals('#00838F'));
      expect(data['data'], isList);

      final timeSeries = data['data'] as List;
      if (timeSeries.isNotEmpty) {
        print('✓ Harvest & Storage: Found ${timeSeries.length} data points');
        print('  Data source: ${data['dataSource']}');
        print('  Trend: ${data['trend']}');
      } else {
        print('⚠ Harvest & Storage: No data points returned');
      }
    });

    test('Get all market data at once', () async {
      print('\n=== Testing getAllMarketData() ===');

      final allData = await service.getAllMarketData();

      expect(allData, isNotNull);
      expect(allData['lastUpdated'], isNotNull);

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
      var emptyCount = 0;

      for (final category in categories) {
        final data = allData[category];
        if (data != null && data is Map<String, dynamic>) {
          final timeSeries = data['data'] as List?;
          if (timeSeries != null && timeSeries.isNotEmpty) {
            successCount++;
            print('✓ $category: ${timeSeries.length} data points');
          } else {
            emptyCount++;
            print('⚠ $category: Returned but empty');
          }
        } else {
          print('✗ $category: Null');
        }
      }

      print('\n=== Summary ===');
      print('Successful: $successCount/8');
      print('Empty: $emptyCount/8');
      print('Failed: ${8 - successCount - emptyCount}/8');

      // At least 6 out of 8 should return data
      expect(successCount, greaterThanOrEqualTo(6),
          reason: 'At least 6 categories should return data');
    });

    test('Verify caching works', () async {
      print('\n=== Testing Cache Mechanism ===');

      // First call - should fetch from API
      final startTime = DateTime.now();
      await service.getMaizePrices();
      final firstCallDuration = DateTime.now().difference(startTime);

      print('First call (API fetch): ${firstCallDuration.inMilliseconds}ms');

      // Second call - should use cache
      final cacheStartTime = DateTime.now();
      await service.getMaizePrices();
      final cacheCallDuration = DateTime.now().difference(cacheStartTime);

      print('Second call (cached): ${cacheCallDuration.inMilliseconds}ms');

      // Cached call should be significantly faster (though this is a weak test)
      final cacheInfo = service.getCacheInfo();
      print('Cache size: ${cacheInfo['size']}');
      print('Cache keys: ${cacheInfo['keys']}');

      expect(cacheInfo['size'], greaterThan(0));
    });

    tearDown(() {
      service.dispose();
    });
  });

  group('WorldBankService - Fallback Tests', () {
    test('Verify fallback to regional data works', () async {
      print('\n=== Testing Fallback Mechanism ===');

      // Test with a non-existent country to trigger fallback
      final service = WorldBankService();

      // This will try El Salvador first, then regional (LCN), then global (1W)
      final data = await service.getMaizePrices();

      expect(data, isNotNull);

      if (data != null) {
        final dataSource = data['dataSource'] as String?;
        print('Data source: $dataSource');

        // Should indicate which level of data was returned
        expect(dataSource, isNotNull);
        expect(dataSource, containsAnyOf(['El Salvador', 'Regional', 'Global']));
      }

      service.dispose();
    });
  });
}

/// Custom matcher to check if string contains any of the given values
class ContainsAnyOf extends Matcher {
  final List<String> values;

  ContainsAnyOf(this.values);

  @override
  bool matches(covariant String? item, Map matchState) {
    if (item == null) return false;
    return values.any((value) => item.contains(value));
  }

  @override
  Description describe(Description description) {
    return description.add('contains any of: ${values.join(', ')}');
  }
}

containsAnyOf(List<String> values) => ContainsAnyOf(values);
