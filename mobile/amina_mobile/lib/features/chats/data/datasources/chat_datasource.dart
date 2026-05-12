import '../../domain/entities/prescription_scan_result.dart';
import '../models/chat_response_model.dart';
import '../models/chat_session_model.dart';
import '../models/message_model.dart';

abstract class ChatDatasource {
  Future<List<ChatSessionModel>> getSessions();

  Future<(String?, List<MessageModel>)> getSessionHistory(String sessionId);

  Future<ChatSessionModel> createSession();

  Future<ChatResponseModel> sendMessage({
    required String sessionId,
    required String message,
  });

  Future<String> transcribeAudio(String filePath);

  Future<String> fetchTtsAudio(String text, String lang);

  Future<void> deleteSession(String sessionId);

  Future<PrescriptionScanResult> scanPrescription(
      String filePath, String sessionId, String language);
}
