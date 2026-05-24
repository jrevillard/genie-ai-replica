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
import '../../domain/entities/notification_settings.dart';

export '../../domain/entities/notification_settings.dart';

// ─── Notifier ─────────────────────────────────────────────────────────────────

class NotificationSettingsNotifier
    extends StateNotifier<NotificationSettingsState> {
  NotificationSettingsNotifier() : super(NotificationSettingsState.initial());

  // ── Channel helpers ───────────────────────────────────────────────────────

  void setChannelEnabled(NotifChannel ch, {required bool enabled}) {
    final updated = Map<NotifChannel, ChannelConfig>.from(state.channels);
    updated[ch] = (updated[ch] ?? const ChannelConfig()).copyWith(enabled: enabled);
    state = state.copyWith(channels: updated);
  }

  void setChannelContact(NotifChannel ch, String contact) {
    final updated = Map<NotifChannel, ChannelConfig>.from(state.channels);
    updated[ch] = (updated[ch] ?? const ChannelConfig()).copyWith(contact: contact);
    state = state.copyWith(channels: updated);
  }

  // ── Alert type toggles ────────────────────────────────────────────────────

  void toggleMedicationReminders() =>
      state = state.copyWith(medicationReminders: !state.medicationReminders);

  void toggleAppointmentAlerts() =>
      state = state.copyWith(appointmentAlerts: !state.appointmentAlerts);

  void toggleGlucoseReminders() =>
      state = state.copyWith(glucoseReminders: !state.glucoseReminders);

  void toggleWeeklyReport() =>
      state = state.copyWith(weeklyReport: !state.weeklyReport);

  // ── Quiet hours ───────────────────────────────────────────────────────────

  void toggleQuietHours() =>
      state = state.copyWith(quietHoursEnabled: !state.quietHoursEnabled);

  void setQuietStart(QuietTime t) => state = state.copyWith(quietStart: t);
  void setQuietEnd(QuietTime t)   => state = state.copyWith(quietEnd: t);
}

// ─── Provider ─────────────────────────────────────────────────────────────────

final notificationSettingsProvider = StateNotifierProvider<
    NotificationSettingsNotifier, NotificationSettingsState>(
  (ref) => NotificationSettingsNotifier(),
);
