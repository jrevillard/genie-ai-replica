import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/providers/app_mode_provider.dart';

// ─── Medication adherence entry ───────────────────────────────────────────────

class MedAdherence {
  final String name;
  final String dosage;
  final String time;
  final bool   taken;

  const MedAdherence({
    required this.name,
    required this.dosage,
    required this.time,
    required this.taken,
  });
}

// ─── Per-day snapshot ─────────────────────────────────────────────────────────

class PatientDayData {
  final DateTime     date;
  final double?      glucose;        // mg/dL
  final String?      bloodPressure;  // "120/80"
  final String?      mood;
  final List<String> symptoms;

  const PatientDayData({
    required this.date,
    this.glucose,
    this.bloodPressure,
    this.mood,
    this.symptoms = const [],
  });

  bool get hasAlerts {
    if (symptoms.isNotEmpty) return true;
    if (glucose != null && glucose! >= 180) return true;
    if (bloodPressure != null) {
      final sys = int.tryParse(bloodPressure!.split('/').first.trim());
      if (sys != null && sys >= 130) return true;
    }
    return mood == 'Low' || mood == 'Anxious';
  }

  bool get hasData =>
      glucose != null || bloodPressure != null || mood != null;
}

// ─── Patient journal entry ────────────────────────────────────────────────────

class PatientNote {
  final String   id;
  final DateTime timestamp;
  final String   content;

  const PatientNote({
    required this.id,
    required this.timestamp,
    required this.content,
  });
}

// ─── Screen state ─────────────────────────────────────────────────────────────

class PatientHealthState {
  final String               patientName;
  final String               patientInitials;
  final DateTime             lastSync;
  final List<PatientDayData> weekData;   // 7 items, oldest → newest
  final List<PatientNote>    notes;      // newest first
  final List<MedAdherence>   meds;       // today's medication list
  final bool                 isLoading;

  const PatientHealthState({
    required this.patientName,
    required this.patientInitials,
    required this.lastSync,
    required this.weekData,
    required this.notes,
    this.meds      = const [],
    this.isLoading = false,
  });

  int get takenCount => meds.where((m) => m.taken).length;

  /// Most recent day that has at least one reading.
  PatientDayData? get latestReadings {
    for (final d in weekData.reversed) {
      if (d.hasData) return d;
    }
    return null;
  }

  bool get hasCurrentAlerts => latestReadings?.hasAlerts ?? false;

  /// Glucose values (only days that have a reading), oldest → newest.
  List<double> get glucoseSeries => weekData
      .where((d) => d.glucose != null)
      .map((d) => d.glucose!)
      .toList();

  /// Systolic BP values, oldest → newest.
  List<double> get bpSystolicSeries => weekData
      .where((d) => d.bloodPressure != null)
      .map((d) {
        final parts = d.bloodPressure!.split('/');
        return double.tryParse(parts.first.trim()) ?? 0.0;
      })
      .toList();

  PatientHealthState copyWith({
    String?               patientName,
    String?               patientInitials,
    DateTime?             lastSync,
    List<PatientDayData>? weekData,
    List<PatientNote>?    notes,
    List<MedAdherence>?   meds,
    bool?                 isLoading,
  }) =>
      PatientHealthState(
        patientName:     patientName     ?? this.patientName,
        patientInitials: patientInitials ?? this.patientInitials,
        lastSync:        lastSync        ?? this.lastSync,
        weekData:        weekData        ?? this.weekData,
        notes:           notes           ?? this.notes,
        meds:            meds            ?? this.meds,
        isLoading:       isLoading       ?? this.isLoading,
      );
}

// ─── Notifier ─────────────────────────────────────────────────────────────────

