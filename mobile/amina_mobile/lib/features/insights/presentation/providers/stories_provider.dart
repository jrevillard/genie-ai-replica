import 'package:flutter_riverpod/flutter_riverpod.dart';

// ─── SeenStoriesNotifier ──────────────────────────────────────────────────────

/// Tracks which [HealthStory] IDs have been viewed in the current session.
///
/// A story is marked "seen" when:
///   • The user watches its last slide through to completion, OR
///   • The user manually closes the viewer while on any slide.
///
/// State is in-memory only — it resets when the app is restarted.
/// Persist to SharedPreferences or a local DB for cross-session memory.
class SeenStoriesNotifier extends StateNotifier<Set<String>> {
  SeenStoriesNotifier() : super(const {});

  /// Marks [storyId] as seen.  No-op if already marked.
  void markSeen(String storyId) {
    if (!state.contains(storyId)) {
      state = {...state, storyId};
    }
  }

  /// Returns `true` if [storyId] has been seen this session.
  bool isSeen(String storyId) => state.contains(storyId);
}

// ─── Provider ─────────────────────────────────────────────────────────────────

/// Global provider for the set of seen story IDs.
///
/// Watch this in any widget that needs to reflect the seen/unseen state
/// of story thumbnails (e.g. [StoryThumbnailRow]).
final seenStoriesProvider =
    StateNotifierProvider<SeenStoriesNotifier, Set<String>>(
  (ref) => SeenStoriesNotifier(),
);
