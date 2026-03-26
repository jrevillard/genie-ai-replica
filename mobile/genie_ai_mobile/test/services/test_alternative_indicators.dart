import 'dart:convert';
import 'package:http/http.dart' as http;

/// Test alternative World Bank indicators for failed categories
void main() async {
  print('Testing alternative World Bank indicators\n');
  print('=' * 60);

  // Test fertilizer alternatives
  print('\n🌱 FERTILIZER ALTERNATIVES:');
  await testIndicator('AG.CON.FERT.ZS', 'Fertilizer consumption (kg per hectare)');
  await testIndicator('TX.VAL.AGRI.ZS.UN', 'Agricultural raw materials imports (%)');
  await testIndicator('NV.AGR.TOTL.ZS', 'Agriculture, forestry, fishing value added (%)');

  // Test fish/aquaculture alternatives
  print('\n🐟 FISH/AQUACULTURE ALTERNATIVES:');
  await testIndicator('ER.FSH.AQUA.MT', 'Aquaculture production (metric tons)');
  await testIndicator('ER.FSH.CAPT.MT', 'Capture fisheries production (metric tons)');
  await testIndicator('AG.PRD.FOOD.XD', 'Food production index (already used)');
  await testIndicator('TM.VAL.FISH.ZS.UN', 'Fish exports (%)');

  // Test other potentially useful indicators
  print('\n📊 OTHER AGRICULTURAL INDICATORS:');
  await testIndicator('AG.LND.TRAC.ZS', 'Agricultural machinery (% of arable land)');
  await testIndicator('AG.LND.CREL.HA', 'Land under cereal production (hectares)');
  await testIndicator('SP.POP.TOTL', 'Total population');

  print('\n' + '=' * 60);
  print('Testing complete!');
}

Future<void> testIndicator(String code, String description) async {
  print('\n  $code');
  print('  Description: $description');

  final url = Uri.parse(
    'https://api.worldbank.org/v2/country/SLV/indicator/$code'
    '?format=json&date=2020:2024&per_page=10',
  );

  try {
    final response = await http.Client().get(url).timeout(
      const Duration(seconds: 10),
    );

    if (response.statusCode == 200) {
      final List<dynamic> json = jsonDecode(response.body);

      if (json.isNotEmpty && json.length >= 2) {
        final data = json[1] as List<dynamic>?;

        if (data != null && data.isNotEmpty) {
          print('  ✅ SUCCESS: ${data.length} data points');

          // Show recent values
          final recent = data.take(3).toList();
          for (final item in recent) {
            if (item is Map<String, dynamic>) {
              final year = item['date'];
              final value = item['value'];
              print('     $year: $value');
            }
          }
        } else {
          print('  ❌ No data points');
        }
      } else {
        print('  ❌ Invalid response format');
      }
    } else {
      print('  ❌ HTTP ${response.statusCode}');
    }
  } catch (e) {
    print('  ❌ Error: $e');
  }
}
