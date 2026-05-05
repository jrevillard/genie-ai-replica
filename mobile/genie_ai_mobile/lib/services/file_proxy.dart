import 'dart:convert';
import 'package:genie_ai_mobile/services/api_service.dart';
import 'package:genie_ai_mobile/services/auth/token_storage.dart';
import 'package:http/http.dart' as http;

class FileProxy {
  final ApiService _api;
  final TokenStorage _tokenStorage;

  FileProxy({ApiService? api, required TokenStorage tokenStorage})
      : _api = api ?? ApiService(),
        _tokenStorage = tokenStorage;

  Future<Map<String, dynamic>> uploadFile(
    List<int> bytes,
    String filename,
    String context,
    String entityId,
  ) async {
    var request = http.MultipartRequest(
      'POST',
      Uri.parse('${_api.baseUrl}/files/upload'),
    );
    // Do NOT set Content-Type manually — http.MultipartRequest auto-generates
    // the boundary parameter. Setting it manually without boundary breaks uploads.

    final token = await _tokenStorage.getAccessToken();
    if (token != null) {
      request.headers['Authorization'] = 'Bearer $token';
    }

    request.fields['context'] = context;
    request.fields['entityId'] = entityId;
    request.files.add(
      http.MultipartFile.fromBytes('file', bytes, filename: filename),
    );

    var response = await request.send();
    var responseData = await response.stream.bytesToString();
    return jsonDecode(responseData);
  }

  Future<void> deleteFile(String fileId) async {
    await _api.delete('files/$fileId');
  }

  Future<Map<String, dynamic>> getFileMetadata(String fileId) async {
    final res = await _api.get('files/$fileId/metadata');
    return jsonDecode(res.body);
  }

  Future<List<dynamic>> getEntityFiles(String entityId, String context) async {
    final res = await _api.get(
      'files',
      params: {'entityId': entityId, 'context': context},
    );
    return jsonDecode(res.body);
  }

  String getFileUrl(String fileId) => '${_api.baseUrl}/files/$fileId';
}
