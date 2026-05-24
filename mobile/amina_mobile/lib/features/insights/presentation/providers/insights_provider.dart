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

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

@immutable
class InsightsState {
  final Set<String> likedIds;
  final Set<String> savedIds;
  final String      searchQuery;

  const InsightsState({
    this.likedIds    = const {},
    this.savedIds    = const {},
    this.searchQuery = '',
  });

  bool isLiked(String id) => likedIds.contains(id);
  bool isSaved(String id) => savedIds.contains(id);

  InsightsState copyWith({
    Set<String>? likedIds,
    Set<String>? savedIds,
    String?      searchQuery,
  }) =>
      InsightsState(
        likedIds:    likedIds    ?? Set.unmodifiable(this.likedIds),
        savedIds:    savedIds    ?? Set.unmodifiable(this.savedIds),
        searchQuery: searchQuery ?? this.searchQuery,
      );
}

class InsightsNotifier extends StateNotifier<InsightsState> {
  InsightsNotifier() : super(const InsightsState());

  void toggleLike(String id) {
    final next = Set<String>.from(state.likedIds);
    if (next.contains(id)) { next.remove(id); } else { next.add(id); }
    state = state.copyWith(likedIds: Set.unmodifiable(next));
  }

  void toggleSave(String id) {
    final next = Set<String>.from(state.savedIds);
    if (next.contains(id)) { next.remove(id); } else { next.add(id); }
    state = state.copyWith(savedIds: Set.unmodifiable(next));
  }

  void setSearch(String query) =>
      state = state.copyWith(searchQuery: query.trim().toLowerCase());
}

final insightsProvider =
    StateNotifierProvider<InsightsNotifier, InsightsState>(
  (_) => InsightsNotifier(),
);
