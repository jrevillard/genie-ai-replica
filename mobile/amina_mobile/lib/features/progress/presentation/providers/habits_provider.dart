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

// ─── State ─────────────────────────────────────────────────────────────────────

class HabitsState {
  final int waterCups;    // 0–8
  final int walkMinutes;  // 0–60
  final int sleepHours;   // 0–8

  const HabitsState({
    this.waterCups   = 4,
    this.walkMinutes = 9,
    this.sleepHours  = 6,
  });

  HabitsState copyWith({
    int? waterCups,
    int? walkMinutes,
    int? sleepHours,
  }) =>
      HabitsState(
        waterCups:   waterCups   ?? this.waterCups,
        walkMinutes: walkMinutes ?? this.walkMinutes,
        sleepHours:  sleepHours  ?? this.sleepHours,
      );
}

// ─── Notifier ──────────────────────────────────────────────────────────────────

class HabitsNotifier extends StateNotifier<HabitsState> {
  HabitsNotifier() : super(const HabitsState());

  void addWater()    => state = state.copyWith(waterCups:   (state.waterCups   + 1).clamp(0, 8));
  void removeWater() => state = state.copyWith(waterCups:   (state.waterCups   - 1).clamp(0, 8));

  void addWalk()    => state = state.copyWith(walkMinutes: (state.walkMinutes + 5).clamp(0, 60));
  void removeWalk() => state = state.copyWith(walkMinutes: (state.walkMinutes - 5).clamp(0, 60));

  void addSleep()    => state = state.copyWith(sleepHours: (state.sleepHours + 1).clamp(0, 8));
  void removeSleep() => state = state.copyWith(sleepHours: (state.sleepHours - 1).clamp(0, 8));

  void reset() => state = const HabitsState(
    waterCups: 0, walkMinutes: 0, sleepHours: 0,
  );
}

// ─── Provider ──────────────────────────────────────────────────────────────────

final habitsProvider =
    StateNotifierProvider<HabitsNotifier, HabitsState>(
  (ref) => HabitsNotifier(),
);
