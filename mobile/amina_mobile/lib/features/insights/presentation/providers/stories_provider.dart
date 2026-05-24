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
