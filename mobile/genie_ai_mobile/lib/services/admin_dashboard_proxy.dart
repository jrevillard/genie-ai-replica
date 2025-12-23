import 'dart:convert';
import 'package:genie_ai_mobile/services/api_service.dart';

class AdminDashboardProxy {
  final ApiService _api = ApiService();

  Future<Map<String, dynamic>> getSystemHealth() async {
    final res = await _api.get('admin/system-health');
    return jsonDecode(res.body);
  }

  Future<List<dynamic>> getLogs({Map<String, dynamic>? options}) async {
    final res = await _api.get('admin/logs', params: options);
    return jsonDecode(res.body);
  }

  Future<Map<String, dynamic>> getUserStats({Map<String, dynamic>? options}) async {
    final res = await _api.get('admin/user-stats', params: options);
    return jsonDecode(res.body);
  }

  Future<Map<String, dynamic>> getSecurityMetrics() async {
    final res = await _api.get('admin/security-metrics');
    return jsonDecode(res.body);
  }

  Future<Map<String, dynamic>> getSecurityDetails() async {
    final res = await _api.get('admin/security/last-scan');
    return jsonDecode(res.body);
  }

  Future<void> rolloverLogs() async {
    await _api.post('admin/logs/rollover', {});
  }

  Future<Map<String, dynamic>> runDiagnostics() async {
    final res = await _api.post('admin/diagnostics', {});
    return jsonDecode(res.body);
  }

  Future<Map<String, dynamic>> runSecurityScan() async {
    final res = await _api.post('admin/security-scan', {});
    return jsonDecode(res.body);
  }

  Future<Map<String, dynamic>> getLogsSummary({Map<String, dynamic>? options}) async {
    final res = await _api.get('admin/logs/summary', params: options);
    return jsonDecode(res.body);
  }

  Future<Map<String, dynamic>> searchLogs({Map<String, dynamic>? options}) async {
    final res = await _api.get('admin/logs/search', params: options);
    return jsonDecode(res.body);
  }

  Future<Map<String, dynamic>> searchUsers({Map<String, dynamic>? options}) async {
    final res = await _api.get('admin/users/search', params: options);
    return jsonDecode(res.body);
  }
}