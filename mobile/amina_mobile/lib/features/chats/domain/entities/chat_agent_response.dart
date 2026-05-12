import 'chat_message.dart';

class ChatAgentResponse {
  final ChatMessage message;
  final bool isEmergency;
  final String sessionId;

  const ChatAgentResponse({
    required this.message,
    required this.isEmergency,
    required this.sessionId,
  });
}
