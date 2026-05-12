import 'dart:math' as math;
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../data/models/daily_health_record.dart';
import '../../../today/presentation/providers/vitals_provider.dart';

// ── Mock-data generator ───────────────────────────────────────────────────────
// Seeded random → deterministic, calendar looks "lived in" from first launch.

Map<String, DailyHealthRecord> _buildMockRecords() {
  final now    = DateTime.now();
  final rng    = math.Random(1337);
  final result = <String, DailyHealthRecord>{};

  for (var daysBack = 60; daysBack >= 1; daysBack--) {
    final date = DateTime(now.year, now.month, now.day - daysBack);

    // ~10 % of days are intentionally empty so the calendar looks natural.
    if (rng.nextDouble() < 0.10) continue;

    final logG = rng.nextDouble() > 0.18;
    final logB = rng.nextDouble() > 0.22;
    final logM = rng.nextDouble() > 0.15;
    final logF = rng.nextDouble() > 0.28;
    final logE = rng.nextDouble() > 0.42;

    final record = DailyHealthRecord(
      date: date,
      glucose: logG
          ? double.parse((85 + rng.nextDouble() * 65).toStringAsFixed(1))
          : null,
      bp: logB
          ? BloodPressure(
              systolic:  108 + rng.nextInt(40),
              diastolic: 68  + rng.nextInt(24),
            )
          : null,
      mood:            logM ? MoodLevel.values[rng.nextInt(5)] : null,
      foodLogged:      logF,
      exerciseMinutes: logE ? [0, 15, 30, 45, 60, 90][rng.nextInt(6)] : null,
    );

    result[record.dateKey] = record;
  }

  return result;
}

// ── State ─────────────────────────────────────────────────────────────────────

@immutable
class HealthCalendarState {
  final Map<String, DailyHealthRecord> records;
  final DateTime focusedMonth;     // always day 1 of that month
  final bool     isMonthExpanded;

  const HealthCalendarState({
    required this.records,
    required this.focusedMonth,
    this.isMonthExpanded = false,
  });

  HealthCalendarState copyWith({
    Map<String, DailyHealthRecord>? records,
    DateTime?                       focusedMonth,
    bool?                           isMonthExpanded,
  }) =>
      HealthCalendarState(
        records:         records         ?? this.records,
        focusedMonth:    focusedMonth    ?? this.focusedMonth,
        isMonthExpanded: isMonthExpanded ?? this.isMonthExpanded,
      );
}

// ── Notifier ──────────────────────────────────────────────────────────────────

class HealthCalendarNotifier extends StateNotifier<HealthCalendarState> {
  HealthCalendarNotifier()
      : super(HealthCalendarState(
          records: _buildMockRecords(),
          focusedMonth: DateTime(DateTime.now().year, DateTime.now().month),
        ));

  /// Saves (or replaces) the record for the given day; calendar re-renders.
  void logRecord(DailyHealthRecord record) {
    final updated = Map<String, DailyHealthRecord>.from(state.records)
      ..[record.dateKey] = record;
    state = state.copyWith(records: Map.unmodifiable(updated));
  }

  DailyHealthRecord? recordFor(DateTime date) =>
      state.records[DailyHealthRecord.keyFor(date)];

  void toggleExpanded() =>
      state = state.copyWith(isMonthExpanded: !state.isMonthExpanded);

  void prevMonth() {
    final m = state.focusedMonth;
    state = state.copyWith(focusedMonth: DateTime(m.year, m.month - 1));
  }

  void nextMonth() {
    final m = state.focusedMonth;
    state = state.copyWith(focusedMonth: DateTime(m.year, m.month + 1));
  }
}

// ── Provider ──────────────────────────────────────────────────────────────────

final healthCalendarProvider =
    StateNotifierProvider<HealthCalendarNotifier, HealthCalendarState>(
  (_) => HealthCalendarNotifier(),
);

// ── Vitals → DailyHealthRecord bridge ────────────────────────────────────────
//
// Converts VitalsEntry records (from Log Today) into DailyHealthRecord objects
// so the Progress tab chart reflects the same data logged in the Today tab.
// Multiple entries on the same day are merged: for each field the most recent
// non-null value wins (list is stored newest-first).

MoodLevel? _toMoodLevel(String mood) => switch (mood) {
  'Great'  => MoodLevel.excellent,
  'Good'   => MoodLevel.good,
  'Okay'   => MoodLevel.okay,
  'Low'    => MoodLevel.bad,
  'Unwell' => MoodLevel.terrible,
  _        => null,
};

final vitalsAsRecordsProvider =
    Provider<Map<String, DailyHealthRecord>>((ref) {
  final vitals = ref.watch(vitalsProvider); // newest first

  final result = <String, DailyHealthRecord>{};

  for (final entry in vitals) {
    final key = DailyHealthRecord.keyFor(entry.timestamp);
    final day = DateTime(
        entry.timestamp.year, entry.timestamp.month, entry.timestamp.day);

    final glucoseVal = double.tryParse(entry.glucose);

    final bpParts = entry.bloodPressure.split('/');
    final sys = bpParts.length == 2 ? int.tryParse(bpParts[0].trim()) : null;
    final dia = bpParts.length == 2 ? int.tryParse(bpParts[1].trim()) : null;
    final bp  = (sys != null && dia != null)
        ? BloodPressure(systolic: sys, diastolic: dia)
        : null;

    final mood = _toMoodLevel(entry.mood);

    final existing = result[key];
    result[key] = DailyHealthRecord(
      date:    day,
      // Newer entry's value takes precedence; fall back to older entry's value.
      glucose: existing?.glucose ?? glucoseVal,
      bp:      existing?.bp      ?? bp,
      mood:    existing?.mood    ?? mood,
    );
  }

  return result;
});
