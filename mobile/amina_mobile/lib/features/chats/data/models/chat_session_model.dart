import '../../domain/entities/chat_session.dart';

class ChatSessionModel {
  final String id;
  final String title;
  final String lastMessage;
  final DateTime updatedAt;
  final bool hasUnread;

  const ChatSessionModel({
    required this.id,
    required this.title,
    required this.lastMessage,
    required this.updatedAt,
    this.hasUnread = false,
  });

  factory ChatSessionModel.fromJson(Map<String, dynamic> json) => ChatSessionModel(
        id: json['id'] as String,
        title: json['title'] as String,
        lastMessage: json['last_message'] as String? ?? '',
        updatedAt: DateTime.tryParse(json['updated_at'] as String? ?? '') ??
            DateTime.now(),
        hasUnread: json['has_unread'] as bool? ?? false,
      );

  ChatSession toChatSession() => ChatSession(
        id: id,
        title: title,
        date: updatedAt,
        messages: const [],
      );
}
