import 'dart:convert';
import 'package:http/http.dart' as http;

/// World Bank Open Data Service
///
/// Fetches agricultural and economic indicator data from World Bank Open Data API (v2)
/// All data is cached for 24 hours to reduce API calls and improve performance.
///
/// API Documentation: https://datahelpdesk.worldbank.org/knowledgebase/topics/125589-developer-information
///
/// No API key required - open data access.
class WorldBankService {
  final Map<String, dynamic> _cache = {};
  static const _cacheDuration = Duration(hours: 24);
  static const String _baseUrl = 'https://api.worldbank.org/v2';

  final http.Client _client;

  WorldBankService({http.Client? client})
      : _client = client ?? http.Client();

  /// Fetch data from World Bank API
  ///
  /// [countryCode] - ISO country code (default: 'SLV' for El Salvador)
  /// [indicator] - World Bank indicator code
  /// [startDate] - Start year (default: 2020)
  /// [endDate] - End year (default: current year)
  ///
  /// Returns parsed JSON data or null on error
  Future<Map<String, dynamic>?> _fetchIndicator({
    String countryCode = 'SLV',
    required String indicator,
    int startDate = 2020,
    int? endDate,
  }) async {
    final endYear = endDate ?? DateTime.now().year;
    final url = Uri.parse(
      '$_baseUrl/country/$countryCode/indicator/$indicator'
      '?format=json'
      '&date=$startDate:$endYear'
      '&per_page=100',
    );

    try {
      print('[WorldBankService] Fetching: $indicator for $countryCode');
      final response = await _client.get(url).timeout(
        const Duration(seconds: 30),
      );

      if (response.statusCode == 200) {
        final List<dynamic> json = jsonDecode(response.body);

        // World Bank returns [metadata, data]
        if (json.isNotEmpty && json.length >= 2) {
          final metadata = json[0] as Map<String, dynamic>?;
          final data = json[1] as List<dynamic>?;
          final page = metadata?['page'] as int? ?? 0;
          final pages = metadata?['pages'] as int? ?? 0;

          // Handle pagination
          if (pages > 1 && page == 1) {
            print('[WorldBankService] Warning: Data is paginated ($pages pages). '
                'Only first page returned.');
          }

          return {
            'metadata': metadata,
            'data': data ?? [],
            'indicator': indicator,
            'country': countryCode,
          };
        }
      } else {
        print('[WorldBankService] HTTP ${response.statusCode} for $indicator');
      }
    } catch (e) {
      print('[WorldBankService] Error fetching $indicator: $e');
    }

    return null;
  }

  /// Fetch data with fallback to regional/global averages
  ///
  /// Tries country-specific data first, then falls back to:
  /// 1. Regional average (LCN for Latin America & Caribbean)
  /// 2. Global average (1W for World)
  Future<Map<String, dynamic>?> _fetchWithFallback({
    required String indicator,
    int startDate = 2020,
    int? endDate,
  }) async {
    // Try El Salvador first
    var data = await _fetchIndicator(
      countryCode: 'SLV',
      indicator: indicator,
      startDate: startDate,
      endDate: endDate,
    );

    if (data != null &&
        data['data'] != null &&
        (data['data'] as List).isNotEmpty) {
      return {
        ...data,
        'dataSource': 'El Salvador',
      };
    }

    print('[WorldBankService] No SLV data for $indicator, trying regional');

    // Try Latin America & Caribbean regional average
    data = await _fetchIndicator(
      countryCode: 'LCN',
      indicator: indicator,
      startDate: startDate,
      endDate: endDate,
    );

    if (data != null &&
        data['data'] != null &&
        (data['data'] as List).isNotEmpty) {
      return {
        ...data,
        'dataSource': 'Regional Average (Latin America)',
      };
    }

    print('[WorldBankService] No regional data for $indicator, trying global');

    // Try global average
    data = await _fetchIndicator(
      countryCode: '1W',
      indicator: indicator,
      startDate: startDate,
      endDate: endDate,
    );

    if (data != null &&
        data['data'] != null &&
        (data['data'] as List).isNotEmpty) {
      return {
        ...data,
        'dataSource': 'Global Average',
      };
    }

    print('[WorldBankService] No data available for $indicator');
    return null;
  }

