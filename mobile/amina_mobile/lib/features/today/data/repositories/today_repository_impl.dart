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
import '../../domain/entities/care_plan_item.dart';
import '../../domain/entities/health_metric.dart';
import '../../domain/entities/plan_task.dart';
import '../../domain/entities/prescription_entry.dart';
import '../../domain/entities/vitals_entry.dart';
import '../../domain/repositories/today_repository.dart';

// ─── In-memory implementation ─────────────────────────────────────────────────
// Replace individual methods with real datasource calls as each backend
// endpoint becomes available.

class TodayRepositoryImpl implements TodayRepository {
  // ── Vitals ────────────────────────────────────────────────────────────────

  final List<VitalsEntry> _vitals = [];

  @override
  Future<List<VitalsEntry>> getVitalsHistory() async => List.from(_vitals);

  @override
  Future<void> addVitalsEntry(VitalsEntry entry) async =>
      _vitals.insert(0, entry);

  @override
  Future<void> removeVitalsEntry(String id) async =>
      _vitals.removeWhere((e) => e.id == id);

  // ── Care plan ─────────────────────────────────────────────────────────────

  @override
  Future<List<CarePlanItem>> getCarePlanItems(CarePlanType type) async {
    return _kMockCarePlan.where((i) => i.type == type).toList();
  }

  // ── Prescriptions ─────────────────────────────────────────────────────────

  final List<PrescriptionEntry> _prescriptions = [];

  @override
  Future<List<PrescriptionEntry>> getPrescriptions() async =>
      List.from(_prescriptions);

  @override
  Future<void> addPrescription(PrescriptionEntry entry) async =>
      _prescriptions.add(entry);

  @override
  Future<void> removePrescription(String id) async =>
      _prescriptions.removeWhere((e) => e.id == id);

  @override
  Future<void> updatePrescriptionTaken(String id, {required bool taken}) async {
    final idx = _prescriptions.indexWhere((e) => e.id == id);
    if (idx != -1) {
      _prescriptions[idx] = _prescriptions[idx].copyWith(takenToday: taken);
    }
  }

  // ── Daily plan ────────────────────────────────────────────────────────────

  final List<PlanTask> _tasks = List.from(_kMockTasks);

  @override
  Future<List<PlanTask>> getPlanTasks() async => List.from(_tasks);

  @override
  Future<void> togglePlanTask(String id) async {
    final idx = _tasks.indexWhere((t) => t.id == id);
    if (idx != -1) {
      _tasks[idx] = _tasks[idx].copyWith(completed: !_tasks[idx].completed);
    }
  }

  // ── Health metrics ────────────────────────────────────────────────────────

  @override
  Future<HealthMetric> getGlucoseMetric() async => _kGlucose;

  @override
  Future<HealthMetric> getSystolicMetric() async => _kSystolic;

