class VitalsEntry {
  final String id;
  final DateTime timestamp;
  final String mood;
  final String glucose;
  final String bloodPressure;
  final List<String> symptoms;
  final String notes;

  const VitalsEntry({
    required this.id,
    required this.timestamp,
    this.mood          = '',
    this.glucose       = '',
    this.bloodPressure = '',
    this.symptoms      = const [],
    this.notes         = '',
  });

  bool get hasVitals   => glucose.isNotEmpty || bloodPressure.isNotEmpty;
  bool get hasSymptoms => symptoms.isNotEmpty;
  bool get hasMood     => mood.isNotEmpty;

  String get chatSummary {
    final parts = <String>[];
    if (mood.isNotEmpty)          parts.add('Feeling: $mood');
    if (glucose.isNotEmpty)       parts.add('Glucose: $glucose mg/dL');
    if (bloodPressure.isNotEmpty) parts.add('BP: $bloodPressure');
    if (symptoms.isNotEmpty)      parts.add('Symptoms: ${symptoms.join(", ")}');
    if (notes.isNotEmpty)         parts.add('Note: $notes');
    return parts.join(' · ');
  }

  Map<String, dynamic> toJson() => {
    'id':            id,
    'timestamp':     timestamp.toIso8601String(),
    'mood':          mood,
    'glucose':       glucose,
    'bloodPressure': bloodPressure,
    'symptoms':      symptoms,
    'notes':         notes,
  };

  factory VitalsEntry.fromJson(Map<String, dynamic> j) => VitalsEntry(
    id:            j['id']            as String,
    timestamp:     DateTime.parse(j['timestamp'] as String),
    mood:          j['mood']          as String? ?? '',
    glucose:       j['glucose']       as String? ?? '',
    bloodPressure: j['bloodPressure'] as String? ?? '',
    symptoms:      (j['symptoms']     as List<dynamic>? ?? []).cast<String>(),
    notes:         j['notes']         as String? ?? '',
  );
}
