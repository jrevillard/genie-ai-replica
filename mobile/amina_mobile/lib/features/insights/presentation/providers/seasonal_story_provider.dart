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
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../auth/presentation/providers/auth_provider.dart';
import '../../data/models/health_story.dart';
import '../../data/repositories/insights_repository_impl.dart';
import '../../domain/entities/seasonal_rhythm.dart';
import '../../domain/usecases/get_seasonal_rhythm_usecase.dart';

// ─── Season visual identity ───────────────────────────────────────────────────

class _SeasonTheme {
  final String emoji;
  final LinearGradient gradient;
  final LinearGradient thumbnailGradient;
  final Color accent;

  const _SeasonTheme({
    required this.emoji,
    required this.gradient,
    required this.thumbnailGradient,
    required this.accent,
  });
}

_SeasonTheme _themeForSeason(String seasonId) {
  switch (seasonId) {
    case 'hot_dry':
      return const _SeasonTheme(
        emoji: '☀️',
        gradient: LinearGradient(
          begin:  Alignment.topCenter,
          end:    Alignment.bottomCenter,
          colors: [Color(0xFFB45309), Color(0xFFD97706), Color(0xFFF59E0B)],
        ),
        thumbnailGradient: LinearGradient(
          begin:  Alignment.topLeft,
          end:    Alignment.bottomRight,
          colors: [Color(0xFFD97706), Color(0xFFB45309)],
        ),
        accent: Color(0xFFF59E0B),
      );
    case 'rainy':
    case 'wet':
      return const _SeasonTheme(
        emoji: '🌧️',
        gradient: LinearGradient(
          begin:  Alignment.topCenter,
          end:    Alignment.bottomCenter,
          colors: [Color(0xFF065F46), Color(0xFF047857), Color(0xFF059669)],
        ),
        thumbnailGradient: LinearGradient(
          begin:  Alignment.topLeft,
          end:    Alignment.bottomRight,
          colors: [Color(0xFF047857), Color(0xFF065F46)],
        ),
        accent: Color(0xFF10B981),
      );
    case 'cool_dry':
    default:
      return const _SeasonTheme(
        emoji: '💧',
        gradient: LinearGradient(
          begin:  Alignment.topCenter,
          end:    Alignment.bottomCenter,
          colors: [Color(0xFF0369A1), Color(0xFF0EA5E9), Color(0xFF38BDF8)],
        ),
        thumbnailGradient: LinearGradient(
          begin:  Alignment.topLeft,
          end:    Alignment.bottomRight,
          colors: [Color(0xFF0EA5E9), Color(0xFF0369A1)],
        ),
        accent: Color(0xFF0EA5E9),
      );
  }
}

// ─── Domain entity → HealthStory (presentation mapping) ──────────────────────

HealthStory _toHealthStory(SeasonalRhythm rhythm) {
  final theme = _themeForSeason(rhythm.season.id);

  // One slide per tip — alternate gradient direction so consecutive pages feel distinct.
  final slides = rhythm.allTips.indexed.map((record) {
    final (i, tip) = record;
    final gradient = i.isEven
        ? theme.gradient
        : LinearGradient(
            begin:  theme.gradient.end,
            end:    theme.gradient.begin,
            colors: theme.gradient.colors.reversed.toList(),
          );
    return StorySlide(
      iconEmoji: tip.icon.isNotEmpty ? tip.icon : theme.emoji,
      title:     '${rhythm.season.name} · ${rhythm.month}',
      body:      tip.text,
      gradient:  gradient,
    );
  }).toList();

  // Ramadan guidance — one slide per tip, only when the backend flags it active.
  if (rhythm.isRamadan) {
    for (final tip in rhythm.ramadanTips) {
      slides.add(StorySlide(
        iconEmoji: tip.icon.isNotEmpty ? tip.icon : '🌙',
        title:     'Health Tips During Ramadan',
        body:      tip.text,
        gradient: const LinearGradient(
          begin:  Alignment.topCenter,
          end:    Alignment.bottomCenter,
          colors: [Color(0xFF1E3A5F), Color(0xFF1E40AF), Color(0xFF3B82F6)],
        ),
      ));
    }
  }

  return HealthStory(
    id:                'seasonal_${rhythm.date.replaceAll(RegExp(r'[^a-zA-Z0-9]'), '_')}',
    publisher:         'Health Tip of the Day',
    publisherTag:      '${rhythm.season.name} Guidance',
    thumbnailEmoji:    theme.emoji,
    thumbnailGradient: theme.thumbnailGradient,
    accentColor:       theme.accent,
    slides:            slides,
  );
}

// ─── Providers ────────────────────────────────────────────────────────────────

final getSeasonalRhythmUsecaseProvider = Provider<GetSeasonalRhythmUsecase>(
  (ref) => GetSeasonalRhythmUsecase(ref.read(insightsRepositoryProvider)),
);

/// Fetches today's seasonal health story for the user's region.
/// Cached for the app session — the backend tip is deterministic per day.
/// Falls back gracefully: the thumbnail row shows the static tip on error.
final seasonalStoryProvider = FutureProvider<HealthStory>((ref) async {
  final region  = ref.watch(authProvider).user?.region ?? 'Kanifing';
  final usecase = ref.read(getSeasonalRhythmUsecaseProvider);
  final rhythm  = await usecase(region);
  return _toHealthStory(rhythm);
});
