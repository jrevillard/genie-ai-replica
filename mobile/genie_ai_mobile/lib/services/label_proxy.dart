import 'dart:convert';
import 'package:genie_ai_mobile/services/api_service.dart';

class LabelProxy {
  final ApiService _api = ApiService();

  Future<List<dynamic>> getLabels({Map<String, dynamic>? params}) async {
    final res = await _api.get('labels', params: params);
    return jsonDecode(res.body);
  }

  Future<Map<String, dynamic>> createLabel(
    Map<String, dynamic> labelData,
  ) async {
    final res = await _api.post('labels', labelData);
    return jsonDecode(res.body);
  }

  Future<Map<String, dynamic>> updateLabel(
    String id,
    Map<String, dynamic> updates,
  ) async {
    final res = await _api.patch('labels/$id', updates);
    return jsonDecode(res.body);
  }

  Future<void> deleteLabel(String id) async {
    await _api.delete('labels/$id');
  }
}
