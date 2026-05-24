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

enum StockStatus { inStock, lowStock, outOfStock }

class HospitalStock {
  final StockStatus status;
  final String      hospitalName;
  final int?        unitsRemaining;
  final DateTime    lastSyncedAt;

  const HospitalStock({
    required this.status,
    required this.hospitalName,
    this.unitsRemaining,
    required this.lastSyncedAt,
  });

  HospitalStock copyWith({
    StockStatus? status,
    String?      hospitalName,
    int?         unitsRemaining,
    DateTime?    lastSyncedAt,
  }) =>
      HospitalStock(
        status:         status         ?? this.status,
        hospitalName:   hospitalName   ?? this.hospitalName,
        unitsRemaining: unitsRemaining ?? this.unitsRemaining,
        lastSyncedAt:   lastSyncedAt   ?? this.lastSyncedAt,
      );

  String get statusLabel => switch (status) {
        StockStatus.inStock    => 'Available at $hospitalName',
        StockStatus.lowStock   => 'Low stock · $hospitalName',
        StockStatus.outOfStock => 'Out of stock at $hospitalName',
      };
}