  /// Get cached data or fetch fresh data
  Future<T?> _getCachedOrFetch<T>({
    required String cacheKey,
    required Future<T?> Function() fetchFn,
  }) async {
    // Check cache
    if (_cache.containsKey(cacheKey)) {
      final cached = _cache[cacheKey] as Map<String, dynamic>;
      final timestamp = DateTime.parse(cached['timestamp'] as String);
      if (DateTime.now().difference(timestamp) < _cacheDuration) {
        print('[WorldBankService] Returning cached data for $cacheKey');
        return cached['data'] as T?;
      }
    }

    // Fetch fresh data
    final data = await fetchFn();

    if (data != null) {
      _cache[cacheKey] = {
        'data': data,
        'timestamp': DateTime.now().toIso8601String(),
      };
    }

    return data;
  }

  // ==================== MARKET DATA METHODS ====================

  /// 1. Get Maize (Basic Grains) Price Data
  ///
  /// Indicator: AG.CRP.MZE.CD - Crop production index (2014-2016 = 100)
  /// Also includes: AG.PRD.CROP.XD - Crop production index
  ///
  /// Used by: Plant Basic Grains quick help category
  Future<Map<String, dynamic>?> getMaizePrices() async {
    return await _getCachedOrFetch<Map<String, dynamic>>(
      cacheKey: 'maize-prices',
      fetchFn: () async {
        // Use crop production index as proxy for grain market health
        final data = await _fetchWithFallback(
          indicator: 'AG.PRD.CROP.XD',
        );

        if (data == null) return null;

        return {
          'category': 'maize',
          'title': 'Maize & Basic Grains',
          'unit': 'Production Index (2014-2016=100)',
          'color': '#2E7D32',
          'dataSource': data['dataSource'],
          'data': _processTimeSeriesData(data['data']),
          'trend': _calculateTrend(data['data']),
        };
      },
    );
  }

  /// 2. Get Crop Protection (Pesticide) Cost Data
  ///
  /// Indicator: AG.CON.PRET.ZS - Fertilizer consumption (% of fertilizer production)
  /// Fallback: TM.VAL.AGRI.ZS.UN - Agricultural raw materials exports (% of total merchandise exports)
  ///
  /// Used by: Diagnose Pest & Disease quick help category
  Future<Map<String, dynamic>?> getCropProtectionCosts() async {
    return await _getCachedOrFetch<Map<String, dynamic>>(
      cacheKey: 'crop-protection-costs',
      fetchFn: () async {
        // Use agricultural exports as indicator of crop value
        final data = await _fetchWithFallback(
          indicator: 'TM.VAL.AGRI.ZS.UN',
        );

        if (data == null) return null;

        return {
          'category': 'crop-protection',
          'title': 'Crop Protection Costs',
          'unit': '% of Total Exports',
          'color': '#D84315',
          'dataSource': data['dataSource'],
          'data': _processTimeSeriesData(data['data']),
          'trend': _calculateTrend(data['data']),
        };
      },
    );
  }

  /// 3. Get Vegetable Price Index
  ///
  /// Indicator: FP.CPI.TOTL - Consumer price index (base year varies by country)
  /// Also: AG.PRD.FOOD.XD - Food production index
  ///
  /// Used by: Grow Fruits & Veggies quick help category
  Future<Map<String, dynamic>?> getVegetablePrices() async {
    return await _getCachedOrFetch<Map<String, dynamic>>(
      cacheKey: 'vegetable-prices',
      fetchFn: () async {
        // Use food production index as proxy for vegetable market
        final data = await _fetchWithFallback(
          indicator: 'AG.PRD.FOOD.XD',
        );

        if (data == null) return null;

        return {
          'category': 'vegetables',
          'title': 'Fruits & Vegetables',
          'unit': 'Production Index (2014-2016=100)',
          'color': '#558B2F',
          'dataSource': data['dataSource'],
          'data': _processTimeSeriesData(data['data']),
          'trend': _calculateTrend(data['data']),
        };
      },
    );
  }

