import 'dart:convert';
import 'package:genie_ai_mobile/services/api_service.dart';

class ChatHistoryProxy {
  final ApiService _api = ApiService();

  Future<Map<String, dynamic>> getUserConversations(
    String userId,
    Map<String, Object> map, {
    Map<String, dynamic>? options,
  }) async {
    final Map<String, String> params = {'userId': userId};
    if (options != null) {
      options.forEach((key, value) {
        params[key] = value.toString();
      });
    }

    final res = await _api.get('chat/conversations', params: params);
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> createConversation(Map<String, dynamic> data) async {
    final res = await _api.post('chat/conversations', data);
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

    Future<Map<String, dynamic>> updateConversation(String id, Map<String, dynamic> data) async {
    // ADD userId to the payload if not already present
    if (!data.containsKey('userId')) {
      // You'll need to pass userId from the panel or store it
      // For now, we'll assume it's available — but see solution below
    }

    final res = await _api.patch('chat/conversations/$id', data);
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> deleteConversation(String id, String userId) async {
    // FIX: params must be Map<String, String>
    final Map<String, String> params = {'userId': userId};

    final res = await _api.delete('chat/conversations/$id', params: params);
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  Future<List<dynamic>> getUserFolders(String userId, {Map<String, dynamic>? options}) async {
    // FIX: Safely convert options to Map<String, String>
    final Map<String, String> params = {'userId': userId};
    if (options != null) {
      options.forEach((key, value) {
        params[key] = value.toString();
      });
    }

    final res = await _api.get('chat/folders', params: params);
    return jsonDecode(res.body) as List<dynamic>;
  }

  Future<Map<String, dynamic>> createFolder(Map<String, dynamic> data) async {
    final res = await _api.post('chat/folders', data);
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> updateFolder(String folderId, Map<String, dynamic> data) async {
    final res = await _api.patch('chat/folders/$folderId', data);
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> deleteFolder(String folderId, String userId) async {
    // FIX: params must be Map<String, String>
    final Map<String, String> params = {'userId': userId};

    final res = await _api.delete('chat/folders/$folderId', params: params);
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> addConversationToFolder(String folderId, String convId, String userId) async {
    final Map<String, String> data = {'userId': userId};

    final res = await _api.post('chat/folders/$folderId/conversations/$convId', data);
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

    Future<List<dynamic>> getFolderConversations(String folderId) async {
    final res = await _api.get('chat/folders/$folderId');
    final body = jsonDecode(res.body);
    // The endpoint returns direct array of conversations
    return body is List ? body : (body['conversations'] as List? ?? []);
  }
}