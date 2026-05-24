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

// ─── QuietTime ────────────────────────────────────────────────────────────────

// Flutter-free value object replacing TimeOfDay in the domain layer.
class QuietTime {
  final int hour;
  final int minute;

  const QuietTime({required this.hour, required this.minute});

  @override
  bool operator ==(Object other) =>
      other is QuietTime && hour == other.hour && minute == other.minute;

  @override
  int get hashCode => Object.hash(hour, minute);
}

// ─── Channel enum ─────────────────────────────────────────────────────────────

enum NotifChannel { whatsapp, telegram, sms, email }

// ─── Per-channel configuration ────────────────────────────────────────────────

class ChannelConfig {
  final bool   enabled;
  final String contact;

  const ChannelConfig({this.enabled = false, this.contact = ''});

  ChannelConfig copyWith({bool? enabled, String? contact}) => ChannelConfig(
        enabled: enabled ?? this.enabled,
        contact: contact ?? this.contact,
      );
}

// ─── Top-level state ──────────────────────────────────────────────────────────

class NotificationSettingsState {
  final Map<NotifChannel, ChannelConfig> channels;
  final bool      medicationReminders;
  final bool      appointmentAlerts;
  final bool      glucoseReminders;
  final bool      weeklyReport;
  final bool      quietHoursEnabled;
  final QuietTime quietStart;
  final QuietTime quietEnd;

  const NotificationSettingsState({
    required this.channels,
    this.medicationReminders = true,
    this.appointmentAlerts   = true,
    this.glucoseReminders    = false,
    this.weeklyReport        = true,
    this.quietHoursEnabled   = false,
    this.quietStart          = const QuietTime(hour: 22, minute: 0),
    this.quietEnd            = const QuietTime(hour: 7,  minute: 0),
  });

  int get activeChannelCount =>
      channels.values.where((c) => c.enabled).length;

  NotificationSettingsState copyWith({
    Map<NotifChannel, ChannelConfig>? channels,
    bool?      medicationReminders,
    bool?      appointmentAlerts,
    bool?      glucoseReminders,
    bool?      weeklyReport,
    bool?      quietHoursEnabled,
    QuietTime? quietStart,
    QuietTime? quietEnd,
  }) =>
      NotificationSettingsState(
        channels:            channels            ?? this.channels,
        medicationReminders: medicationReminders ?? this.medicationReminders,
        appointmentAlerts:   appointmentAlerts   ?? this.appointmentAlerts,
        glucoseReminders:    glucoseReminders    ?? this.glucoseReminders,
        weeklyReport:        weeklyReport        ?? this.weeklyReport,
        quietHoursEnabled:   quietHoursEnabled   ?? this.quietHoursEnabled,
        quietStart:          quietStart          ?? this.quietStart,
        quietEnd:            quietEnd            ?? this.quietEnd,
      );

  static NotificationSettingsState initial() => NotificationSettingsState(
        channels: {for (final ch in NotifChannel.values) ch: const ChannelConfig()},
      );
}
