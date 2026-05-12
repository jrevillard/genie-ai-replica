import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../domain/entities/chat_agent_response.dart';
import '../../domain/entities/chat_message.dart';
import '../../domain/entities/chat_session.dart';
import '../../domain/entities/prescription_scan_result.dart';
import '../../domain/repositories/chat_repository.dart';
import '../datasources/chat_datasource.dart';
import '../datasources/chat_remote_datasource.dart';

// To use the mock backend during development, replace chatRemoteDatasourceProvider
// with chatMockDatasourceProvider in the line below.
final chatRepositoryProvider = Provider<ChatRepository>(
  (ref) => ChatRepositoryImpl(ref.read(chatRemoteDatasourceProvider)),
);

class ChatRepositoryImpl implements ChatRepository {
  const ChatRepositoryImpl(this._datasource);

  final ChatDatasource _datasource;

  @override
  Future<List<ChatSession>> getSessions() async {
    final models = await _datasource.getSessions();
    return models.map((m) => m.toChatSession()).toList();
  }

  @override
  Future<(String?, List<ChatMessage>)> getSessionHistory(
      String sessionId) async {
    final (confirmedId, models) =
        await _datasource.getSessionHistory(sessionId);
    return (confirmedId, models.map((m) => m.toChatMessage()).toList());
  }

  @override
  Future<ChatSession> createSession() async {
    final model = await _datasource.createSession();
    return model.toChatSession();
  }

  @override
  Future<ChatAgentResponse> sendMessage({
    required String sessionId,
    required String message,
  }) async {
    final response = await _datasource.sendMessage(
      sessionId: sessionId,
      message: message,
    );
    final now = DateTime.now();
    final time = '${now.hour}:${now.minute.toString().padLeft(2, '0')}';
    return ChatAgentResponse(
      message: ChatMessage(
        id: 'msg_${now.millisecondsSinceEpoch}',
        text: response.response,
        isUser: false,
        time: time,
        sources: response.sources,
      ),
      isEmergency: response.isEmergency,
      sessionId: response.sessionId,
    );
  }

  @override
  Future<String> transcribeAudio(String filePath) =>
      _datasource.transcribeAudio(filePath);

  @override
  Future<String> fetchTtsAudio(String text, String lang) =>
      _datasource.fetchTtsAudio(text, lang);

  @override
  Future<void> deleteSession(String sessionId) =>
      _datasource.deleteSession(sessionId);

  @override
  Future<PrescriptionScanResult> scanPrescription(
          String filePath, String sessionId, String language) =>
      _datasource.scanPrescription(filePath, sessionId, language);
}
