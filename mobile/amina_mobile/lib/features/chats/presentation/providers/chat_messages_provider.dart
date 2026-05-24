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

import 'dart:async';
import 'package:audioplayers/audioplayers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../features/auth/data/datasources/auth_local_datasource.dart';
import '../../data/datasources/session_cache.dart';
import '../../data/repositories/chat_repository_impl.dart';
import '../../domain/entities/chat_agent_response.dart';
import '../../domain/entities/chat_message.dart';
import '../../domain/entities/chat_session.dart';

// Re-export domain entities so existing widget imports keep working unchanged.
export '../../domain/entities/chat_message.dart';
export '../../domain/entities/chat_session.dart';
export '../../domain/entities/chat_source.dart';

// ─── SessionsState ────────────────────────────────────────────────────────────

class SessionsState {
  final List<ChatSession> sessions;
  final String activeId;
  final bool isLoadingHistory;
  final bool isEmergency;
  final String? error;
  final String? playingMessageId;
  final bool isTtsLoading;

  const SessionsState({
    required this.sessions,
    required this.activeId,
    this.isLoadingHistory = false,
    this.isEmergency = false,
    this.error,
    this.playingMessageId,
    this.isTtsLoading = false,
  });

  SessionsState copyWith({
    List<ChatSession>? sessions,
    String? activeId,
    bool? isLoadingHistory,
    bool? isEmergency,
    String? error,
    String? playingMessageId,
    bool clearPlayingMessage = false,
    bool? isTtsLoading,
  }) =>
      SessionsState(
        sessions: sessions ?? this.sessions,
        activeId: activeId ?? this.activeId,
        isLoadingHistory: isLoadingHistory ?? this.isLoadingHistory,
        isEmergency: isEmergency ?? this.isEmergency,
        error: error,
        playingMessageId: clearPlayingMessage
            ? null
            : (playingMessageId ?? this.playingMessageId),
        isTtsLoading: isTtsLoading ?? this.isTtsLoading,
      );

  ChatSession? get activeSession {
    try {
      return sessions.firstWhere((s) => s.id == activeId);
    } catch (_) {
      return sessions.isEmpty ? null : sessions.first;
    }
  }

  List<ChatMessage> get activeMessages => activeSession?.messages ?? const [];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

String _uid() => DateTime.now().millisecondsSinceEpoch.toString();

ChatSession _welcomeSession() => ChatSession(
      id: _uid(),
      title: 'New Conversation',
      date: DateTime.now(),
      messages: const [
        ChatMessage(
          id: 'msg_welcome',
          text: "Good morning! I'm Amina, your personal health companion. "
              'How are you feeling today? 💊',
          isUser: false,
          time: '9:30 AM',
        ),
      ],
    );

SessionsState _initialState() {
  final welcome = _welcomeSession();
  return SessionsState(
    sessions: [welcome],
    activeId: welcome.id,
  );
}

// ─── Notifier ─────────────────────────────────────────────────────────────────

class ChatSessionsNotifier extends StateNotifier<SessionsState> {
  final Ref _ref;
  AudioPlayer? _audioPlayer;

