import 'hdx_ndvi_service.dart';
import 'usda_rss_service.dart';

/// Agricultural Data Proxy
///
/// Fetches crop health and pest alert data from external APIs:
/// - HDX (NASA MODIS via WFP): Crop health (NDVI) data
/// - USDA APHIS RSS Feeds: Pest alerts for Central America
///
/// All data is cached for 1 hour to reduce API calls.
class AgriculturalProxy {
  final Map<String, dynamic> _cache = {};
  static const _cacheDuration = Duration(hours: 1);

  /// Get crop health data for a region
  ///
  /// [region] - Geographic region (default: 'El Salvador')
  /// [timeRange] - Time period like '30d', '90d' (default: '30d')
  ///
  /// Returns NDVI data by department/region with trends and health indicators
  Future<Map<String, dynamic>> getCropHealth({
    String region = 'El Salvador',
    String timeRange = '30d',
  }) async {
    final cacheKey = 'crop-health-$region-$timeRange';

    // Check cache
    if (_cache.containsKey(cacheKey)) {
      final cached = _cache[cacheKey] as Map<String, dynamic>;
      final timestamp = DateTime.parse(cached['timestamp'] as String);
      if (DateTime.now().difference(timestamp) < _cacheDuration) {
        print('[AgriculturalProxy] Returning cached crop health data');
        return cached['data'] as Map<String, dynamic>;
      }
    }

    try {
      // Use HDX NDVI service (NASA MODIS data via WFP)
      final hdxService = HdxNdviService();
      final data = await hdxService.getCropHealthData(
        region: region,
        checkForUpdates: false,
      );

      _cache[cacheKey] = {
        'data': data,
        'timestamp': DateTime.now().toIso8601String(),
      };

      return data;
    } catch (e) {
      print('[AgriculturalProxy] Failed to fetch crop health: $e');
      return _getFallbackCropHealthData(region);
    }
  }

  /// Get pest alerts for a region
  ///
  /// [region] - Geographic region (default: 'Central America')
  ///
  /// Returns current pest and disease alerts with severity and recommendations
  Future<Map<String, dynamic>> getPestAlerts({
    String region = 'Central America',
  }) async {
    final cacheKey = 'pest-alerts-$region';

    // Check cache
    if (_cache.containsKey(cacheKey)) {
      final cached = _cache[cacheKey] as Map<String, dynamic>;
      final timestamp = DateTime.parse(cached['timestamp'] as String);
      if (DateTime.now().difference(timestamp) < _cacheDuration) {
        print('[AgriculturalProxy] Returning cached pest alerts');
        return cached['data'] as Map<String, dynamic>;
      }
    }

    try {
      // Use USDA RSS feed service
      final usdaService = UsdaRssService();
      final data = await usdaService.getPestAlerts(region: region);

      _cache[cacheKey] = {
        'data': data,
        'timestamp': DateTime.now().toIso8601String(),
      };

      return data;
    } catch (e) {
      print('[AgriculturalProxy] Failed to fetch pest alerts: $e');
      return _getFallbackPestAlertData(region);
    }
  }

  /// Fallback crop health data when API is unavailable
  Map<String, dynamic> _getFallbackCropHealthData(String region) {
    return {
      'region': region,
      'timeRange': '30d',
      'offline': true,
      'dataSource': 'Fallback (offline mode)',
      'data': <dynamic>[],
      'average': {
        'ndvi': 0,
        'trend': 'unknown',
        'change': 0,
      },
      'message': 'Unable to fetch data. Please check your connection.',
    };
  }

  /// Fallback pest alert data when API is unavailable
  Map<String, dynamic> _getFallbackPestAlertData(String region) {
    return {
      'region': region,
      'offline': true,
      'dataSource': 'Fallback (offline mode)',
      'alerts': <dynamic>[],
      'summary': {
        'total': 0,
        'high': 0,
        'moderate': 0,
        'low': 0,
      },
      'message': 'Unable to fetch pest alerts. Please check your connection.',
    };
  }

  /// Clear all cached data
  void clearCache() {
    _cache.clear();
    print('[AgriculturalProxy] Cache cleared');
  }

  /// Get cache information
  Map<String, dynamic> getCacheInfo() {
    return {
      'size': _cache.length,
      'keys': _cache.keys.toList(),
      'duration': '60 minutes',
    };
  }

  /// Check for HDX data updates
  ///
  /// Returns true if new data is available on HDX, false otherwise
  Future<bool> checkForDataUpdates() async {
    try {
      final hdxService = HdxNdviService();
      return await hdxService.checkForUpdates();
    } catch (e) {
      print('[AgriculturalProxy] Failed to check for updates: $e');
      return false;
    }
  }

  /// Get HDX cache information
  Future<Map<String, dynamic>> getHdxCacheInfo() async {
    try {
      final hdxService = HdxNdviService();
      return await hdxService.getCacheInfo();
    } catch (e) {
      return {
        'error': e.toString(),
      };
    }
  }

  /// Clear HDX cached data
  Future<void> clearHdxCache() async {
    try {
      final hdxService = HdxNdviService();
      await hdxService.clearCache();
    } catch (e) {
      print('[AgriculturalProxy] Failed to clear HDX cache: $e');
    }
  }
}
