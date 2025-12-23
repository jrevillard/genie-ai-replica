import 'dart:convert';
import 'package:genie_ai_mobile/services/api_service.dart';

class ChatHistoryProxy {
  final ApiService _api = ApiService();

  Future<Map<String, dynamic>> getUserConversations(String userId, {Map<String, dynamic>? options}) async {
    final res = await _api.get('chat/conversations', params: {'userId': userId, ...?options});
    return jsonDecode(res.body);
  }

  Future<Map<String, dynamic>> createConversation(Map<String, dynamic> data) async {
    final res = await _api.post('chat/conversations', data);
    return jsonDecode(res.body);
  }

  Future<Map<String, dynamic>> updateConversation(String id, Map<String, dynamic> data) async {
    final res = await _api.patch('chat/conversations/$id', data);
    return jsonDecode(res.body);
  }

  Future<Map<String, dynamic>> deleteConversation(String id, String userId) async {
    final res = await _api.delete('chat/conversations/$id', params: {'userId': userId});
    return jsonDecode(res.body);
  }

  Future<List<dynamic>> getUserFolders(String userId, {Map<String, dynamic>? options}) async {
    final res = await _api.get('chat/folders', params: {'userId': userId, ...?options});
    return jsonDecode(res.body);
  }

  Future<Map<String, dynamic>> createFolder(Map<String, dynamic> data) async {
    final res = await _api.post('chat/folders', data);
    return jsonDecode(res.body);
  }

  Future<Map<String, dynamic>> addConversationToFolder(String fId, String cId, String uId) async {
    final res = await _api.post('chat/folders/$fId/conversations/$cId', {'userId': uId});
    return jsonDecode(res.body);
  }
}