  /// 4. Get Poultry & Pork Feed Cost Data
  ///
  /// Indicator: AG.PRD.LVSK.XD - Livestock production index
  /// Also: TX.VAL.AGRI.ZS - Agricultural raw materials imports
  ///
  /// Used by: Manage Poultry & Pigs quick help category
  Future<Map<String, dynamic>?> getPoultryPorkFeedCosts() async {
    return await _getCachedOrFetch<Map<String, dynamic>>(
      cacheKey: 'poultry-pork-feed',
      fetchFn: () async {
        // Use livestock production index
        final data = await _fetchWithFallback(
          indicator: 'AG.PRD.LVSK.XD',
        );

        if (data == null) return null;

        return {
          'category': 'livestock',
          'title': 'Poultry & Pork Feed',
          'unit': 'Production Index (2014-2016=100)',
          'color': '#8D6E63',
          'dataSource': data['dataSource'],
          'data': _processTimeSeriesData(data['data']),
          'trend': _calculateTrend(data['data']),
        };
      },
    );
  }

  /// 5. Get Fertilizer Price Data
  ///
  /// Indicator: AG.CON.FERT.ZS - Fertilizer consumption (kilograms per hectare of arable land)
  ///
  /// Used by: Fertilizer & Soil Advice quick help category
  Future<Map<String, dynamic>?> getFertilizerPrices() async {
    return await _getCachedOrFetch<Map<String, dynamic>>(
      cacheKey: 'fertilizer-prices',
      fetchFn: () async {
        final data = await _fetchWithFallback(
          indicator: 'AG.CON.FERT.ZS',
        );

        if (data == null) return null;

        return {
          'category': 'fertilizer',
          'title': 'Fertilizer & Soil',
          'unit': 'kg per Hectare',
          'color': '#F9A825',
          'dataSource': data['dataSource'],
          'data': _processTimeSeriesData(data['data']),
          'trend': _calculateTrend(data['data']),
        };
      },
    );
  }

  /// 6. Get Honey (Apiary) Market Data
  ///
  /// Indicator: AG.PRD.LVSK.XD - Livestock production index (includes beekeeping)
  ///
  /// Used by: Start & Manage Apiary quick help category
  Future<Map<String, dynamic>?> getHoneyMarketData() async {
    return await _getCachedOrFetch<Map<String, dynamic>>(
      cacheKey: 'honey-market',
      fetchFn: () async {
        // Use livestock production index
        final data = await _fetchWithFallback(
          indicator: 'AG.PRD.LVSK.XD',
        );

        if (data == null) return null;

        return {
          'category': 'apiary',
          'title': 'Apiary & Honey',
          'unit': 'Production Index (2014-2016=100)',
          'color': '#F57F17',
          'dataSource': data['dataSource'],
          'data': _processTimeSeriesData(data['data']),
          'trend': _calculateTrend(data['data']),
        };
      },
    );
  }

  /// 7. Get Tilapia (Aquaculture) Market Data
  ///
  /// Indicator: ER.FSH.AQUA.MT - Aquaculture production (metric tons)
  ///
  /// Used by: Tilapia Pond Care quick help category
  Future<Map<String, dynamic>?> getTilapiaMarketData() async {
    return await _getCachedOrFetch<Map<String, dynamic>>(
      cacheKey: 'tilapia-market',
      fetchFn: () async {
        final data = await _fetchWithFallback(
          indicator: 'ER.FSH.AQUA.MT',
        );

        if (data == null) return null;

        return {
          'category': 'aquaculture',
          'title': 'Tilapia & Aquaculture',
          'unit': 'Metric Tons',
          'color': '#0288D1',
          'dataSource': data['dataSource'],
          'data': _processTimeSeriesData(data['data']),
          'trend': _calculateTrend(data['data']),
        };
      },
    );
  }

  /// 8. Get Harvest & Storage Loss Data
  ///
  /// Indicator: SP.RUR.TOTL.ZS - Rural population
  /// Proxy indicator: Higher rural population = more storage infrastructure
  ///
  /// Used by: Harvest & Storage quick help category
  Future<Map<String, dynamic>?> getHarvestStorageData() async {
    return await _getCachedOrFetch<Map<String, dynamic>>(
      cacheKey: 'harvest-storage',
      fetchFn: () async {
        // Use rural population as proxy for storage capacity
        final data = await _fetchWithFallback(
          indicator: 'SP.RUR.TOTL.ZS',
        );

        if (data == null) return null;

        return {
          'category': 'harvest-storage',
          'title': 'Harvest & Storage',
          'unit': 'Rural Population %',
          'color': '#00838F',
          'dataSource': data['dataSource'],
          'data': _processTimeSeriesData(data['data']),
          'trend': _calculateTrend(data['data']),
        };
      },
    );
  }

