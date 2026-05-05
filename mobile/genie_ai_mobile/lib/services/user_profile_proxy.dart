// lib/services/user_profile_proxy.dart
// FINAL - WORKS WITH YOUR BACKEND (PUT /api/users/:userId)

import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:image_picker/image_picker.dart';
import 'package:genie_ai_mobile/services/api_service.dart';

class UserProfileProxy {
  final ApiService _api = ApiService();

  /// GET /api/users/:userId
  Future<Map<String, dynamic>> getProfile(String userId) async {
    final res = await _api.get('$userId');
    if (res.statusCode != 200) {
      throw Exception('Failed to load profile: ${res.statusCode} ${res.body}');
    }
    return jsonDecode(res.body);
  }

  /// PUT /api/users/:userId - update profile with actual userId
  Future<Map<String, dynamic>> updateProfile(
    String userId,
    Map<String, dynamic> profileData,
  ) async {
    final bool hasFiles = _containsFiles(profileData);

    if (!hasFiles) {
      final res = await _api.put('$userId', profileData);
      if (res.statusCode != 200) {
        throw Exception('Update failed: ${res.statusCode} ${res.body}');
      }
      return jsonDecode(res.body);
    }

    // Multipart upload
    final request = http.MultipartRequest(
      'PUT',
      Uri.parse('${_api.baseUrl}/$userId'),
    );

    final Map<String, dynamic> dataToSend = jsonDecode(jsonEncode(profileData));

    final List<String> fileSections = [
      'personalIdentification',
      'civilRegistration',
      'addressResidency',
      'identityTravel',
      'healthMedical',
      'employment',
      'financialTax',
      'criminalLegal',
      'transportation',
      'civicParticipation',
    ];

    final List<Future<http.MultipartFile>> fileFutures = [];

    for (final section in fileSections) {
      if (dataToSend[section] == null) continue;

      dataToSend[section].forEach((key, value) {
        if (value is XFile || value is File) {
          final String filePath = value is XFile
              ? value.path
              : (value as File).path;
          final String filename = value is XFile
              ? value.name
              : (value as File).path
                    .split(Platform.isWindows ? '\\' : '/')
                    .last;
          final String fieldName = '$section-$key';

          fileFutures.add(
            http.MultipartFile.fromPath(
              fieldName,
              filePath,
              filename: filename,
            ),
          );

          dataToSend[section][key] = null;
        }
      });
    }

    if (fileFutures.isNotEmpty) {
      final files = await Future.wait(fileFutures);
      request.files.addAll(files);
    }

    request.fields['data'] = jsonEncode(dataToSend);

    final streamedResponse = await request.send();
    final response = await http.Response.fromStream(streamedResponse);

    if (response.statusCode != 200) {
      throw Exception('Update failed: ${response.statusCode} ${response.body}');
    }

    return jsonDecode(response.body);
  }

  bool _containsFiles(Map<String, dynamic> data) {
    for (final value in data.values) {
      if (value is Map<String, dynamic>) {
        if (_containsFiles(value)) return true;
      } else if (value is XFile || value is File) {
        return true;
      }
    }
    return false;
  }

  // Admin methods unchanged
  Future<Map<String, dynamic>> updateUserRole(
    String userId,
    String role,
  ) async {
    final res = await _api.put('users/$userId/role', {'role': role});
    return jsonDecode(res.body);
  }

  Future<Map<String, dynamic>> searchUsers(
    Map<String, dynamic> criteria,
  ) async {
    final res = await _api.get('users/search', params: criteria);
    return jsonDecode(res.body);
  }
}
