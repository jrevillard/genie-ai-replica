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

import 'package:flutter/material.dart';

// ─── Contribution tiers ───────────────────────────────────────────────────────

enum ContributionTier {
  seedling (label: 'Seedling',         emoji: '🌱', minXP:    0, maxXP:  499),
  neighbor (label: 'Good Neighbor',    emoji: '🤝', minXP:  500, maxXP:  999),
  pillar   (label: 'Community Pillar', emoji: '🏛️', minXP: 1000, maxXP: 1499),
  hero     (label: 'Village Hero',     emoji: '⭐', minXP: 1500, maxXP: 1999),
  champion (label: 'Village Champion', emoji: '🌟', minXP: 2000, maxXP: 99999);

  const ContributionTier({
    required this.label,
    required this.emoji,
    required this.minXP,
    required this.maxXP,
  });

  final String label;
  final String emoji;
  final int    minXP;
  final int    maxXP;

  double progressFor(int xp) {
    if (this == champion) return 1.0;
    final range  = maxXP - minXP + 1;
    final within = (xp - minXP).clamp(0, range);
    return within / range;
  }

  int xpToNext(int xp) {
    if (this == champion) return 0;
    return (maxXP + 1 - xp).clamp(0, maxXP + 1);
  }

  String get nextLabel {
    final values = ContributionTier.values;
    final idx    = values.indexOf(this);
    return idx < values.length - 1 ? values[idx + 1].label : '';
  }

  static ContributionTier forXP(int xp) {
    for (final t in ContributionTier.values.reversed) {
      if (xp >= t.minXP) return t;
    }
    return ContributionTier.seedling;
  }
}

// ─── App badge ────────────────────────────────────────────────────────────────

// Color is a Flutter primitive widely accepted in Flutter-first domain layers.
class AppBadge {
  final String    id;
  final String    name;
  final String    description;
  final String    howToEarn;
  final String    emoji;
  final Color     primaryColor;
  final Color     bgColor;
  final DateTime? earnedAt;

  const AppBadge({
    required this.id,
    required this.name,
    required this.description,
    required this.howToEarn,
    required this.emoji,
    required this.primaryColor,
    required this.bgColor,
    this.earnedAt,
  });

  bool get isEarned => earnedAt != null;

  bool get isRecentlyEarned {
    if (earnedAt == null) return false;
    return DateTime.now().difference(earnedAt!).inHours < 48;
  }

  AppBadge copyWith({DateTime? earnedAt}) => AppBadge(
        id:           id,
        name:         name,
        description:  description,
        howToEarn:    howToEarn,
        emoji:        emoji,
        primaryColor: primaryColor,
        bgColor:      bgColor,
        earnedAt:     earnedAt ?? this.earnedAt,
      );
}

// ─── Village neighbor ─────────────────────────────────────────────────────────

class VillageNeighbor {
  final String name;
  final int    xp;
  final bool   isCurrentUser;

  const VillageNeighbor({
    required this.name,
    required this.xp,
    this.isCurrentUser = false,
  });
}

// ─── User game stats ──────────────────────────────────────────────────────────

class UserGameStats {
  final String               villageName;
  final int                  totalVillageMembers;
  final int                  userXP;
  final int                  userRank;
  final List<VillageNeighbor> topNeighbors;
  final List<AppBadge>       badges;
  final String?              recentlyEarnedBadgeId;

  const UserGameStats({
    required this.villageName,
    required this.totalVillageMembers,
    required this.userXP,
    required this.userRank,
    required this.topNeighbors,
    required this.badges,
    this.recentlyEarnedBadgeId,
  });

  ContributionTier get tier => ContributionTier.forXP(userXP);

  List<AppBadge> get earnedBadges => badges.where((b) => b.isEarned).toList();
  List<AppBadge> get lockedBadges => badges.where((b) => !b.isEarned).toList();

  UserGameStats copyWith({
    int?            userXP,
    List<AppBadge>? badges,
    String?         recentlyEarnedBadgeId,
  }) =>
      UserGameStats(
        villageName:           villageName,
        totalVillageMembers:   totalVillageMembers,
        userXP:                userXP ?? this.userXP,
        userRank:              userRank,
        topNeighbors:          topNeighbors,
        badges:                badges ?? this.badges,
        recentlyEarnedBadgeId: recentlyEarnedBadgeId,
      );
}
