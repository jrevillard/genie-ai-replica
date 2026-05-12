import 'chat_message.dart';

enum ChatTopic {
  general,
  medical,
  nutrition,
  exercise,
  medications,
  mentalHealth,
  sleep,
}

class ChatSession {
  final String id;
  final String title;
  final DateTime date;
  final List<ChatMessage> messages;
  final ChatTopic topic;

  const ChatSession({
    required this.id,
    required this.title,
    required this.date,
    required this.messages,
    this.topic = ChatTopic.general,
  });

  ChatSession copyWith({
    String? title,
    List<ChatMessage>? messages,
    ChatTopic? topic,
  }) =>
      ChatSession(
        id: id,
        title: title ?? this.title,
        date: date,
        messages: messages ?? this.messages,
        topic: topic ?? this.topic,
      );
}
