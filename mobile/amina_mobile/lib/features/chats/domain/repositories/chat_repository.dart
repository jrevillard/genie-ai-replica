import '../entities/chat_agent_response.dart';
import '../entities/chat_message.dart';
import '../entities/chat_session.dart';
import '../entities/prescription_scan_result.dart';

abstract class ChatRepository {
  Future<List<ChatSession>> getSessions();

  // Returns (confirmedSessionId, messages). The backend may assign a different
  // session ID than the one requested — callers must update accordingly.
  Future<(String?, List<ChatMessage>)> getSessionHistory(String sessionId);

  Future<ChatSession> createSession();

  Future<ChatAgentResponse> sendMessage({
    required String sessionId,
    required String message,
  });

  Future<String> transcribeAudio(String filePath);

  Future<String> fetchTtsAudio(String text, String lang);

  Future<void> deleteSession(String sessionId);

  Future<PrescriptionScanResult> scanPrescription(
      String filePath, String sessionId, String language);
}
