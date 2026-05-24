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

import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import '../../domain/entities/chat_message.dart';
import '../../domain/entities/chat_session.dart';
import '../../domain/entities/chat_source.dart';

// Persists the session list across app restarts using SharedPreferences.
// Only sessions that contain at least one user message are saved (welcome-only
// sessions are ephemeral and not worth storing).
// Full message content is stored so history remains readable offline.

class SessionCache {
  static const _key      = 'amina_session_cache_v1';
  static const _maxSessions  = 30;
  static const _maxMessages  = 40; // per session

  // ── Save ──────────────────────────────────────────────────────────────────

  static Future<void> save(List<ChatSession> sessions) async {
    final prefs = await SharedPreferences.getInstance();
    final toSave = sessions
        .where((s) => s.messages.any((m) => m.isUser))
        .take(_maxSessions)
        .map(_sessionToJson)
        .toList();
    await prefs.setString(_key, jsonEncode(toSave));
  }

  // ── Load ──────────────────────────────────────────────────────────────────

  static Future<List<ChatSession>> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw   = prefs.getString(_key);
      if (raw == null || raw.isEmpty) return [];
      final list  = jsonDecode(raw) as List<dynamic>;
      return list
          .map((e) => _sessionFromJson(e as Map<String, dynamic>))
          .toList();
    } catch (_) {
      return [];
    }
  }

  // ── Clear ─────────────────────────────────────────────────────────────────

  static Future<void> clear() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_key);
  }

  // ── Serialization ─────────────────────────────────────────────────────────

  static Map<String, dynamic> _sessionToJson(ChatSession s) {
    final messages = s.messages.length > _maxMessages
        ? s.messages.sublist(s.messages.length - _maxMessages)
        : s.messages;
    return {
      'id':       s.id,
      'title':    s.title,
      'date':     s.date.toIso8601String(),
      'topic':    s.topic.index,
      'messages': messages.map(_messageToJson).toList(),
    };
  }

  static Map<String, dynamic> _messageToJson(ChatMessage m) => {
    'id':     m.id,
    'text':   m.text,
    'isUser': m.isUser,
    'time':   m.time,
    'sources': m.sources.map((src) => {
      'title': src.title,
      'url':   src.url,
      'org':   src.org,
    }).toList(),
  };

  static ChatSession _sessionFromJson(Map<String, dynamic> j) => ChatSession(
    id:       j['id'] as String,
    title:    j['title'] as String,
    date:     DateTime.parse(j['date'] as String),
    topic:    ChatTopic.values[j['topic'] as int],
    messages: (j['messages'] as List<dynamic>)
        .map((e) => _messageFromJson(e as Map<String, dynamic>))
        .toList(),
  );

  static ChatMessage _messageFromJson(Map<String, dynamic> j) => ChatMessage(
    id:      j['id'] as String,
    text:    j['text'] as String,
    isUser:  j['isUser'] as bool,
    time:    j['time'] as String,
    sources: (j['sources'] as List<dynamic>? ?? [])
        .map((e) => ChatSource(
              title: e['title'] as String,
              url:   e['url'] as String?,
              org:   e['org'] as String?,
            ))
        .toList(),
  );
}
