import 'package:flutter_riverpod/flutter_riverpod.dart';

// ─── Alert status ──────────────────────────────────────────────────────────────

enum AlertStatus { idle, sending, sent }

// ─── Notifier ──────────────────────────────────────────────────────────────────

class CaregiverAlertNotifier extends StateNotifier<AlertStatus> {
  CaregiverAlertNotifier() : super(AlertStatus.idle);

  /// Simulates sending an immediate health alert to the caregiver.
  /// Replace the Future.delayed with a real API call in core/services/.
  Future<void> sendAlert() async {
    if (state == AlertStatus.sending) return;
    state = AlertStatus.sending;

    await Future<void>.delayed(const Duration(seconds: 2));
    if (!mounted) return;

    state = AlertStatus.sent;

    // Auto-reset so the button returns to its normal state after 3 s.
    Future<void>.delayed(const Duration(seconds: 3), () {
      if (mounted) state = AlertStatus.idle;
    });
  }
}

// ─── Provider ──────────────────────────────────────────────────────────────────

final caregiverAlertProvider =
    StateNotifierProvider<CaregiverAlertNotifier, AlertStatus>(
  (ref) => CaregiverAlertNotifier(),
);