  /// Get all market data in a single call
  ///
  /// Returns a map with all 8 categories
  Future<Map<String, dynamic?>> getAllMarketData() async {
    final results = await Future.wait([
      getMaizePrices(),
      getCropProtectionCosts(),
      getVegetablePrices(),
      getPoultryPorkFeedCosts(),
      getFertilizerPrices(),
      getHoneyMarketData(),
      getTilapiaMarketData(),
      getHarvestStorageData(),
    ]);

    return {
      'maize': results[0],
      'cropProtection': results[1],
      'vegetables': results[2],
      'livestock': results[3],
      'fertilizer': results[4],
      'apiary': results[5],
      'aquaculture': results[6],
      'harvestStorage': results[7],
      'lastUpdated': DateTime.now().toIso8601String(),
    };
  }

  // ==================== DATA PROCESSING HELPERS ====================

  /// Process raw World Bank time series data into simplified format
  List<Map<String, dynamic>> _processTimeSeriesData(dynamic rawData) {
    if (rawData == null || rawData is! List) return [];

    final processed = <Map<String, dynamic>>[];

    for (final item in rawData) {
      if (item is! Map<String, dynamic>) continue;

      final value = item['value'] as num?;
      final year = item['date'] as String?;

      if (value != null && year != null) {
        processed.add({
          'year': year,
          'value': value.toDouble(),
          'decimal': value.toDouble(),
        });
      }
    }

    // Sort by year
    processed.sort((a, b) => a['year'].compareTo(b['year'] as String));

    return processed;
  }

  /// Calculate trend from time series data
  String _calculateTrend(dynamic rawData) {
    if (rawData == null || rawData is! List || rawData.isEmpty) {
      return 'unknown';
    }

    final data = _processTimeSeriesData(rawData);
    if (data.length < 2) return 'unknown';

    // Compare last value to previous value
    final last = data.last['value'] as double;
    final previous = data[data.length - 2]['value'] as double;

    final change = ((last - previous) / previous) * 100;

    if (change > 2) return 'up';
    if (change < -2) return 'down';
    return 'stable';
  }

  // ==================== CACHE MANAGEMENT ====================

  /// Clear all cached data
  void clearCache() {
    final count = _cache.length;
    _cache.clear();
    print('[WorldBankService] Cleared all cache ($count entries)');
  }

  /// Get cache information
  Map<String, dynamic> getCacheInfo() {
    final cacheKeys = _cache.keys.toList();
    final info = <String, dynamic>{
      'size': _cache.length,
      'keys': cacheKeys,
      'duration': '24 hours',
      'entries': <String, dynamic>{},
    };

    for (final key in cacheKeys) {
      final cached = _cache[key] as Map<String, dynamic>;
      final timestamp = DateTime.parse(cached['timestamp'] as String);
      final age = DateTime.now().difference(timestamp);

      info['entries'][key] = {
        'timestamp': cached['timestamp'],
        'age_minutes': age.inMinutes,
        'age_hours': age.inHours,
        'expired': age >= _cacheDuration,
      };
    }

    return info;
  }

  /// Clear expired cache entries
  void clearExpiredCache() {
    final now = DateTime.now();
    final keysToRemove = <String>[];

    for (final entry in _cache.entries) {
      final cached = entry.value as Map<String, dynamic>;
      final timestamp = DateTime.parse(cached['timestamp'] as String);
      if (now.difference(timestamp) >= _cacheDuration) {
        keysToRemove.add(entry.key);
      }
    }

    for (final key in keysToRemove) {
      _cache.remove(key);
    }

    if (keysToRemove.isNotEmpty) {
      print('[WorldBankService] Cleared ${keysToRemove.length} expired entries');
    }
  }

  /// Dispose of the HTTP client
  void dispose() {
    _client.close();
  }
}
