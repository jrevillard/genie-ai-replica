// This file is part of Amina Care.
//
// Amina Care is free software: you can redistribute it and/or modify
// it under the terms of the GNU Lesser General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Amina Care is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Lesser General Public License for more details.
//
// You should have received a copy of the GNU Lesser General Public License
// along with Amina Care. If not, see <https://www.gnu.org/licenses/>.

import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import '../../../../core/network/app_exceptions.dart';
import '../../../../core/network/dio_client.dart';
import '../../domain/entities/prescription_scan_result.dart';
import '../models/chat_response_model.dart';
import '../models/chat_session_model.dart';
import '../models/message_model.dart';
import 'chat_datasource.dart';

class ChatRemoteDatasource implements ChatDatasource {
  ChatRemoteDatasource(this._dio);

  final Dio _dio;
  final List<ChatSessionModel> _sessions = [];

  // ── Sessions ──────────────────────────────────────────────────────────────

  @override
  Future<List<ChatSessionModel>> getSessions() async {
    try {
      final res = await _dio.get<Map<String, dynamic>>(
        '/api/v1/agent/session/resume',
      );
      final json = res.data!;
      final sessionId = json['session_id'] as String?;
      final messages = json['messages'] as List<dynamic>? ?? [];
      if (sessionId == null) return List.from(_sessions);

      final lastContent = messages.isNotEmpty
          ? ((messages.last as Map<String, dynamic>)['content'] as String? ?? '')
          : '';

      final session = ChatSessionModel(
        id: sessionId,
        title: 'Amina Care AI',
        lastMessage: lastContent,
        updatedAt: DateTime.now(),
      );

      final idx = _sessions.indexWhere((s) => s.id == sessionId);
      if (idx == -1) {
        _sessions
          ..removeWhere((s) => s.title == 'Amina Care AI')
          ..insert(0, session);
      } else {
        _sessions[idx] = session;
      }
    } on DioException catch (e) {
      if (e.response?.statusCode != null) throw _mapError(e);
      // Fall back to in-memory list on connectivity error.
    }
    return List.from(_sessions);
  }

  @override
  Future<(String?, List<MessageModel>)> getSessionHistory(
      String sessionId) async {
    try {
      final res = await _dio.get<Map<String, dynamic>>(
        '/api/v1/agent/session/resume',
      );
      final json = res.data!;
      final backendSessionId = json['session_id'] as String?;
      final raw = json['messages'] as List<dynamic>? ?? [];

      if (raw.isEmpty) return (backendSessionId, [_welcomeMessage()]);

      // Limit to last 20 messages to keep memory usage low on the device.
      final slice = raw.length > 20 ? raw.sublist(raw.length - 20) : raw;
      final messages = slice.asMap().entries.map((e) {
        return MessageModel.fromJson(e.value as Map<String, dynamic>,
            index: e.key);
      }).toList();

      return (backendSessionId, messages);
    } on DioException catch (e) {
      if (e.response?.statusCode == 404) return (null, [_welcomeMessage()]);
      throw _mapError(e);
    }
  }

  @override
  Future<ChatSessionModel> createSession() async {
    final session = ChatSessionModel(
      id: DateTime.now().millisecondsSinceEpoch.toString(),
      title: 'New consultation',
      lastMessage: '',
      updatedAt: DateTime.now(),
    );
    _sessions.insert(0, session);
    return session;
  }

  // ── Chat ──────────────────────────────────────────────────────────────────

  @override
  Future<ChatResponseModel> sendMessage({
    required String sessionId,
    required String message,
  }) async {
    try {
      final res = await _dio.post<Map<String, dynamic>>(
        '/api/v1/agent/chat',
        data: {'message': message, 'session_id': sessionId},
      );
      return ChatResponseModel.fromJson(res.data!);
    } on DioException catch (e) {
      throw _mapError(e);
    }
  }

  // ── STT ───────────────────────────────────────────────────────────────────

  @override
  Future<String> transcribeAudio(String filePath) async {
    try {
      final formData = FormData.fromMap({
        'file': await MultipartFile.fromFile(
          filePath,
          filename: 'voice.m4a',
          contentType: DioMediaType('audio', 'm4a'),
        ),
      });
      final res = await _dio.post<Map<String, dynamic>>(
        '/api/v1/stt',
        data: formData,
        options: Options(receiveTimeout: const Duration(seconds: 90)),
      );
      final json = res.data!;
      return (json['transcript'] as String? ?? json['text'] as String? ?? '')
          .trim();
    } on DioException catch (e) {
      throw _mapError(e);
    }
  }

  // ── TTS ───────────────────────────────────────────────────────────────────

  @override
  Future<String> fetchTtsAudio(String text, String lang) async {
    try {
      final res = await _dio.post<List<int>>(
        '/api/v1/tts',
        data: {'text': text, 'lang': lang},
        options: Options(responseType: ResponseType.bytes),
      );
      final bytes = res.data!;
      final dir = await getTemporaryDirectory();
      final path =
          '${dir.path}/tts_${DateTime.now().millisecondsSinceEpoch}.wav';
      await File(path).writeAsBytes(bytes);
      return path;
    } on DioException catch (e) {
      throw _mapError(e);
    }
  }

  // ── Prescription scan ─────────────────────────────────────────────────────

  @override
  Future<PrescriptionScanResult> scanPrescription(
      String filePath, String sessionId, String language) async {
    try {
      final filename = filePath.split(RegExp(r'[/\\]')).last;
      final formData = FormData.fromMap({
        'file': await MultipartFile.fromFile(filePath, filename: filename),
        'session_id': sessionId,
        'language': language,
      });
      final res = await _dio.post<Map<String, dynamic>>(
        '/api/v1/agent/prescription',
        data: formData,
        options: Options(receiveTimeout: const Duration(seconds: 60)),
      );
      final json = res.data!;
      return PrescriptionScanResult(
        isPrescription: json['is_prescription'] as bool? ?? false,
        medicationSummary: (json['medication_summary'] as List<dynamic>? ?? [])
            .map((e) => e as String)
            .toList(),
        guidance: json['guidance'] as String? ?? '',
        reason: json['reason'] as String?,
      );
    } on DioException catch (e) {
      throw _mapError(e);
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  @override
  Future<void> deleteSession(String sessionId) async {
    _sessions.removeWhere((s) => s.id == sessionId);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  static AppException _mapError(DioException e) {
    if (e.response?.statusCode == 401) return const UnauthorizedException();
    if (e.type == DioExceptionType.connectionTimeout ||
        e.type == DioExceptionType.receiveTimeout ||
        e.type == DioExceptionType.sendTimeout ||
        e.type == DioExceptionType.connectionError) {
      return const NetworkException();
    }
    final data = e.response?.data;
    final message = (data is Map<String, dynamic>)
        ? (data['detail'] as String? ?? data['message'] as String? ?? 'Server error')
        : 'Server error (${e.response?.statusCode})';
    return ServerException(statusCode: e.response?.statusCode, message: message);
  }

  MessageModel _welcomeMessage() => MessageModel(
        id: 'msg_welcome',
        role: MessageRole.assistant,
        content:
            "Hello! I'm Amina, your personal health companion. How are you feeling today?",
        timestamp: DateTime.now(),
      );
}

final chatRemoteDatasourceProvider = Provider<ChatDatasource>(
  (ref) => ChatRemoteDatasource(ref.read(dioProvider)),
);
