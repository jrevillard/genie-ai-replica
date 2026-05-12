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
