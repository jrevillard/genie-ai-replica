import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../domain/entities/prescription_scan_result.dart';
import '../models/chat_response_model.dart';
import '../models/chat_session_model.dart';
import '../models/message_model.dart';
import 'chat_datasource.dart';

// Simulates backend responses without a network connection.
// Switch chatDatasourceProvider to this in chat_repository_impl.dart for offline dev.
class ChatMockDatasource implements ChatDatasource {
  static const _responses = [
    "Based on what you've shared, it's important to monitor your glucose levels "
        "before and after each main meal. Try to keep a log so your doctor can "
        "identify any patterns.",
    "That's a great question. According to current clinical guidelines, blood pressure "
        "should be checked at least twice a day — ideally in the morning and before "
        "bed. Do you have a monitor at home?",
    "The dizziness when standing up that you mention could be related to orthostatic "
        "hypotension, which is common with your condition. Try standing up slowly and "
        "staying well hydrated. If it continues for more than three days, please see "
        "your doctor.",
    "Managing your condition well comes down to three pillars: balanced nutrition, "
        "moderate physical activity, and taking your medication consistently. "
        "Which of these would you like to focus on today?",
  ];

  int _responseIndex = 0;

  final List<ChatSessionModel> _sessions = [
    ChatSessionModel(
      id: 'mock_session_1',
      title: 'Amina Care AI',
      lastMessage: 'How are you feeling today?',
      updatedAt: DateTime.now(),
    ),
  ];

  @override
  Future<List<ChatSessionModel>> getSessions() async {
    await Future.delayed(const Duration(milliseconds: 400));
    return List.from(_sessions);
  }

  @override
  Future<(String?, List<MessageModel>)> getSessionHistory(
      String sessionId) async {
    await Future.delayed(const Duration(milliseconds: 600));
    return (
      sessionId,
      [
        MessageModel(
          id: 'msg_welcome',
          role: MessageRole.assistant,
          content:
              "Hello! I'm Amina, your personal health companion. How are you feeling today?",
          timestamp: DateTime.now().subtract(const Duration(minutes: 1)),
        ),
      ]
    );
  }

  @override
  Future<ChatSessionModel> createSession() async {
    await Future.delayed(const Duration(milliseconds: 300));
    final session = ChatSessionModel(
      id: 'mock_${DateTime.now().millisecondsSinceEpoch}',
      title: 'New consultation',
      lastMessage: '',
      updatedAt: DateTime.now(),
    );
    _sessions.insert(0, session);
    return session;
  }

  @override
  Future<ChatResponseModel> sendMessage({
    required String sessionId,
    required String message,
  }) async {
    await Future.delayed(const Duration(milliseconds: 900));
    final text = _responses[_responseIndex % _responses.length];
    _responseIndex++;
    return ChatResponseModel(
      response: text,
      isEmergency: false,
      sessionId: sessionId,
      sources: const [],
    );
  }

  @override
  Future<String> transcribeAudio(String filePath) async {
    await Future.delayed(const Duration(milliseconds: 800));
    return 'How do I manage my blood sugar levels?';
  }

  @override
  Future<String> fetchTtsAudio(String text, String lang) async {
    await Future.delayed(const Duration(milliseconds: 600));
    // Returns empty path — audioplayers will fail silently in mock mode.
    return '';
  }

  @override
  Future<void> deleteSession(String sessionId) async {
    await Future.delayed(const Duration(milliseconds: 200));
    _sessions.removeWhere((s) => s.id == sessionId);
  }

  @override
  Future<PrescriptionScanResult> scanPrescription(
    String filePath,
    String sessionId,
    String language,
  ) async {
    await Future.delayed(const Duration(milliseconds: 700));
    return const PrescriptionScanResult(
      isPrescription: true,
      medicationSummary: ['Metformin 500mg — twice daily', 'Lisinopril 10mg — once daily'],
      guidance: 'Take Metformin with meals to reduce stomach upset. '
          'Take Lisinopril at the same time each day. '
          'Avoid NSAIDs while on Lisinopril.',
    );
  }
}

final chatMockDatasourceProvider = Provider<ChatDatasource>(
  (_) => ChatMockDatasource(),
);
