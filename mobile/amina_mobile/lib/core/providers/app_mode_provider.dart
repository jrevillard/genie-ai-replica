import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../features/auth/data/datasources/auth_local_datasource.dart';

// ─── App mode ─────────────────────────────────────────────────────────────────

/// Patient = full app (today hub, chat, progress, etc.)
/// CaregiverOnly = dashboard of patients + health views; no personal health UI.
enum AppMode { patient, caregiverOnly }

// ─── Patient being cared for ──────────────────────────────────────────────────

class CaredPatient {
  final String       id;
  final String       name;
  final String       initials;
  final String       relationship;
  final DateTime     lastActivity;
  final bool         isOnline;

  /// Latest health snapshot shown on the dashboard card and health view.
  final double?      latestGlucose;
  final String?      latestBP;
  final String?      latestMood;
  final List<String> latestSymptoms;

  const CaredPatient({
    required this.id,
    required this.name,
    required this.initials,
    required this.relationship,
    required this.lastActivity,
    required this.isOnline,
    this.latestGlucose,
    this.latestBP,
    this.latestMood,
    this.latestSymptoms = const [],
  });

  String get activityLabel {
    final diff = DateTime.now().difference(lastActivity);
    if (diff.inSeconds < 60)  return 'Active now';
    if (diff.inMinutes < 60)  return '${diff.inMinutes}m ago';
    if (diff.inHours   < 24)  return '${diff.inHours}h ago';
    if (diff.inDays    == 1)  return 'Yesterday';
    return '${diff.inDays}d ago';
  }

  bool get hasAlerts {
    if (latestSymptoms.isNotEmpty) return true;
    if (latestGlucose != null && latestGlucose! >= 180) return true;
    if (latestBP != null) {
      final sys = int.tryParse(latestBP!.split('/').first.trim());
      if (sys != null && sys >= 130) return true;
    }
    return latestMood == 'Low' || latestMood == 'Anxious';
  }
}

// ─── State ────────────────────────────────────────────────────────────────────

class AppModeState {
  final AppMode           mode;
  final List<CaredPatient> patients;
  final bool              isInitializing;

  const AppModeState({
    this.mode          = AppMode.patient,
    this.patients      = const [],
    this.isInitializing = true,
  });

  AppModeState copyWith({
    AppMode?            mode,
    List<CaredPatient>? patients,
    bool?               isInitializing,
  }) =>
      AppModeState(
        mode:           mode           ?? this.mode,
        patients:       patients       ?? this.patients,
        isInitializing: isInitializing ?? this.isInitializing,
      );
}

// ─── Notifier ─────────────────────────────────────────────────────────────────

class AppModeNotifier extends StateNotifier<AppModeState> {
  AppModeNotifier(this._session) : super(const AppModeState()) {
    _init();
  }

  final AuthLocalDatasource _session;

  Future<void> _init() async {
    final modeStr = await _session.loadAppMode();
    if (!mounted) return;
    if (modeStr == 'caregiverOnly') {
      state = AppModeState(
        mode:           AppMode.caregiverOnly,
        patients:       _buildMockPatients(),
        isInitializing: false,
      );
    } else {
      state = state.copyWith(isInitializing: false);
    }
  }

  // ── Caregiver linking ──────────────────────────────────────────────────────

  /// Simulates connecting with a patient code.
  /// Returns null on success, or an error string on failure.
  Future<String?> linkWithCode(String code) async {
    await Future<void>.delayed(const Duration(seconds: 2)); // mock API call
    if (code == '123456') {
      final patients = [_buildMockPatients().first]; // first patient from code
      await _session.saveAppMode('caregiverOnly');
      await _session.saveSession(); // mark as logged-in
      if (!mounted) return null;
      state = AppModeState(
        mode:           AppMode.caregiverOnly,
        patients:       patients,
        isInitializing: false,
      );
      return null;
    }
    return 'Code not found. Please check and try again.';
  }

  // ── Switch back to patient mode ────────────────────────────────────────────

  Future<void> switchToPatientMode() async {
    await _session.saveAppMode('patient');
    if (!mounted) return;
    state = const AppModeState(isInitializing: false);
  }

  // ── Mock data ──────────────────────────────────────────────────────────────

  static List<CaredPatient> _buildMockPatients() {
    final now = DateTime.now();
    return [
      CaredPatient(
        id:             'cp_maria',
        name:           'María García',
        initials:       'MG',
        relationship:   'Mother',
        lastActivity:   now.subtract(const Duration(hours: 2)),
        isOnline:       true,
        latestGlucose:  152,
        latestBP:       '119/77',
        latestMood:     'Good',
        latestSymptoms: const [],
      ),
      CaredPatient(
        id:             'cp_carlos',
        name:           'Carlos García',
        initials:       'CG',
        relationship:   'Father',
        lastActivity:   now.subtract(const Duration(hours: 6)),
        isOnline:       false,
        latestGlucose:  174,
        latestBP:       '132/85',
        latestMood:     'Neutral',
        latestSymptoms: const ['Fatigue'],
      ),
    ];
  }
}

// ─── Provider ─────────────────────────────────────────────────────────────────

final appModeProvider =
    StateNotifierProvider<AppModeNotifier, AppModeState>(
  (ref) => AppModeNotifier(ref.read(authLocalDatasourceProvider)),
);
