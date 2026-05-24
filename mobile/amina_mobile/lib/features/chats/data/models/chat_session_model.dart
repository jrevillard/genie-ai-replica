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
