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
