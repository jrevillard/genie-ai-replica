import 'dart:convert';
import 'package:genie_ai_mobile/services/api_service.dart';

class DocumentFileProxy {
  final ApiService _api = ApiService();

  Future<Map<String, dynamic>> getFiles(Map<String, dynamic> params) async {
    final res = await _api.get('files', params: params);
    return jsonDecode(res.body);
  }

  Future<Map<String, dynamic>> ingestFile(String fileId) async {
    final res = await _api.post('files/$fileId/ingest', {});
    return jsonDecode(res.body);
  }

  Future<Map<String, dynamic>> scheduleSiteCrawl(
      Map<String, dynamic> options) async {
    final res = await _api.post('files/crawl/schedule', options);
    return jsonDecode(res.body);
  }

  Future<Map<String, dynamic>> killCrawl(String fileId) async {
    final res = await _api.post('files/$fileId/kill-crawl', {});
    return jsonDecode(res.body);
  }

  Future<Map<String, dynamic>> getFileMetadata(String fileId) async {
    final res = await _api.get('files/$fileId');
    if (res.statusCode != 200) {
      throw Exception("Failed to fetch file metadata: ${res.statusCode}");
    }
    return jsonDecode(res.body);
  }
}
