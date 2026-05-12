import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../domain/entities/prescription_entry.dart';

export '../../domain/entities/prescription_entry.dart';

// ─── Notifier ─────────────────────────────────────────────────────────────────

class PrescriptionNotifier extends StateNotifier<List<PrescriptionEntry>> {
  PrescriptionNotifier() : super(const []);

  void add(PrescriptionEntry entry) => state = [...state, entry];

  void remove(String id) =>
      state = state.where((e) => e.id != id).toList();

  void markTakenToday(String id) {
    state = [
      for (final e in state)
        if (e.id == id) e.copyWith(takenToday: true) else e,
    ];
  }

  void clearTakenToday(String id) {
    state = [
      for (final e in state)
        if (e.id == id) e.copyWith(takenToday: false) else e,
    ];
  }
}

// ─── Provider ─────────────────────────────────────────────────────────────────

final prescriptionProvider =
    StateNotifierProvider<PrescriptionNotifier, List<PrescriptionEntry>>(
  (ref) => PrescriptionNotifier(),
);