  @override
  Future<HealthMetric> getDiastolicMetric() async => _kDiastolic;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

final todayRepositoryProvider = Provider<TodayRepository>(
  (_) => TodayRepositoryImpl(),
);

// ─── Mock data ────────────────────────────────────────────────────────────────

final _kMockCarePlan = [
  CarePlanItem(
    id: 'm1', type: CarePlanType.medical,
    title: 'Blood Pressure Target',
    body: 'Maintain systolic BP below 130 mmHg. Take Lisinopril 10 mg every morning with water. Avoid high-sodium foods and monitor readings twice daily.',
    source: 'Dr. James Kato', sourceRole: 'Cardiologist · City General Hospital',
    priority: CarePlanPriority.high,
    updatedAt: DateTime.utc(2025, 5, 7),
  ),
  CarePlanItem(
    id: 'm2', type: CarePlanType.medical,
    title: 'Glucose Management',
    body: 'Target fasting glucose of 80–130 mg/dL. Take Metformin 500 mg with breakfast and dinner. Log readings before each meal for the next 4 weeks.',
    source: 'Dr. Amara Diallo', sourceRole: 'Endocrinologist · Diabetes Care Center',
    priority: CarePlanPriority.high,
    updatedAt: DateTime.utc(2025, 5, 3),
  ),
  CarePlanItem(
    id: 'm3', type: CarePlanType.medical,
    title: 'Cardiac Follow-up',
    body: 'Scheduled echocardiogram on Feb 28 at 10 AM. Avoid strenuous activity 24 h before. Bring your 2-week BP log.',
    source: 'Dr. James Kato', sourceRole: 'Cardiologist · City General Hospital',
    priority: CarePlanPriority.medium,
    updatedAt: DateTime.utc(2025, 4, 30),
  ),
  CarePlanItem(
    id: 't1', type: CarePlanType.traditional,
    title: 'Morning Spiritual Practice',
    body: 'Begin each day with 15 minutes of quiet prayer or meditation before breakfast.',
    source: 'Elder Maria Santos', sourceRole: 'Community Health & Spiritual Leader',
    priority: CarePlanPriority.medium,
    updatedAt: DateTime.utc(2025, 5, 5),
  ),
  CarePlanItem(
    id: 't2', type: CarePlanType.traditional,
    title: 'Herbal Supplement Guidance',
    body: 'Ginger and turmeric tea (1 cup, twice daily) supports circulation. Confirm with Dr. Kato before starting.',
    source: 'Elder Maria Santos', sourceRole: 'Community Health & Spiritual Leader',
    priority: CarePlanPriority.medium,
    updatedAt: DateTime.utc(2025, 5, 5),
  ),
  CarePlanItem(
    id: 't3', type: CarePlanType.traditional,
    title: 'Community Circle — Thursdays',
    body: 'Weekly community health circle at 4 PM. Elder Jacob leads shared breathing exercises.',
    source: 'Elder Jacob Mwangi', sourceRole: 'Community Elder · Wellness Circle Lead',
    priority: CarePlanPriority.low,
    updatedAt: DateTime.utc(2025, 4, 28),
  ),
  CarePlanItem(
    id: 'a1', type: CarePlanType.ai,
    title: 'Sleep Pattern Alert',
    body: 'Your average sleep dropped from 7.2 h to 5.8 h over the past week. Amina suggests a consistent 10 PM bedtime for the next 7 days.',
    source: 'Amina AI', sourceRole: 'Based on 14 days of health logs',
    priority: CarePlanPriority.high,
    updatedAt: DateTime.utc(2025, 5, 10),
  ),
  CarePlanItem(
    id: 'a2', type: CarePlanType.ai,
    title: 'Post-Meal Glucose Spike',
    body: 'Your glucose rises ~42 mg/dL within 90 minutes of eating white rice. Switching to brown rice may reduce this spike by 20–30%.',
    source: 'Amina AI', sourceRole: 'Based on 23 glucose readings',
    priority: CarePlanPriority.high,
    updatedAt: DateTime.utc(2025, 5, 10),
  ),
  CarePlanItem(
    id: 'a3', type: CarePlanType.ai,
    title: 'Best Activity Window',
    body: 'Your BP and energy are most stable between 9–11 AM. A gentle 20-minute walk during this window aligns with Dr. Kato\'s guidance.',
    source: 'Amina AI', sourceRole: 'Combining medical & activity data',
    priority: CarePlanPriority.medium,
    updatedAt: DateTime.utc(2025, 5, 9),
  ),
];

const _kMockTasks = [
  PlanTask(id: 'm1', track: PlanTrack.medical,     title: 'Morning blood pressure med',    emoji: '💊', completed: true),
  PlanTask(id: 'm2', track: PlanTrack.medical,     title: 'Log glucose after lunch',       emoji: '💉', completed: false),
  PlanTask(id: 't1', track: PlanTrack.traditional, title: 'Anti-inflammatory herbal tea',  emoji: '🌿', completed: true),
  PlanTask(id: 't2', track: PlanTrack.traditional, title: '5-min mindful breathing',       emoji: '🧘', completed: false),
  PlanTask(id: 'a1', track: PlanTrack.ai,          title: 'AI-suggested 20-min walk',      emoji: '🚶', completed: true),
  PlanTask(id: 'a2', track: PlanTrack.ai,          title: 'Mediterranean lunch from plan', emoji: '🥗', completed: true),
];

const _kGlucose = HealthMetric(
  id: 'glucose', label: 'Blood Glucose', unit: 'mg/dL',
  value: 118, rangeMin: 60, rangeMax: 200, normalMax: 100, cautionMax: 140,
  weekTrend: [102, 95, 128, 110, 118, 122, 118],
  severity: InsightSeverity.caution,
  tip: 'Slightly above fasting target. Avoid refined carbs.',
);

const _kSystolic = HealthMetric(
  id: 'systolic', label: 'Systolic BP', unit: 'mmHg',
  value: 128, rangeMin: 80, rangeMax: 180, normalMax: 120, cautionMax: 140,
  weekTrend: [122, 120, 125, 128, 132, 128, 126],
  severity: InsightSeverity.caution,
  tip: 'Slightly elevated. Reduce sodium intake today.',
);

const _kDiastolic = HealthMetric(
  id: 'diastolic', label: 'Diastolic BP', unit: 'mmHg',
  value: 82, rangeMin: 50, rangeMax: 120, normalMax: 80, cautionMax: 90,
  weekTrend: [78, 76, 80, 82, 84, 82, 80],
  severity: InsightSeverity.caution,
  tip: 'Borderline. Stay hydrated and reduce stress.',
);
