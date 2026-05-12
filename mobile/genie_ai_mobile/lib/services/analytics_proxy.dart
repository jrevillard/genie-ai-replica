import 'dart:convert';
import 'package:genie_ai_mobile/services/api_service.dart';

class AnalyticsProxy {
  final ApiService _api = ApiService();

  Future<int> getUniqueUsersCount(String startDate, String endDate, {String? locale}) async {
    final res = await _api.get('analytics/metric/uniqueUsers', params: {
      'startDate': startDate,
      'endDate': endDate,
      'locale': ?locale,
    });
    return jsonDecode(res.body)['value'] ?? 0;
  }

  Future<Map<String, dynamic>> getDashboardAnalytics(String period, String date, {String? locale}) async {
    final range = _calculateDateRange(period, date);
    final res = await _api.get('analytics/dashboard', params: {
      'startDate': range['startDate'],
      'endDate': range['endDate'],
      'locale': ?locale,
    });
    return jsonDecode(res.body);
  }

  Future<Map<String, dynamic>> getComparisonData(String metric, String cp, String cd, String pp, String pd, {String? locale}) async {
    final current = _calculateDateRange(cp, cd);
    final previous = _calculateDateRange(pp, pd);
    
    final currentRes = await _api.get('analytics/metric/$metric', params: {
      'startDate': current['startDate'], 'endDate': current['endDate'], 'locale': locale
    });
    final prevRes = await _api.get('analytics/metric/$metric', params: {
      'startDate': previous['startDate'], 'endDate': previous['endDate'], 'locale': locale
    });

    return {
      'current': jsonDecode(currentRes.body)['value'],
      'previous': jsonDecode(prevRes.body)['value'],
    };
  }

  Future<List<dynamic>> getTimeSeriesData(String type, String interval, String start, String end, {String? locale}) async {
    final res = await _api.get('analytics/timeseries/$type', params: {
      'interval': interval, 'startDate': start, 'endDate': end, 'locale': locale
    });
    return jsonDecode(res.body);
  }

  Future<List<dynamic>> getSatisfactionHeatmap(String period, String date, {String? locale}) async {
    final range = _calculateDateRange(period, date);
    final res = await _api.get('analytics/satisfaction/heatmap', params: {
      'startDate': range['startDate'], 'endDate': range['endDate'], 'locale': locale
    });
    return jsonDecode(res.body);
  }

  Future<Map<String, dynamic>> getSatisfactionGauge(String period, String date, {String? locale}) async {
    final range = _calculateDateRange(period, date);
    final res = await _api.get('analytics/satisfaction/gauge', params: {
      'startDate': range['startDate'], 'endDate': range['endDate'], 'locale': locale
    });
    return jsonDecode(res.body);
  }

  Future<void> recordQuery(Map<String, dynamic> queryDoc) async {
    await _api.post('analytics/query', queryDoc);
  }

  Future<void> recordFeedback(String queryId, Map<String, dynamic> feedback) async {
    await _api.post('analytics/feedback', {'queryId': queryId, 'feedback': feedback});
  }

  Map<String, String> _calculateDateRange(String period, String date) {
    // Ported from analyticsService.js calculateDateRange logic
    DateTime end = DateTime.parse(date);
    DateTime start;
    switch (period) {
      case 'daily': start = end; break;
      case 'weekly': start = end.subtract(const Duration(days: 6)); break;
      case 'monthly': start = end.subtract(const Duration(days: 29)); break;
      default: start = DateTime(2020);
    }
    return {'startDate': start.toIso8601String(), 'endDate': end.toIso8601String()};
  }
}