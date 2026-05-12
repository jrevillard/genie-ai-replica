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
