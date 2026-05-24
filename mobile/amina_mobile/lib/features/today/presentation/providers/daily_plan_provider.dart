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
import '../../domain/entities/plan_task.dart';

export '../../domain/entities/plan_task.dart';

// ── Mock data ─────────────────────────────────────────────────────────────────

const _kMock = [
  PlanTask(id: 'm1', track: PlanTrack.medical,     title: 'Morning blood pressure med',    emoji: '💊', completed: true),
  PlanTask(id: 'm2', track: PlanTrack.medical,     title: 'Log glucose after lunch',       emoji: '💉', completed: false),
  PlanTask(id: 't1', track: PlanTrack.traditional, title: 'Anti-inflammatory herbal tea',  emoji: '🌿', completed: true),
  PlanTask(id: 't2', track: PlanTrack.traditional, title: '5-min mindful breathing',       emoji: '🧘', completed: false),
  PlanTask(id: 'a1', track: PlanTrack.ai,          title: 'AI-suggested 20-min walk',      emoji: '🚶', completed: true),
  PlanTask(id: 'a2', track: PlanTrack.ai,          title: 'Mediterranean lunch from plan', emoji: '🥗', completed: true),
];

// ── State ─────────────────────────────────────────────────────────────────────

@immutable
class DailyPlanState {
  final List<PlanTask> tasks;
  const DailyPlanState({required this.tasks});

  double progressFor(PlanTrack track) {
    final list = tasks.where((t) => t.track == track).toList();
    if (list.isEmpty) return 0;
    return list.where((t) => t.completed).length / list.length;
  }

  int get doneCount  => tasks.where((t) => t.completed).length;
  int get totalCount => tasks.length;
}

// ── Notifier ──────────────────────────────────────────────────────────────────

class DailyPlanNotifier extends StateNotifier<DailyPlanState> {
  DailyPlanNotifier() : super(const DailyPlanState(tasks: _kMock));

  void toggleTask(String id) {
    final next = state.tasks
        .map((t) => t.id == id ? t.copyWith(completed: !t.completed) : t)
        .toList();
    state = DailyPlanState(tasks: next);
  }
}

// ── Provider ──────────────────────────────────────────────────────────────────

final dailyPlanProvider =
    StateNotifierProvider<DailyPlanNotifier, DailyPlanState>(
  (_) => DailyPlanNotifier(),
);
