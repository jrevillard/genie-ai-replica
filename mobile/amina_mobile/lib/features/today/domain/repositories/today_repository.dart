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
