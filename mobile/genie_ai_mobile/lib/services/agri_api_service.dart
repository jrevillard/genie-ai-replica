// lib/services/agri_api_service.dart
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'api_service.dart';
import 'i18n_service.dart';

/// Agri API Service (mobile client for the backend /api/agri/* endpoints).
///
/// Never-fail semantics: every successful response is persisted to
/// SharedPreferences as last-known-good; on fetch failure the cached
/// envelope is returned with meta.stale forced true — charts keep working
/// offline, exactly like the web client.
class AgriApiService {
  static const _cachePrefix = 'agri-lkg:v2:';

  final ApiService _api = ApiService();

  /// Fetch an endpoint envelope with last-known-good fallback.
  Future<Map<String, dynamic>> get(String endpoint) async {
    try {
      final response = await _api.get(endpoint);
      if (response.statusCode == 200) {
        final envelope = jsonDecode(response.body) as Map<String, dynamic>;
        if (envelope.containsKey('data')) {
          await _writeCache(endpoint, envelope);
          return envelope;
        }
      }
      throw Exception('HTTP ${response.statusCode}');
    } catch (e) {
      debugPrint('[AgriApiService] fetch failed for $endpoint: $e — using cache');
      final cached = await _readCache(endpoint);
      if (cached != null) {
        final meta = (cached['meta'] as Map<String, dynamic>?) ?? {};
        meta['stale'] = true;
        final caveats = (meta['caveats'] as List?) ?? [];
        caveats.add({'code': 'STALE_CACHE', 'params': {'source': 'offline'}});
        meta['caveats'] = caveats;
        cached['meta'] = meta;
        return cached;
      }
      return {
        'data': <String, dynamic>{},
        'meta': {
          'fetchedAt': null,
          'source': 'unavailable',
          'stale': true,
          'coverage': 'offline',
          'caveats': <dynamic>[],
        },
      };
    }
  }

  Future<Map<String, dynamic>> getMarketPrices(String category) =>
      get('agri/market-prices/$category');

  /// Market prices mapped to the widgets' legacy shape
  /// ({title, unit, data:[{year, value, decimal}], trend, lastUpdated}).
  Future<Map<String, dynamic>?> getMarketPricesLegacy(String category) async {
    final envelope = await getMarketPrices(category);
    final data = (envelope['data'] as Map<String, dynamic>?) ?? {};
    final meta = (envelope['meta'] as Map<String, dynamic>?) ?? {};
    final series = (data['series'] as List?) ?? [];
    if (series.isEmpty) return null;

    final primary = series[0] as Map<String, dynamic>;
    final points = (primary['data'] as List?) ?? [];
    return {
      'category': category,
      'title': data['title'],
      'unit': primary['unit'] ?? data['unit'],
      'dataSource': meta['source'],
      'data': points
          .map((p) => {
                'year': p['date'],
                'value': p['value'],
                'decimal': p['value'],
                'quality': p['quality'],
              })
          .toList(),
      'trend': data['trend'],
      'caveats': meta['caveats'] ?? <dynamic>[],
      'estimation': meta['estimation'],
      'coverage': meta['coverage'],
      'lastUpdated': meta['fetchedAt'],
    };
  }

  /// Crop health mapped to the widgets' legacy field names.
  Future<Map<String, dynamic>> getCropHealth() async {
    final envelope = await get('agri/crop-health');
    final data = (envelope['data'] as Map<String, dynamic>?) ?? {};
    final departments = (data['departments'] as List?) ?? [];
    return {
      'data': departments
          .map((d) => {
                'department': d['name'],
                'ndvi': d['ndvi'],
                'trend': d['trend'],
                'change': d['changePct'],
                'health': d['health'],
                'date': d['date'],
                'baseline': d['baseline'],
                'source': d['source'],
              })
          .toList(),
      'average': data['average'] ?? {},
      'meta': envelope['meta'],
    };
  }

