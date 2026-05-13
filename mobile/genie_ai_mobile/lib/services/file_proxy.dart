import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:genie_ai_mobile/services/api_service.dart';

class FileProxy {
  final ApiService _api;

  /// Creates a [FileProxy]. Uses [ApiService.defaultHttpClient] (set at app
  /// startup with the [AuthInterceptor]) unless an explicit [httpClient] is
  /// provided. The authenticated client ensures Bearer token injection for
  /// both regular and multipart requests.
  FileProxy({http.Client? httpClient})
      : _api = ApiService(httpClient: httpClient);

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

    // Auth token is injected by sendAuthenticated() which routes the request
    // through the AuthInterceptor-wrapped client.

    request.fields['context'] = context;
    request.fields['entityId'] = entityId;
    request.files.add(
      http.MultipartFile.fromBytes('file', bytes, filename: filename),
    );

    final streamedResponse = await _api.sendAuthenticated(request);
    var responseData = await streamedResponse.stream.bytesToString();
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
