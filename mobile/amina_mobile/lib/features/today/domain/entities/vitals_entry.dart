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
