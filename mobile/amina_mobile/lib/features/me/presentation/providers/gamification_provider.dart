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