class PatientHealthNotifier extends StateNotifier<PatientHealthState> {
  PatientHealthNotifier() : super(_buildInitialState()) {
    // Simulate a live sync every 30 s (replace with real WebSocket/API stream).
    _timer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (mounted) state = state.copyWith(lastSync: DateTime.now());
    });
  }

  Timer? _timer;

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  void refresh() => state = state.copyWith(
        lastSync:  DateTime.now(),
        isLoading: false,
      );

  // ── Mock data factory ──────────────────────────────────────────────────────

  static PatientHealthState _buildInitialState() {
    final now  = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);

    final weekData = List.generate(7, (i) {
      final date = today.subtract(Duration(days: 6 - i));
      return switch (i) {
        0 => PatientDayData(
              date:          date,
              glucose:       142,
              bloodPressure: '118/76',
              mood:          'Good',
            ),
        1 => PatientDayData(
              date:          date,
              glucose:       165,
              bloodPressure: '122/80',
              mood:          'Neutral',
              symptoms:      ['Fatigue'],
            ),
        2 => PatientDayData(date: date), // no data logged this day
        3 => PatientDayData(
              date:          date,
              glucose:       188,
              bloodPressure: '134/86',
              mood:          'Low',
              symptoms:      ['Headache', 'Dizziness'],
            ),
        4 => PatientDayData(
              date:          date,
              glucose:       156,
              bloodPressure: '126/82',
              mood:          'Good',
            ),
        5 => PatientDayData(
              date:          date,
              glucose:       148,
              bloodPressure: '120/78',
              mood:          'Good',
            ),
        _ => PatientDayData(
              date:          date,
              glucose:       152,
              bloodPressure: '119/77',
              mood:          'Good',
            ),
      };
    });

    final notes = [
      PatientNote(
        id:        'n1',
        timestamp: now.subtract(const Duration(hours: 2)),
        content:   'Tomé mi medicación con el desayuno. '
                   'Me siento algo cansada pero bien en general. 💊',
      ),
      PatientNote(
        id:        'n2',
        timestamp: now.subtract(const Duration(hours: 5)),
        content:   '☀️ Buenos días! Glucosa un poco alta esta mañana — '
                   'voy a reducir el jugo de naranja.',
      ),
      PatientNote(
        id:        'n3',
        timestamp: now.subtract(const Duration(days: 1, hours: 3)),
        content:   'Dolor de cabeza leve después del almuerzo. '
                   'Me acosté un rato y mejoró bastante.',
      ),
      PatientNote(
        id:        'n4',
        timestamp: now.subtract(const Duration(days: 2, hours: 1)),
        content:   'Caminé 20 minutos esta tarde, me sentí muy bien. '
                   'La presión estuvo normal todo el día 🎉',
      ),
    ];

    return PatientHealthState(
      patientName:     'María García',
      patientInitials: 'MG',
      lastSync:        now.subtract(const Duration(minutes: 5)),
      weekData:        weekData,
      notes:           notes,
      meds: const [
        MedAdherence(name: 'Metformin',     dosage: '500 mg', time: '8:00 AM', taken: true),
        MedAdherence(name: 'Lisinopril',    dosage: '10 mg',  time: '8:00 AM', taken: true),
        MedAdherence(name: 'Aspirin',       dosage: '100 mg', time: '8:00 AM', taken: true),
        MedAdherence(name: 'Atorvastatin',  dosage: '20 mg',  time: '9:00 PM', taken: false),
      ],
    );
  }
}

// ─── Provider ─────────────────────────────────────────────────────────────────

final patientHealthProvider =
    StateNotifierProvider<PatientHealthNotifier, PatientHealthState>(
  (_) => PatientHealthNotifier(),
);

// ─── Helper: build state from a CaredPatient snapshot ────────────────────────

/// Produces a [PatientHealthState] seeded from a [CaredPatient]'s latest
/// readings, with a 7-day mock week where the last day uses the real values.
PatientHealthState stateForCaredPatient(CaredPatient patient) {
  final now   = DateTime.now();
  final today = DateTime(now.year, now.month, now.day);

  // Build 7 days; the last (today) uses the real patient snapshot.
  final weekData = List.generate(7, (i) {
    final date = today.subtract(Duration(days: 6 - i));
    if (i == 6) {
      // Real values from the patient card.
      return PatientDayData(
        date:          date,
        glucose:       patient.latestGlucose,
        bloodPressure: patient.latestBP,
        mood:          patient.latestMood,
        symptoms:      patient.latestSymptoms,
      );
    }
    // Simulate mild variation for the earlier days using a deterministic seed.
    final seed   = patient.id.hashCode + i;
    final jitter = (seed % 20) - 10; // –10 … +9
    return PatientDayData(
      date:          date,
      glucose:       patient.latestGlucose != null
          ? (patient.latestGlucose! + jitter).clamp(80, 250)
          : null,
      bloodPressure: patient.latestBP,
      mood:          patient.latestMood,
      symptoms:      i == 2 ? const [] : patient.latestSymptoms,
    );
  });

  return PatientHealthState(
    patientName:     patient.name,
    patientInitials: patient.initials,
    lastSync:        now.subtract(
        Duration(minutes: now.difference(patient.lastActivity).inMinutes % 10)),
    weekData: weekData,
    notes:    const [],
    meds: const [
      MedAdherence(name: 'Metformin',    dosage: '500 mg', time: '8:00 AM', taken: true),
      MedAdherence(name: 'Lisinopril',   dosage: '10 mg',  time: '8:00 AM', taken: true),
      MedAdherence(name: 'Atorvastatin', dosage: '20 mg',  time: '9:00 PM', taken: false),
    ],
  );
}
