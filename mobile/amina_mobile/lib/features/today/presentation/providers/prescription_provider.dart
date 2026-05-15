import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../domain/entities/prescription_entry.dart';
import '../../../../core/providers/current_user_provider.dart';

export '../../domain/entities/prescription_entry.dart';

String _storageKey(String userId) => 'prescriptions_$userId';

// ─── Notifier ─────────────────────────────────────────────────────────────────

class PrescriptionNotifier extends StateNotifier<List<PrescriptionEntry>> {
  PrescriptionNotifier(this._userId) : super(const []) {
    _load();
  }

  final String _userId;

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_storageKey(_userId));
    if (raw != null) {
      try {
        final entries = (jsonDecode(raw) as List)
            .map((e) => PrescriptionEntry.fromJson(e as Map<String, dynamic>))
            .toList();
        if (mounted) state = entries;
      } catch (_) {}
    }
  }

  Future<void> _save() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      _storageKey(_userId),
      jsonEncode(state.map((e) => e.toJson()).toList()),
    );
  }

  void add(PrescriptionEntry entry) {
    state = [...state, entry];
    _save();
  }

  void remove(String id) {
    state = state.where((e) => e.id != id).toList();
    _save();
  }

  void markTakenToday(String id) {
    state = [
      for (final e in state)
        if (e.id == id) e.copyWith(takenToday: true) else e,
    ];
    _save();
  }

  void clearTakenToday(String id) {
    state = [
      for (final e in state)
        if (e.id == id) e.copyWith(takenToday: false) else e,
    ];
    _save();
  }
}

// ─── Provider ─────────────────────────────────────────────────────────────────

final prescriptionProvider =
    StateNotifierProvider<PrescriptionNotifier, List<PrescriptionEntry>>(
  (ref) => PrescriptionNotifier(ref.watch(currentUserIdProvider)),
);
