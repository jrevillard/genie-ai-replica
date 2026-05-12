import 'chat_source.dart';

class ChatMessage {
  final String id;
  final String text;
  final bool isUser;
  final String time;
  final List<ChatSource> sources;

  const ChatMessage({
    required this.id,
    required this.text,
    required this.isUser,
    required this.time,
    this.sources = const [],
  });
}
