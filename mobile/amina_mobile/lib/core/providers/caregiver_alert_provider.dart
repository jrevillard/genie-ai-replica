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