  /// Pest alerts mapped to the widgets' legacy alert shape with honest
  /// section provenance (advisory / info / sighting severities).
  Future<Map<String, dynamic>> getPestAlerts() async {
    final envelope = await get('agri/pest-alerts');
    final d = (envelope['data'] as Map<String, dynamic>?) ?? {};
    final isEs = I18nService().currentLocale.languageCode == 'es';

    final advisories = ((d['advisories'] as List?) ?? [])
        .map((a) => {
              'id': 'advisory-${a['scientificName']}',
              'pest': _localized(a['pest'], isEs) ?? a['scientificName'],
              'scientificName': a['scientificName'],
              'severity': 'advisory',
              'affectedCrops': _localized(a['affectedCrops'], isEs) ?? <dynamic>[],
              'departments': a['departments'] ?? <dynamic>[],
              'description': _localized(a['advisory'], isEs) ?? '',
              'recommendations': '',
              'firstDetected': null,
              'source': a['source'],
              'link': null,
              'seasonal': true,
            })
        .toList();

    final regional = ((d['regional'] as List?) ?? [])
        .map((r) => {
              'id': 'regional-${r['link'] ?? r['title']}',
              'pest': r['title'],
              'scientificName': '',
              'severity': 'info',
              'affectedCrops': <dynamic>[],
              'departments': <dynamic>[],
              'description': ((r['matchedKeywords'] as List?) ?? []).join(', '),
              'recommendations': '',
              'firstDetected': r['publishedAt'],
              'source': r['source'] ?? 'OIRSA',
              'link': r['link'],
              'seasonal': false,
            })
        .toList();

    final sightings = ((d['sightings'] as List?) ?? [])
        .map((s) => {
              'id': 'sighting-${s['scientificName']}-${s['observedOn']}',
              'pest': _localized(s['commonName'], isEs) ?? s['scientificName'],
              'scientificName': s['scientificName'],
              'severity': 'sighting',
              'affectedCrops': <dynamic>[],
              'departments': s['placeGuess'] != null ? [s['placeGuess']] : <dynamic>[],
              'description': '',
              'recommendations': '',
              'firstDetected': s['observedOn'],
              'source': 'iNaturalist (community)',
              'link': s['uri'],
              'seasonal': false,
            })
        .toList();

    final alerts = [...advisories, ...regional, ...sightings];
    return {
      'region': 'El Salvador',
      'alerts': alerts,
      'summary': {
        'total': alerts.length,
        'advisory': advisories.length,
        'regional': regional.length,
        'sightings': sightings.length,
        'high': 0,
        'moderate': 0,
        'low': 0,
      },
      'meta': envelope['meta'],
    };
  }

  Future<Map<String, dynamic>> getNews(String scope) {
    final lang = I18nService().currentLocale.languageCode == 'en' ? 'en' : 'es';
    return get('agri/news?scope=$scope&lang=$lang');
  }

  /// Caveat + estimation disclosure injected into AI prompts
  /// (correctness mandate — same text the user sees).
  String dataDisclosureText(Map<String, dynamic> envelope) {
    final meta = (envelope['meta'] as Map<String, dynamic>?) ?? {};
    final lines = <String>[];
    if (meta['coverage'] != null) lines.add('Data coverage: ${meta['coverage']}');
    if (meta['estimation'] != null) lines.add('Estimation note: ${meta['estimation']}');
    return lines.join('\n');
  }

  dynamic _localized(dynamic bilingual, bool isEs) {
    if (bilingual is Map<String, dynamic>) {
      return bilingual[isEs ? 'es' : 'en'] ?? bilingual['en'] ?? bilingual['es'];
    }
    return bilingual;
  }

  Future<void> _writeCache(String endpoint, Map<String, dynamic> envelope) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('$_cachePrefix$endpoint', jsonEncode(envelope));
    } catch (_) {
      /* best-effort */
    }
  }

  Future<Map<String, dynamic>?> _readCache(String endpoint) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString('$_cachePrefix$endpoint');
      if (raw == null) return null;
      return jsonDecode(raw) as Map<String, dynamic>;
    } catch (_) {
      return null;
    }
  }
}
