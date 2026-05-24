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

import '../entities/care_plan_item.dart';
import '../entities/health_metric.dart';
import '../entities/plan_task.dart';
import '../entities/prescription_entry.dart';
import '../entities/vitals_entry.dart';

abstract class TodayRepository {
  // ── Vitals ────────────────────────────────────────────────────────────────
  Future<List<VitalsEntry>> getVitalsHistory();
  Future<void> addVitalsEntry(VitalsEntry entry);
  Future<void> removeVitalsEntry(String id);

  // ── Care plan ─────────────────────────────────────────────────────────────
  Future<List<CarePlanItem>> getCarePlanItems(CarePlanType type);

  // ── Prescriptions ─────────────────────────────────────────────────────────
  Future<List<PrescriptionEntry>> getPrescriptions();
  Future<void> addPrescription(PrescriptionEntry entry);
  Future<void> removePrescription(String id);
  Future<void> updatePrescriptionTaken(String id, {required bool taken});

  // ── Daily plan ────────────────────────────────────────────────────────────
  Future<List<PlanTask>> getPlanTasks();
  Future<void> togglePlanTask(String id);

  // ── Health metrics ────────────────────────────────────────────────────────
  Future<HealthMetric> getGlucoseMetric();
  Future<HealthMetric> getSystolicMetric();
  Future<HealthMetric> getDiastolicMetric();
}
