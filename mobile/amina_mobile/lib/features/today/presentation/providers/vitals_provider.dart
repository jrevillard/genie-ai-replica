import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../domain/entities/vitals_entry.dart';
import '../../../../core/providers/current_user_provider.dart';

export '../../domain/entities/vitals_entry.dart';

String _storageKey(String userId) => 'vitals_$userId';

// ─── Notifier ─────────────────────────────────────────────────────────────────

class VitalsNotifier extends StateNotifier<List<VitalsEntry>> {
  VitalsNotifier(this._userId) : super(const []) {
    _load();
  }

  final String _userId;

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_storageKey(_userId));
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
      _storageKey(_userId),
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
  (ref) => VitalsNotifier(ref.watch(currentUserIdProvider)),
);

final latestVitalsProvider = Provider<VitalsEntry?>((ref) {
  final list = ref.watch(vitalsProvider);
  return list.isEmpty ? null : list.first;
});
