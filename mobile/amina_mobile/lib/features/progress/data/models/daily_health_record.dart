import 'package:flutter/foundation.dart';

// ── Mood ──────────────────────────────────────────────────────────────────────

enum MoodLevel { terrible, bad, okay, good, excellent }

extension MoodLevelX on MoodLevel {
  String get emoji => const ['😞', '😕', '😐', '🙂', '😄'][index];
  String get label => const ['Terrible', 'Bad', 'Okay', 'Good', 'Excellent'][index];
}

// ── Blood Pressure ────────────────────────────────────────────────────────────

@immutable
class BloodPressure {
  final int systolic;
  final int diastolic;

  const BloodPressure({required this.systolic, required this.diastolic});

  bool get isNormal   => systolic < 120  && diastolic < 80;
  bool get isElevated => systolic < 130  && diastolic < 80;
  bool get isHigh     => systolic >= 130 || diastolic >= 80;
  bool get isCrisis   => systolic >= 180 || diastolic >= 120;

  String get label => '$systolic/$diastolic';

  @override
  bool operator ==(Object other) =>
      other is BloodPressure &&
      other.systolic  == systolic &&
      other.diastolic == diastolic;

  @override
  int get hashCode => Object.hash(systolic, diastolic);
}

// ── Daily Health Record ───────────────────────────────────────────────────────

@immutable
class DailyHealthRecord {
  final DateTime     date;
  final double?      glucose;          // mg/dL — null = not logged
  final BloodPressure? bp;
  final MoodLevel?   mood;
  final bool         foodLogged;
  final int?         exerciseMinutes;  // 0–120+

  const DailyHealthRecord({
    required this.date,
    this.glucose,
    this.bp,
    this.mood,
    this.foodLogged       = false,
    this.exerciseMinutes,
  });

  // ── Key ──────────────────────────────────────────────────────────────────

  String get dateKey => keyFor(date);

  static String keyFor(DateTime dt) {
    final y = dt.year;
    final m = dt.month.toString().padLeft(2, '0');
    final d = dt.day.toString().padLeft(2, '0');
    return '$y-$m-$d';
  }

  // ── Status helpers ────────────────────────────────────────────────────────

  bool get hasGlucose  => glucose != null;
  bool get hasBp       => bp != null;
  bool get hasMood     => mood != null;
  bool get hasActivity =>
      foodLogged || (exerciseMinutes != null && exerciseMinutes! > 0);
  bool get isComplete  => hasGlucose && hasBp && hasMood && hasActivity;
  int  get loggedCount =>
      (hasGlucose  ? 1 : 0) +
      (hasBp       ? 1 : 0) +
      (hasMood     ? 1 : 0) +
      (hasActivity ? 1 : 0);

  // ── Copy ─────────────────────────────────────────────────────────────────

  DailyHealthRecord copyWith({
    double?        glucose,
    BloodPressure? bp,
    MoodLevel?     mood,
    bool?          foodLogged,
    int?           exerciseMinutes,
  }) => DailyHealthRecord(
    date:            date,
    glucose:         glucose         ?? this.glucose,
    bp:              bp              ?? this.bp,
    mood:            mood            ?? this.mood,
    foodLogged:      foodLogged      ?? this.foodLogged,
    exerciseMinutes: exerciseMinutes ?? this.exerciseMinutes,
  );

  @override
  bool operator ==(Object other) =>
      other is DailyHealthRecord &&
      other.dateKey         == dateKey         &&
      other.glucose         == glucose         &&
      other.bp              == bp              &&
      other.mood            == mood            &&
      other.foodLogged      == foodLogged      &&
      other.exerciseMinutes == exerciseMinutes;

  @override
  int get hashCode => Object.hash(
      dateKey, glucose, bp, mood, foodLogged, exerciseMinutes);
}
