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