  ChatSessionsNotifier(this._ref) : super(_initialState()) {
    _init();
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  ChatSession? get _active => state.activeSession;

  void _patchSession(String id, ChatSession updated) {
    state = state.copyWith(
      sessions: [for (final s in state.sessions) s.id == id ? updated : s],
    );
  }

  // ── Initialization ────────────────────────────────────────────────────────

  Future<void> _init() async {
    // 1. Load cached sessions immediately (works offline).
    final cached = await SessionCache.load();
    if (cached.isNotEmpty && mounted) {
      state = state.copyWith(
        sessions: cached,
        activeId: cached.first.id,
      );
    }

    // 2. Sync with backend when connected.
    final hasToken =
        await _ref.read(authLocalDatasourceProvider).getAccessToken() != null;
    if (!hasToken) return;

    try {
      final repo = _ref.read(chatRepositoryProvider);
      final sessions = await repo.getSessions();
      if (!mounted || sessions.isEmpty) return;

      final backendSession = sessions.first;

      // Merge: backend session replaces or leads the list; cached extras follow.
      final others = state.sessions
          .where((s) => s.id != backendSession.id)
          .toList();
      state = state.copyWith(
        sessions: [backendSession, ...others],
        activeId: backendSession.id,
        isLoadingHistory: true,
      );

      final (confirmedId, messages) =
          await repo.getSessionHistory(backendSession.id);
      if (!mounted) return;

      final finalId = confirmedId ?? backendSession.id;
      _patchSession(
        backendSession.id,
        ChatSession(
          id: finalId,
          title: backendSession.title,
          date: backendSession.date,
          messages: messages,
        ),
      );
      state = state.copyWith(activeId: finalId, isLoadingHistory: false);

      // 3. Persist updated state.
      await SessionCache.save(state.sessions);
    } catch (_) {
      // Backend unreachable — keep using cached state.
      if (mounted) state = state.copyWith(isLoadingHistory: false);
    }
  }

  // ── Topic inference ────────────────────────────────────────────────────────

  static ChatTopic _inferTopic(String text) {
    final t = text.toLowerCase();
    if (RegExp(r'blood|pressure|doctor|pain|symptom|hospital|fever|heart|chest|pulse|dizzy|breathing').hasMatch(t)) return ChatTopic.medical;
    if (RegExp(r'\beat\b|food|diet|meal|breakfast|lunch|dinner|fruit|vegetable|calori|sugar|carb|protein|nutrition|weight|cholesterol').hasMatch(t)) return ChatTopic.nutrition;
    if (RegExp(r'walk|exercise|gym|steps|run|workout|stretch|yoga|sport|physio|movement|active').hasMatch(t)) return ChatTopic.exercise;
    if (RegExp(r'medication|medicine|pill|drug|prescription|dose|tablet|metformin|insulin|aspirin|supplement').hasMatch(t)) return ChatTopic.medications;
    if (RegExp(r'stress|anxiety|feel|mood|sad|happy|mental|emotion|depress|worry|lonely|fear|nervous').hasMatch(t)) return ChatTopic.mentalHealth;
    if (RegExp(r'sleep|tired|rest|insomnia|night|wake|drowsy|fatigue|nap|nocturia').hasMatch(t)) return ChatTopic.sleep;
    return ChatTopic.general;
  }

  // ── Text message ──────────────────────────────────────────────────────────

  Future<void> sendMessage(String text, {bool autoPlayTts = false}) async {
    final trimmed = text.trim();
    if (trimmed.isEmpty) return;

    final session = _active;
    if (session == null) return;

    final now = DateTime.now();
    final timeStr = '${now.hour}:${now.minute.toString().padLeft(2, '0')}';
    final isFirstUserMsg = session.messages.every((m) => !m.isUser);

    _patchSession(
      session.id,
      session.copyWith(
        title: isFirstUserMsg
            ? (trimmed.length > 40 ? '${trimmed.substring(0, 40)}…' : trimmed)
            : session.title,
        topic: isFirstUserMsg ? _inferTopic(trimmed) : session.topic,
        messages: [
          ...session.messages,
          ChatMessage(
              id: 'msg_${now.millisecondsSinceEpoch}',
              text: trimmed,
              isUser: true,
              time: timeStr),
        ],
      ),
    );

    _ref.read(isChatActiveProvider.notifier).state = true;
    _ref.read(chatIsTypingProvider.notifier).state = true;

    try {
      final ChatAgentResponse response =
          await _ref.read(chatRepositoryProvider).sendMessage(
                sessionId: session.id,
                message: trimmed,
              );

      if (!mounted) return;
      _ref.read(chatIsTypingProvider.notifier).state = false;

      final current = state.sessions.firstWhere(
        (s) => s.id == session.id,
        orElse: () => session,
      );
      _patchSession(
        session.id,
        current.copyWith(messages: [...current.messages, response.message]),
      );

      final newId = response.sessionId.isNotEmpty &&
              response.sessionId != session.id
          ? response.sessionId
          : session.id;
      if (newId != session.id) {
        state = state.copyWith(activeId: newId);
      }
      if (response.isEmergency) {
        state = state.copyWith(isEmergency: true);
      }
      if (autoPlayTts) {
        unawaited(playTts(response.message.id, response.message.text));
      }
      unawaited(SessionCache.save(state.sessions));
    } catch (_) {
      if (!mounted) return;
      _ref.read(chatIsTypingProvider.notifier).state = false;
      state = state.copyWith(
          error: 'Could not reach Amina. Please check your connection.');
    }
  }

  // ── Voice message (STT → sendMessage) ────────────────────────────────────

  Future<void> sendAudio(String filePath) async {
    _ref.read(chatIsTypingProvider.notifier).state = true;
    try {
      final transcript = await _ref
          .read(chatRepositoryProvider)
          .transcribeAudio(filePath);

      if (!mounted) return;
      _ref.read(chatIsTypingProvider.notifier).state = false;

      if (transcript.trim().isEmpty) {
        state = state.copyWith(
            error: "I didn't catch that — please try again.");
        return;
      }

      await sendMessage(transcript);
    } catch (_) {
      if (!mounted) return;
      _ref.read(chatIsTypingProvider.notifier).state = false;
      state =
          state.copyWith(error: 'Voice message failed. Please try again.');
    }
  }

  // ── TTS ───────────────────────────────────────────────────────────────────

  Future<void> playTts(String messageId, String text) async {
    // Tapping the active bubble stops playback.
    if (state.playingMessageId == messageId) {
      await _stopTtsInternal();
      return;
    }
    await _stopTtsInternal();

    state = state.copyWith(playingMessageId: messageId, isTtsLoading: true);

    try {
      final filePath = await _ref
          .read(chatRepositoryProvider)
          .fetchTtsAudio(text, 'en');

      if (!mounted) return;
      state = state.copyWith(isTtsLoading: false);

      _audioPlayer = AudioPlayer();
      _audioPlayer!.onPlayerComplete.listen((_) {
        if (mounted) state = state.copyWith(clearPlayingMessage: true);
        _audioPlayer?.dispose();
        _audioPlayer = null;
      });
      await _audioPlayer!.play(DeviceFileSource(filePath));
    } catch (_) {
      if (mounted) {
        state = state.copyWith(
            clearPlayingMessage: true, isTtsLoading: false);
      }
    }
  }

  Future<void> stopTts() => _stopTtsInternal();

  Future<void> _stopTtsInternal() async {
    await _audioPlayer?.stop();
    _audioPlayer?.dispose();
    _audioPlayer = null;
    if (mounted) {
      state =
          state.copyWith(clearPlayingMessage: true, isTtsLoading: false);
    }
  }

  // ── Session management ────────────────────────────────────────────────────

  void newSession() {
    final fresh = _welcomeSession();
    state = state.copyWith(
      sessions: [fresh, ...state.sessions],
      activeId: fresh.id,
      isEmergency: false,
      error: null,
    );
    _ref.read(isChatActiveProvider.notifier).state = false;
    _ref.read(chatIsTypingProvider.notifier).state = false;
    unawaited(SessionCache.save(state.sessions));
  }

  void loadSession(String id) {
    state = state.copyWith(activeId: id, isEmergency: false, error: null);
    _ref.read(isChatActiveProvider.notifier).state = true;
    _ref.read(chatIsTypingProvider.notifier).state = false;
  }

  Future<void> deleteSession(String id) async {
    try {
      await _ref.read(chatRepositoryProvider).deleteSession(id);
    } catch (_) {
      // Best-effort — remove locally even if the API call fails.
    }
    final remaining = state.sessions.where((s) => s.id != id).toList();
    if (remaining.isEmpty) {
      final fresh = _welcomeSession();
      state = SessionsState(sessions: [fresh], activeId: fresh.id);
      _ref.read(isChatActiveProvider.notifier).state = false;
    } else {
      final newActiveId =
          state.activeId == id ? remaining.first.id : state.activeId;
      state = state.copyWith(sessions: remaining, activeId: newActiveId);
    }
    unawaited(SessionCache.save(state.sessions));
  }

  void clearError() => state = state.copyWith(error: null);

  @override
  void dispose() {
    _audioPlayer?.stop();
    _audioPlayer?.dispose();
    super.dispose();
  }
}

// ─── Providers ────────────────────────────────────────────────────────────────

final chatIsTypingProvider = StateProvider<bool>((ref) => false);
final isChatActiveProvider = StateProvider<bool>((ref) => false);

final chatSessionsProvider =
    StateNotifierProvider<ChatSessionsNotifier, SessionsState>(
  (ref) => ChatSessionsNotifier(ref),
);

final chatMessagesProvider = Provider<List<ChatMessage>>(
  (ref) => ref.watch(chatSessionsProvider).activeMessages,
);
