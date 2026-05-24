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

  Map<String, dynamic> toJson() => {
    'systolic':  systolic,
    'diastolic': diastolic,
  };

  factory BloodPressure.fromJson(Map<String, dynamic> j) => BloodPressure(
    systolic:  j['systolic']  as int,
    diastolic: j['diastolic'] as int,
  );

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

  Map<String, dynamic> toJson() => {
    'date':            dateKey,
    if (glucose != null)         'glucose':         glucose,
    if (bp != null)              'bp':              bp!.toJson(),
    if (mood != null)            'mood':            mood!.index,
    'foodLogged':      foodLogged,
    if (exerciseMinutes != null) 'exerciseMinutes': exerciseMinutes,
  };

  factory DailyHealthRecord.fromJson(Map<String, dynamic> j) {
    final bp  = j['bp']  != null
        ? BloodPressure.fromJson(j['bp'] as Map<String, dynamic>)
        : null;
    final mood = j['mood'] != null
        ? MoodLevel.values[j['mood'] as int]
        : null;
    return DailyHealthRecord(
      date:            DateTime.parse(j['date'] as String),
      glucose:         (j['glucose'] as num?)?.toDouble(),
      bp:              bp,
      mood:            mood,
      foodLogged:      j['foodLogged'] as bool? ?? false,
      exerciseMinutes: j['exerciseMinutes'] as int?,
    );
  }

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
