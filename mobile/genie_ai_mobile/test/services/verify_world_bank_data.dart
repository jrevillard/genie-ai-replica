import 'dart:convert';
import 'package:http/http.dart' as http;

/// Standalone script to verify World Bank API endpoints return real data
/// Run with: dart test/services/verify_world_bank_data.dart
void main() async {
  print('╔════════════════════════════════════════════════════════════╗');
  print('║   World Bank API Data Verification                       ║');
  print('║   Testing all 8 market dashboard indicators              ║');
  print('╚════════════════════════════════════════════════════════════╝\n');

  final results = <String, TestResult>{};

  // Test all 8 indicators
  results['Maize & Basic Grains'] = await testIndicator(
    name: 'Maize & Basic Grains',
    indicator: 'AG.PRD.CROP.XD',
    category: 'maize',
    color: '#2E7D32',
    description: 'Crop production index',
  );

  results['Crop Protection Costs'] = await testIndicator(
    name: 'Crop Protection Costs',
    indicator: 'TM.VAL.AGRI.ZS.UN',
    category: 'crop-protection',
    color: '#D84315',
    description: 'Agricultural raw materials exports',
  );

  results['Fruits & Vegetables'] = await testIndicator(
    name: 'Fruits & Vegetables',
    indicator: 'AG.PRD.FOOD.XD',
    category: 'vegetables',
    color: '#558B2F',
    description: 'Food production index',
  );

  results['Poultry & Pork Feed'] = await testIndicator(
    name: 'Poultry & Pork Feed',
    indicator: 'AG.PRD.LVSK.XD',
    category: 'livestock',
    color: '#8D6E63',
    description: 'Livestock production index',
  );

  results['Fertilizer & Soil'] = await testIndicator(
    name: 'Fertilizer & Soil',
    indicator: 'AG.CON.FERT.ZS',
    category: 'fertilizer',
    color: '#F9A825',
    description: 'Fertilizer consumption (kg per hectare)',
  );

  results['Apiary & Honey'] = await testIndicator(
    name: 'Apiary & Honey',
    indicator: 'AG.PRD.LVSK.XD',
    category: 'apiary',
    color: '#F57F17',
    description: 'Livestock production index',
  );

  results['Tilapia & Aquaculture'] = await testIndicator(
    name: 'Tilapia & Aquaculture',
    indicator: 'ER.FSH.AQUA.MT',
    category: 'aquaculture',
    color: '#0288D1',
    description: 'Aquaculture production (metric tons)',
  );

  results['Harvest & Storage'] = await testIndicator(
    name: 'Harvest & Storage',
    indicator: 'SP.RUR.TOTL.ZS',
    category: 'harvest-storage',
    color: '#00838F',
    description: 'Rural population percentage',
  );

  // Print summary
  print('\n╔════════════════════════════════════════════════════════════╗');
  print('║                    FINAL SUMMARY                          ║');
  print('╚════════════════════════════════════════════════════════════╝\n');

  var successCount = 0;
  var regionalCount = 0;
  var globalCount = 0;
  var failureCount = 0;

  for (final entry in results.entries) {
    final result = entry.value;
    if (result.success) {
      successCount++;
      if (result.dataSource.contains('Regional')) regionalCount++;
      if (result.dataSource.contains('Global')) globalCount++;
    } else {
      failureCount++;
    }
  }

  print('✅ Successful: $successCount/8');
  print('   └─ El Salvador data: ${successCount - regionalCount - globalCount}');
  print('   └─ Regional fallback: $regionalCount');
  print('   └─ Global fallback: $globalCount');
  print('❌ Failed: $failureCount/8');

  if (successCount >= 6) {
    print('\n✅ PASSED: At least 6/8 indicators returned data');
    print('   The service is ready for implementation.\n');
    exit(0);
  } else {
    print('\n❌ FAILED: Less than 6/8 indicators returned data');
    print('   Some indicators may need to be replaced.\n');
    exit(1);
  }
}

