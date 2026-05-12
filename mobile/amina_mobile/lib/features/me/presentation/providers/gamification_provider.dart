import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../data/models/gamification_model.dart';
import '../../domain/entities/user_game_stats.dart';

// ─── GamificationNotifier ─────────────────────────────────────────────────────

class GamificationNotifier extends StateNotifier<UserGameStats> {
  GamificationNotifier() : super(kMockUserStats);

  // ── XP ────────────────────────────────────────────────────────────────────

  void addXP(int amount) {
    final newXP = state.userXP + amount;
    state = state.copyWith(userXP: newXP);
    _checkBadgeUnlocks();
  }

  // ── Badges ────────────────────────────────────────────────────────────────

  void earnBadge(String badgeId) {
    final updated = state.badges.map((b) {
      if (b.id == badgeId && !b.isEarned) {
        return b.copyWith(earnedAt: DateTime.now());
      }
      return b;
    }).toList();

    state = state.copyWith(
      badges:                updated,
      recentlyEarnedBadgeId: badgeId,
    );

    addXP(15);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  void _checkBadgeUnlocks() {
    // e.g. if (state.userXP >= 2000) earnBadge('village_champion');
  }
}

// ─── Provider ─────────────────────────────────────────────────────────────────

final gamificationProvider =
    StateNotifierProvider<GamificationNotifier, UserGameStats>(
  (ref) => GamificationNotifier(),
);
