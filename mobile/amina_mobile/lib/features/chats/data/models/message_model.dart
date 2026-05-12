import '../../domain/entities/chat_message.dart';
import 'chat_source_model.dart';

enum MessageRole { user, assistant }

class MessageModel {
  final String id;
  final MessageRole role;
  final String content;
  final DateTime timestamp;
  final List<ChatSourceModel> sources;

  const MessageModel({
    required this.id,
    required this.role,
    required this.content,
    required this.timestamp,
    this.sources = const [],
  });

  factory MessageModel.fromJson(Map<String, dynamic> json, {required int index}) =>
      MessageModel(
        id: json['id'] as String? ?? 'msg_$index',
        role: json['role'] == 'user' ? MessageRole.user : MessageRole.assistant,
        content: json['content'] as String,
        timestamp: json['timestamp'] != null
            ? DateTime.tryParse(json['timestamp'] as String) ?? DateTime.now()
            : DateTime.now(),
        sources: (json['sources'] as List<dynamic>? ?? [])
            .map((s) => ChatSourceModel.fromJson(s as Map<String, dynamic>))
            .toList(),
      );

  ChatMessage toChatMessage() {
    final h = timestamp.hour;
    final m = timestamp.minute.toString().padLeft(2, '0');
    return ChatMessage(
      id: id,
      text: content,
      isUser: role == MessageRole.user,
      time: '$h:$m',
      sources: sources,
    );
  }
}
