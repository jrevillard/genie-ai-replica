import 'dart:math' as math;
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../domain/entities/health_metric.dart';
import 'vitals_provider.dart';

export '../../domain/entities/health_metric.dart';

// ── State ─────────────────────────────────────────────────────────────────────

@immutable
class InsightsState {
  final HealthMetric  glucose;
  final HealthMetric  systolic;
  final HealthMetric  diastolic;
  final List<double>  moodTrend;  // numeric mood values, oldest→newest
  final String        latestMood; // label of most recent mood entry
  const InsightsState({
    required this.glucose,
    required this.systolic,
    required this.diastolic,
    this.moodTrend  = const [0, 0],
    this.latestMood = '',
  });
}

// ── Placeholder shown before any vitals are logged ───────────────────────────

const _kEmpty = InsightsState(
  glucose: HealthMetric(
    id: 'glucose', label: 'Blood Glucose', unit: 'mg/dL',
    value: 0, rangeMin: 60, rangeMax: 200, normalMax: 100, cautionMax: 140,
    weekTrend: [0], severity: InsightSeverity.good,
    tip: 'Log your vitals to see your glucose reading here.',
  ),
  systolic: HealthMetric(
    id: 'systolic', label: 'Systolic BP', unit: 'mmHg',
    value: 0, rangeMin: 80, rangeMax: 180, normalMax: 120, cautionMax: 140,
    weekTrend: [0], severity: InsightSeverity.good,
    tip: 'Log your vitals to see your blood pressure here.',
  ),
  diastolic: HealthMetric(
    id: 'diastolic', label: 'Diastolic BP', unit: 'mmHg',
    value: 0, rangeMin: 50, rangeMax: 120, normalMax: 80, cautionMax: 90,
    weekTrend: [0], severity: InsightSeverity.good,
    tip: '',
  ),
);

// ── Helpers ───────────────────────────────────────────────────────────────────

InsightSeverity _glucoseSeverity(double v) {
  if (v < 100) return InsightSeverity.good;
  if (v < 140) return InsightSeverity.caution;
  return InsightSeverity.alert;
}

String _glucoseTip(double v) {
  if (v >= 140) return 'High — avoid refined carbs and check with your doctor.';
  if (v >= 100) return 'Slightly above fasting target. Avoid refined carbs.';
  return 'Within normal range. Keep it up!';
}

InsightSeverity _systolicSeverity(double v) {
  if (v < 120) return InsightSeverity.good;
  if (v < 130) return InsightSeverity.caution;
  return InsightSeverity.alert;
}

String _systolicTip(double v) {
  if (v >= 130) return 'Elevated — rest and reduce sodium intake.';
  if (v >= 120) return 'Slightly elevated. Stay hydrated.';
  return 'Normal range. Well done!';
}

InsightSeverity _diastolicSeverity(double v) {
  if (v < 80) return InsightSeverity.good;
  if (v < 90) return InsightSeverity.caution;
  return InsightSeverity.alert;
}

double _moodValue(String mood) => switch (mood) {
  'Great'  => 5,
  'Good'   => 4,
  'Okay'   => 3,
  'Low'    => 2,
  'Unwell' => 1,
  _        => 0,
};

// ── Derived provider ──────────────────────────────────────────────────────────
//
// Each metric independently finds the most recent entry that has that field
// filled in, so logging only glucose doesn't wipe out a previously recorded
// blood pressure (and vice versa).

final healthInsightsProvider = Provider<InsightsState>((ref) {
  final allVitals = ref.watch(vitalsProvider);

  if (allVitals.isEmpty) return _kEmpty;

  // ── Per-field latest values ────────────────────────────────────────────────
  final latestGlucoseEntry = allVitals
      .where((e) => e.glucose.isNotEmpty)
      .firstOrNull;

  final latestBpEntry = allVitals
      .where((e) => e.bloodPressure.isNotEmpty)
      .firstOrNull;

  // ── Mood trend (up to 7 most recent entries with a mood) ──────────────────
  final moodEntries = allVitals
      .where((e) => e.mood.isNotEmpty)
      .take(7)
      .toList();

  List<double> moodTrend = moodEntries
      .map((e) => _moodValue(e.mood))
      .toList()
      .reversed
      .toList();
  if (moodTrend.length < 2) moodTrend = moodTrend.isEmpty ? [0, 0] : [moodTrend.first, moodTrend.first];

  final latestMood = moodEntries.isNotEmpty ? moodEntries.first.mood : '';

  // ── Sparkline trends (up to 7 most recent entries per field) ───────────────
  List<double> glucoseTrend = allVitals
      .where((e) => e.glucose.isNotEmpty)
      .take(7)
      .map((e) => double.tryParse(e.glucose) ?? 0)
      .toList()
      .reversed
      .toList();
  if (glucoseTrend.length < 2) glucoseTrend = [0, 0];

  List<double> systolicTrend = allVitals
      .where((e) => e.bloodPressure.isNotEmpty)
      .take(7)
      .map((e) => double.tryParse(
            e.bloodPressure.split('/').first.trim()) ?? 0)
      .toList()
      .reversed
      .toList();
  if (systolicTrend.length < 2) systolicTrend = [0, 0];

  // ── Glucose metric ─────────────────────────────────────────────────────────
  final glucoseVal = latestGlucoseEntry != null
      ? double.tryParse(latestGlucoseEntry.glucose)
      : null;

  final glucoseMetric = glucoseVal != null
      ? HealthMetric(
          id: 'glucose', label: 'Blood Glucose', unit: 'mg/dL',
          value:      glucoseVal,
          rangeMin:   60, rangeMax: math.max(200, glucoseVal).toDouble(),
          normalMax:  100, cautionMax: 140,
          weekTrend:  glucoseTrend,
          severity:   _glucoseSeverity(glucoseVal),
          tip:        _glucoseTip(glucoseVal),
        )
      : _kEmpty.glucose;

  // ── Blood pressure metrics ─────────────────────────────────────────────────
  final bpParts      = latestBpEntry?.bloodPressure.split('/');
  final systolicVal  = (bpParts?.length == 2)
      ? double.tryParse(bpParts![0].trim()) : null;
  final diastolicVal = (bpParts?.length == 2)
      ? double.tryParse(bpParts![1].trim()) : null;

  final systolicMetric = systolicVal != null
      ? HealthMetric(
          id: 'systolic', label: 'Systolic BP', unit: 'mmHg',
          value:      systolicVal,
          rangeMin:   80, rangeMax: 180,
          normalMax:  120, cautionMax: 140,
          weekTrend:  systolicTrend,
          severity:   _systolicSeverity(systolicVal),
          tip:        _systolicTip(systolicVal),
        )
      : _kEmpty.systolic;

  final diastolicMetric = diastolicVal != null
      ? HealthMetric(
          id: 'diastolic', label: 'Diastolic BP', unit: 'mmHg',
          value:      diastolicVal,
          rangeMin:   50, rangeMax: 120,
          normalMax:  80, cautionMax: 90,
          weekTrend:  systolicTrend,
          severity:   _diastolicSeverity(diastolicVal),
          tip:        '',
        )
      : _kEmpty.diastolic;

  return InsightsState(
    glucose:    glucoseMetric,
    systolic:   systolicMetric,
    diastolic:  diastolicMetric,
    moodTrend:  moodTrend,
    latestMood: latestMood,
  );
});
