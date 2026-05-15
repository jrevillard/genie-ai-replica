class PrescriptionEntry {
  final String   id;
  final String   medicationName;
  final String   dosage;
  final String   frequency;
  final String   duration;
  final String   notes;
  final DateTime dateAdded;
  final bool     fromScan;
  final bool     takenToday;

  const PrescriptionEntry({
    required this.id,
    required this.medicationName,
    required this.dosage,
    required this.frequency,
    required this.duration,
    required this.notes,
    required this.dateAdded,
    this.fromScan   = false,
    this.takenToday = false,
  });

  PrescriptionEntry copyWith({
    String?   id,
    String?   medicationName,
    String?   dosage,
    String?   frequency,
    String?   duration,
    String?   notes,
    DateTime? dateAdded,
    bool?     fromScan,
    bool?     takenToday,
  }) =>
      PrescriptionEntry(
        id:             id             ?? this.id,
        medicationName: medicationName ?? this.medicationName,
        dosage:         dosage         ?? this.dosage,
        frequency:      frequency      ?? this.frequency,
        duration:       duration       ?? this.duration,
        notes:          notes          ?? this.notes,
        dateAdded:      dateAdded      ?? this.dateAdded,
        fromScan:       fromScan       ?? this.fromScan,
        takenToday:     takenToday     ?? this.takenToday,
      );

  String get chatSummary => '$medicationName $dosage — $frequency for $duration';

  Map<String, dynamic> toJson() => {
    'id':             id,
    'medicationName': medicationName,
    'dosage':         dosage,
    'frequency':      frequency,
    'duration':       duration,
    'notes':          notes,
    'dateAdded':      dateAdded.toIso8601String(),
    'fromScan':       fromScan,
  };

  factory PrescriptionEntry.fromJson(Map<String, dynamic> j) => PrescriptionEntry(
    id:             j['id']             as String,
    medicationName: j['medicationName'] as String,
    dosage:         j['dosage']         as String,
    frequency:      j['frequency']      as String,
    duration:       j['duration']       as String,
    notes:          j['notes']          as String? ?? '',
    dateAdded:      DateTime.parse(j['dateAdded'] as String),
    fromScan:       j['fromScan']       as bool? ?? false,
  );
}
