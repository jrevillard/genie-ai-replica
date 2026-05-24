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