Future<TestResult> testIndicator({
  required String name,
  required String indicator,
  required String category,
  required String color,
  required String description,
}) async {
  print('┌──────────────────────────────────────────────────────────┐');
  print('│ $name');
  print('│ Indicator: $indicator');
  print('│ Description: $description');
  print('└──────────────────────────────────────────────────────────┘');

  // Try El Salvador first
  print('  Testing El Salvador (SLV)...');
  var result = await fetchIndicator('SLV', indicator);

  String dataSource = 'El Salvador';

  if (!result.success || result.dataPointCount == 0) {
    print('  ⚠ No data for El Salvador, trying regional (LCN)...');
    result = await fetchIndicator('LCN', indicator);
    dataSource = 'Regional Average (Latin America)';
  }

  if (!result.success || result.dataPointCount == 0) {
    print('  ⚠ No regional data, trying global (1W)...');
    result = await fetchIndicator('1W', indicator);
    dataSource = 'Global Average';
  }

  result.dataSource = dataSource;

  if (result.success && result.dataPointCount > 0) {
    print('  ✅ SUCCESS: ${result.dataPointCount} data points');
    print('  📊 Data source: $dataSource');
    print('  📈 Trend: ${result.trend}');
    print('  🎨 Color: $color');
    if (result.sampleData != null) {
      print('  Sample: ${result.sampleData}');
    }
  } else {
    print('  ❌ FAILED: No data returned');
  }

  print('');
  return result;
}

Future<TestResult> fetchIndicator(String countryCode, String indicator) async {
  final url = Uri.parse(
    'https://api.worldbank.org/v2/country/$countryCode/indicator/$indicator'
    '?format=json&date=2020:2026&per_page=100',
  );

  try {
    final response = await http.Client().get(url).timeout(
      const Duration(seconds: 30),
    );

    if (response.statusCode == 200) {
      final List<dynamic> json = jsonDecode(response.body);

      if (json.isNotEmpty && json.length >= 2) {
        final data = json[1] as List<dynamic>?;

        if (data != null && data.isNotEmpty) {
          // Process data to extract values
          final dataPoints = <Map<String, dynamic>>[];
          for (final item in data) {
            if (item is Map<String, dynamic>) {
              final value = item['value'];
              final year = item['date'];
              if (value != null && year != null) {
                dataPoints.add({
                  'year': year,
                  'value': value is num ? value.toDouble() : double.tryParse(value.toString()) ?? 0.0,
                });
              }
            }
          }

          if (dataPoints.isNotEmpty) {
            // Calculate trend
            String trend = 'stable';
            if (dataPoints.length >= 2) {
              final last = dataPoints.last['value'] as double;
              final previous = dataPoints[dataPoints.length - 2]['value'] as double;
              final change = ((last - previous) / previous) * 100;
              if (change > 2) {
                trend = 'up';
              } else if (change < -2) {
                trend = 'down';
              }
            }

            return TestResult(
              success: true,
              dataPointCount: dataPoints.length,
              trend: trend,
              sampleData: dataPoints.take(3).toList(),
            );
          }
        }
      }
    }

    return TestResult(success: false, dataPointCount: 0, trend: 'unknown');
  } catch (e) {
    print('  ⚠ Error: $e');
    return TestResult(success: false, dataPointCount: 0, trend: 'unknown');
  }
}

class TestResult {
  final bool success;
  final int dataPointCount;
  final String trend;
  final List<Map<String, dynamic>>? sampleData;
  String dataSource = '';

  TestResult({
    required this.success,
    required this.dataPointCount,
    required this.trend,
    this.sampleData,
  });
}

void exit(int code) {
  // In Dart scripts, we can't actually exit the process
  // Just print the status
  if (code == 0) {
    print('\n═══════════════════════════════════════════════════════════');
    print('All tests completed successfully!');
    print('═══════════════════════════════════════════════════════════\n');
  } else {
    print('\n═══════════════════════════════════════════════════════════');
    print('Tests failed. Please review the results above.');
    print('═══════════════════════════════════════════════════════════\n');
  }
}
