import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../domain/entities/vitals_entry.dart';

export '../../domain/entities/vitals_entry.dart';

const _kStorageKey = 'amina_vitals_log';

// ─── Notifier ─────────────────────────────────────────────────────────────────

class VitalsNotifier extends StateNotifier<List<VitalsEntry>> {
  VitalsNotifier() : super(const []) {
    _load();
  }

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_kStorageKey);
    if (raw != null) {
      try {
        final entries = (jsonDecode(raw) as List)
            .map((e) => VitalsEntry.fromJson(e as Map<String, dynamic>))
            .toList();
        if (mounted) state = entries;
      } catch (_) {}
    }
  }

  Future<void> _save() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      _kStorageKey,
      jsonEncode(state.map((e) => e.toJson()).toList()),
    );
  }

  void add(VitalsEntry entry) {
    state = [entry, ...state];
    _save();
  }

  void remove(String id) {
    state = state.where((e) => e.id != id).toList();
    _save();
  }
}

// ─── Providers ────────────────────────────────────────────────────────────────

final vitalsProvider =
    StateNotifierProvider<VitalsNotifier, List<VitalsEntry>>(
  (ref) => VitalsNotifier(),
);

final latestVitalsProvider = Provider<VitalsEntry?>((ref) {
  final list = ref.watch(vitalsProvider);
  return list.isEmpty ? null : list.first;
});
