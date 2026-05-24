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
import '../../domain/entities/hospital_stock.dart';

export '../../domain/entities/hospital_stock.dart';

// ─── Notifier ─────────────────────────────────────────────────────────────────

class StockNotifier extends StateNotifier<Map<String, HospitalStock>> {
  StockNotifier() : super(_buildMockSeed());

  HospitalStock stockFor(String medicationName) {
    final key = _key(medicationName);
    return state[key] ?? _hashFallback(medicationName);
  }

  Future<void> refresh() async {
    await Future<void>.delayed(const Duration(milliseconds: 900));
    final now = DateTime.now();
    state = {
      for (final e in state.entries)
        e.key: e.value.copyWith(lastSyncedAt: now),
    };
  }

  static String _key(String name) => name.toLowerCase().trim();

  static HospitalStock _hashFallback(String name) {
    const hospitals = [
      'City General Hospital',
      "St. Mary's Medical Center",
      'Riverside Health Clinic',
    ];
    final idx      = name.hashCode.abs() % 3;
    final hospital = hospitals[idx];
    final status   = StockStatus.values[idx];
    final units    = status == StockStatus.lowStock
        ? 6 + (name.length % 10)
        : null;

    return HospitalStock(
      status:         status,
      hospitalName:   hospital,
      unitsRemaining: units,
      lastSyncedAt:   DateTime.now().subtract(const Duration(hours: 3)),
    );
  }

  static Map<String, HospitalStock> _buildMockSeed() {
    final now = DateTime.now();
    return {
      'metformin': HospitalStock(
        status:       StockStatus.inStock,
        hospitalName: 'City General Hospital',
        lastSyncedAt: now.subtract(const Duration(minutes: 42)),
      ),
      'aspirin': HospitalStock(
        status:       StockStatus.inStock,
        hospitalName: 'City General Hospital',
        lastSyncedAt: now.subtract(const Duration(minutes: 55)),
      ),
      'omeprazole': HospitalStock(
        status:       StockStatus.inStock,
        hospitalName: 'Riverside Health Clinic',
        lastSyncedAt: now.subtract(const Duration(hours: 1)),
      ),
      'losartan': HospitalStock(
        status:       StockStatus.inStock,
        hospitalName: "St. Mary's Medical Center",
        lastSyncedAt: now.subtract(const Duration(hours: 2)),
      ),
      'lisinopril': HospitalStock(
        status:         StockStatus.lowStock,
        hospitalName:   "St. Mary's Medical Center",
        unitsRemaining: 12,
        lastSyncedAt:   now.subtract(const Duration(hours: 1, minutes: 15)),
      ),
      'amlodipine': HospitalStock(
        status:         StockStatus.lowStock,
        hospitalName:   'Riverside Health Clinic',
        unitsRemaining: 5,
        lastSyncedAt:   now.subtract(const Duration(hours: 3)),
      ),
      'glibenclamide': HospitalStock(
        status:         StockStatus.lowStock,
        hospitalName:   'City General Hospital',
        unitsRemaining: 8,
        lastSyncedAt:   now.subtract(const Duration(minutes: 30)),
      ),
      'atorvastatin': HospitalStock(
        status:       StockStatus.outOfStock,
        hospitalName: 'Riverside Health Clinic',
        lastSyncedAt: now.subtract(const Duration(hours: 5)),
      ),
      'simvastatin': HospitalStock(
        status:       StockStatus.outOfStock,
        hospitalName: "St. Mary's Medical Center",
        lastSyncedAt: now.subtract(const Duration(hours: 4)),
      ),
    };
  }
}

// ─── Providers ────────────────────────────────────────────────────────────────

final stockProvider =
    StateNotifierProvider<StockNotifier, Map<String, HospitalStock>>(
  (ref) => StockNotifier(),
);

final medicationStockProvider =
    Provider.family<HospitalStock, String>((ref, medicationName) {
  ref.watch(stockProvider);
  return ref.read(stockProvider.notifier).stockFor(medicationName);
});
