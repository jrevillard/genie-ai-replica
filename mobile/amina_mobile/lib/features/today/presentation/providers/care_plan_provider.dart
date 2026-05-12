import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../domain/entities/care_plan_item.dart';

export '../../domain/entities/care_plan_item.dart';

// ─── State ────────────────────────────────────────────────────────────────────

class CarePlanState {
  final List<CarePlanItem> medical;
  final List<CarePlanItem> traditional;
  final List<CarePlanItem> ai;
  final CarePlanType       activeTab;

  const CarePlanState({
    this.medical     = const [],
    this.traditional = const [],
    this.ai          = const [],
    this.activeTab   = CarePlanType.medical,
  });

  CarePlanState copyWith({
    List<CarePlanItem>? medical,
    List<CarePlanItem>? traditional,
    List<CarePlanItem>? ai,
    CarePlanType?       activeTab,
  }) =>
      CarePlanState(
        medical:     medical     ?? this.medical,
        traditional: traditional ?? this.traditional,
        ai:          ai          ?? this.ai,
        activeTab:   activeTab   ?? this.activeTab,
      );

  List<CarePlanItem> get activeItems => switch (activeTab) {
        CarePlanType.medical     => medical,
        CarePlanType.traditional => traditional,
        CarePlanType.ai          => ai,
      };
}

// ─── Mock data ────────────────────────────────────────────────────────────────

final _now = DateTime.now();

final _mockMedical = [
  CarePlanItem(
    id:         'm1',
    type:       CarePlanType.medical,
    title:      'Blood Pressure Target',
    body:       'Maintain systolic BP below 130 mmHg. Take Lisinopril 10 mg every morning with water. Avoid high-sodium foods and monitor readings twice daily — morning and evening.',
    source:     'Dr. James Kato',
    sourceRole: 'Cardiologist · City General Hospital',
    priority:   CarePlanPriority.high,
    updatedAt:  _now.subtract(const Duration(days: 3)),
  ),
  CarePlanItem(
    id:         'm2',
    type:       CarePlanType.medical,
    title:      'Glucose Management',
    body:       'Target fasting glucose of 80–130 mg/dL. Take Metformin 500 mg with breakfast and dinner. Log readings before each meal for the next 4 weeks so we can adjust dosage if needed.',
    source:     'Dr. Amara Diallo',
    sourceRole: 'Endocrinologist · Diabetes Care Center',
    priority:   CarePlanPriority.high,
    updatedAt:  _now.subtract(const Duration(days: 7)),
  ),
  CarePlanItem(
    id:         'm3',
    type:       CarePlanType.medical,
    title:      'Cardiac Follow-up',
    body:       'Scheduled echocardiogram on Feb 28 at 10 AM. Avoid strenuous activity 24 h before. Bring your 2-week BP log and a list of current supplements to the appointment.',
    source:     'Dr. James Kato',
    sourceRole: 'Cardiologist · City General Hospital',
    priority:   CarePlanPriority.medium,
    updatedAt:  _now.subtract(const Duration(days: 10)),
  ),
];

final _mockTraditional = [
  CarePlanItem(
    id:         't1',
    type:       CarePlanType.traditional,
    title:      'Morning Spiritual Practice',
    body:       'Begin each day with 15 minutes of quiet prayer or meditation before breakfast. Facing east at sunrise grounds the spirit and helps lower cortisol — supporting your heart health alongside your medical plan.',
    source:     'Elder Maria Santos',
    sourceRole: 'Community Health & Spiritual Leader',
    priority:   CarePlanPriority.medium,
    updatedAt:  _now.subtract(const Duration(days: 5)),
  ),
  CarePlanItem(
    id:         't2',
    type:       CarePlanType.traditional,
    title:      'Herbal Supplement Guidance',
    body:       'Ginger and turmeric tea (1 cup, twice daily) supports circulation and reduces inflammation. Important: confirm with Dr. Kato before starting — some herbs interact with blood pressure medication.',
    source:     'Elder Maria Santos',
    sourceRole: 'Community Health & Spiritual Leader',
    priority:   CarePlanPriority.medium,
    updatedAt:  _now.subtract(const Duration(days: 5)),
  ),
  CarePlanItem(
    id:         't3',
    type:       CarePlanType.traditional,
    title:      'Community Circle — Thursdays',
    body:       'Weekly community health circle at 4 PM. Elder Jacob leads shared breathing exercises and the group meal follows WHO low-sodium guidelines. Social connection measurably reduces stress and blood pressure over time.',
    source:     'Elder Jacob Mwangi',
    sourceRole: 'Community Elder · Wellness Circle Lead',
    priority:   CarePlanPriority.low,
    updatedAt:  _now.subtract(const Duration(days: 12)),
  ),
];

final _mockAI = [
  CarePlanItem(
    id:         'a1',
    type:       CarePlanType.ai,
    title:      'Sleep Pattern Alert',
    body:       'Your average sleep dropped from 7.2 h to 5.8 h over the past week. This correlates with elevated morning glucose readings. Amina suggests a consistent 10 PM bedtime for the next 7 days to test the connection.',
    source:     'Amina AI',
    sourceRole: 'Based on 14 days of health logs',
    priority:   CarePlanPriority.high,
    updatedAt:  _now.subtract(const Duration(hours: 6)),
  ),
  CarePlanItem(
    id:         'a2',
    type:       CarePlanType.ai,
    title:      'Post-Meal Glucose Spike',
    body:       'Your glucose rises ~42 mg/dL within 90 minutes of eating white rice or bread. Switching to brown rice or adding a 10-minute walk after meals may reduce this spike by 20–30%, consistent with Dr. Diallo\'s glucose target.',
    source:     'Amina AI',
    sourceRole: 'Based on 23 glucose readings',
    priority:   CarePlanPriority.high,
    updatedAt:  _now.subtract(const Duration(hours: 2)),
  ),
  CarePlanItem(
    id:         'a3',
    type:       CarePlanType.ai,
    title:      'Best Activity Window',
    body:       'Your BP and energy are most stable between 9–11 AM. A gentle 20-minute walk during this window aligns with Dr. Kato\'s exercise guidance and fits naturally after Elder Maria\'s morning practice.',
    source:     'Amina AI',
    sourceRole: 'Combining medical & activity data',
    priority:   CarePlanPriority.medium,
    updatedAt:  _now.subtract(const Duration(days: 1)),
  ),
];

// ─── Notifier ─────────────────────────────────────────────────────────────────

class CarePlanNotifier extends StateNotifier<CarePlanState> {
  CarePlanNotifier()
      : super(CarePlanState(
          medical:     _mockMedical,
          traditional: _mockTraditional,
          ai:          _mockAI,
        ));

  void selectTab(CarePlanType tab) {
    if (state.activeTab == tab) return;
    state = state.copyWith(activeTab: tab);
  }
}

// ─── Provider ─────────────────────────────────────────────────────────────────

final carePlanProvider =
    StateNotifierProvider<CarePlanNotifier, CarePlanState>(
  (ref) => CarePlanNotifier(),
);
