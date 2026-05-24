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
