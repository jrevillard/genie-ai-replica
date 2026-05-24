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
import '../../domain/entities/user_game_stats.dart';

export '../../domain/entities/user_game_stats.dart';

// ─── Mock data ────────────────────────────────────────────────────────────────

final _now = DateTime.now();

final kAllBadges = <AppBadge>[
  // ── Earned ──────────────────────────────────────────────────────────────────
  AppBadge(
    id:           'health_pioneer',
    name:         'Health Pioneer',
    description:  'Completed your first full week with Amina Care.',
    howToEarn:    'Use Amina Care for 7 consecutive days.',
    emoji:        '🏥',
    primaryColor: const Color(0xFF3D9970),
    bgColor:      const Color(0xFFEDF7F3),
    earnedAt:     _now.subtract(const Duration(days: 7)),
  ),
  AppBadge(
    id:           'health_reporter',
    name:         'Health Reporter',
    description:  'Logged your vitals 10 times — your data tells your story.',
    howToEarn:    'Log your vitals 10 times total.',
    emoji:        '📊',
    primaryColor: const Color(0xFF3B82F6),
    bgColor:      const Color(0xFFEFF6FF),
    earnedAt:     _now.subtract(const Duration(days: 5)),
  ),
  AppBadge(
    id:           'aminas_friend',
    name:         "Amina's Friend",
    description:  'Had 5 conversations with Amina — she values your trust.',
    howToEarn:    'Chat with Amina at least 5 times.',
    emoji:        '💬',
    primaryColor: const Color(0xFF7C3AED),
    bgColor:      const Color(0xFFF5F3FF),
    earnedAt:     _now.subtract(const Duration(days: 4)),
  ),
  AppBadge(
    id:           'seven_day_streak',
    name:         '7-Day Streak',
    description:  'Logged your health data 7 days in a row. Incredible!',
    howToEarn:    'Log your vitals for 7 consecutive days.',
    emoji:        '🔥',
    primaryColor: const Color(0xFFEA580C),
    bgColor:      const Color(0xFFFFF7ED),
    earnedAt:     _now.subtract(const Duration(days: 2)),
  ),
  AppBadge(
    id:           'hydration_master',
    name:         'Water Streak',
    description:  'Met your daily water goal 5 days in a row. Keep it up!',
    howToEarn:    'Complete the water habit goal for 5 consecutive days.',
    emoji:        '💧',
    primaryColor: const Color(0xFF0EA5E9),
    bgColor:      const Color(0xFFE0F2FE),
    earnedAt:     _now.subtract(const Duration(hours: 26)),
  ),
  AppBadge(
    id:           'village_star',
    name:         'Village Star',
    description:  'You reached the Top 5 of your village. Your community sees you! 🌟',
    howToEarn:    'Reach the Top 5 in your village leaderboard.',
    emoji:        '🌟',
    primaryColor: const Color(0xFFD97706),
    bgColor:      const Color(0xFFFEF3C7),
    earnedAt:     _now.subtract(const Duration(hours: 3)),
  ),

  // ── Locked ───────────────────────────────────────────────────────────────────
  AppBadge(
    id:           'heart_guardian',
    name:         'Heart Guardian',
    description:  'Kept your blood pressure in the normal range for 7 days.',
    howToEarn:    'Log a normal BP reading every day for 7 days.',
    emoji:        '❤️',
    primaryColor: const Color(0xFFE11D48),
    bgColor:      const Color(0xFFFFF1F2),
  ),
  AppBadge(
    id:           'active_soul',
    name:         'Active Soul',
    description:  'Completed your daily walk goal 5 days in a row.',
    howToEarn:    'Complete the walk habit for 5 consecutive days.',
    emoji:        '🏃',
    primaryColor: const Color(0xFF059669),
    bgColor:      const Color(0xFFECFDF5),
  ),
  AppBadge(
    id:           'mindful_warrior',
    name:         'Mindful Warrior',
    description:  'Logged your mood every day for a full week.',
    howToEarn:    'Log your mood for 7 consecutive days.',
    emoji:        '🧘',
    primaryColor: const Color(0xFF4F46E5),
    bgColor:      const Color(0xFFEEF2FF),
  ),
  AppBadge(
    id:           'goal_crusher',
    name:         'Goal Crusher',
    description:  'Completed every single habit in one day. Legendary!',
    howToEarn:    'Complete all 4 daily habits in a single day.',
    emoji:        '🎯',
    primaryColor: const Color(0xFFDB2777),
    bgColor:      const Color(0xFFFDF2F8),
  ),
];

final kMockUserStats = UserGameStats(
  villageName:           'Bogotá Village',
  totalVillageMembers:   127,
  userXP:                1850,
  userRank:              3,
  recentlyEarnedBadgeId: 'village_star',
  badges:                kAllBadges,
  topNeighbors: const [
    VillageNeighbor(name: 'Ana M.',    xp: 2340),
    VillageNeighbor(name: 'Carlos R.', xp: 2100),
    VillageNeighbor(name: 'You',       xp: 1850, isCurrentUser: true),
    VillageNeighbor(name: 'María S.',  xp: 1720),
    VillageNeighbor(name: 'José L.',   xp: 1680),
  ],
);
