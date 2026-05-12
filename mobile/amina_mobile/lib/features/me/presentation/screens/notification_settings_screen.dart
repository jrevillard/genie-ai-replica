import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/theme/app_theme.dart';
import '../providers/notification_settings_provider.dart';

// ─── Channel presentation metadata ────────────────────────────────────────────

class _ChannelMeta {
  final String label;
  final String description;
  final IconData icon;
  final Color color;
  final Color lightBg;
  final String contactLabel;
  final String contactHint;
  final TextInputType keyboardType;

  const _ChannelMeta({
    required this.label,
    required this.description,
    required this.icon,
    required this.color,
    required this.lightBg,
    required this.contactLabel,
    required this.contactHint,
    required this.keyboardType,
  });
}

const _meta = <NotifChannel, _ChannelMeta>{
  NotifChannel.whatsapp: _ChannelMeta(
    label:       'WhatsApp',
    description: 'Receive alerts as WhatsApp messages',
    icon:        Icons.chat_rounded,
    color:       Color(0xFF25D366),
    lightBg:     Color(0xFFE8FDF2),
    contactLabel: 'phone number',
    contactHint: '+1 234 567 8900',
    keyboardType: TextInputType.phone,
  ),
  NotifChannel.telegram: _ChannelMeta(
    label:       'Telegram',
    description: 'Receive alerts via Telegram bot',
    icon:        Icons.near_me_rounded,
    color:       Color(0xFF2AABEE),
    lightBg:     Color(0xFFE8F5FF),
    contactLabel: 'username',
    contactHint: '@yourusername',
    keyboardType: TextInputType.text,
  ),
  NotifChannel.sms: _ChannelMeta(
    label:       'SMS',
    description: 'Receive text messages on your phone',
    icon:        Icons.sms_rounded,
    color:       Color(0xFF8B5CF6),
    lightBg:     Color(0xFFF5F0FF),
    contactLabel: 'phone number',
    contactHint: '+1 234 567 8900',
    keyboardType: TextInputType.phone,
  ),
  NotifChannel.email: _ChannelMeta(
    label:       'Email',
    description: 'Receive health summaries by email',
    icon:        Icons.alternate_email_rounded,
    color:       Color(0xFF3B82F6),
    lightBg:     Color(0xFFEFF6FF),
    contactLabel: 'email address',
    contactHint: 'you@example.com',
    keyboardType: TextInputType.emailAddress,
  ),
};

// ─── Screen ───────────────────────────────────────────────────────────────────

class NotificationSettingsScreen extends ConsumerWidget {
  const NotificationSettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    final s = ref.watch(notificationSettingsProvider);

    return Scaffold(
      backgroundColor: amina.scaffoldBg,
      appBar: AppBar(
        backgroundColor: cs.surface,
        elevation: 0,
        scrolledUnderElevation: 0,
        surfaceTintColor: Colors.transparent,
        leading: IconButton(
          icon: Icon(Icons.arrow_back_ios_new_rounded,
              color: cs.onSurface, size: 20),
          onPressed: () => Navigator.of(context).pop(),
        ),
        title: Text(
          "Notification Settings",
          style: TextStyle(
            fontSize: 17,
            fontWeight: FontWeight.w700,
            color: cs.onSurface,
            letterSpacing: -0.3,
          ),
        ),
        centerTitle: true,
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(0.8),
          child: Container(height: 0.8, color: amina.cardBorder),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 24, 20, 48),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // ── Banner ──────────────────────────────────────────────────────
            _BannerCard(activeCount: s.activeChannelCount),

            const SizedBox(height: 28),

            // ── Alert Channels ───────────────────────────────────────────────
            _SectionHeader(
              icon: Icons.wifi_tethering_rounded,
              title: "Alert Channels",
              subtitle: "Choose how Amina reaches you",
            ),
            const SizedBox(height: 12),
            _ChannelsCard(settings: s),

            const SizedBox(height: 28),

            // ── Health Alerts ────────────────────────────────────────────────
            _SectionHeader(
              icon: Icons.notifications_active_outlined,
              title: "Health Alerts",
              subtitle: "Pick what triggers a notification",
            ),
            const SizedBox(height: 12),
            _AlertsCard(settings: s),

            const SizedBox(height: 28),

            // ── Quiet Hours ──────────────────────────────────────────────────
            _SectionHeader(
              icon: Icons.bedtime_outlined,
              title: "Quiet Hours",
              subtitle: "Pause all alerts while you rest",
            ),
            const SizedBox(height: 12),
            _QuietHoursCard(settings: s),
          ],
        ),
      ),
    );
  }
}

// ─── Banner card ──────────────────────────────────────────────────────────────

class _BannerCard extends StatelessWidget {
  final int activeCount;
  const _BannerCard({required this.activeCount});

  @override
  Widget build(BuildContext context) {
    final hasActive = activeCount > 0;
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: hasActive
              ? [const Color(0xFF3D9970), const Color(0xFF2E7D5E)]
              : [const Color(0xFF6B7280), const Color(0xFF4B5563)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(24),
      ),
      child: Row(
        children: [
          Container(
            width: 52,
            height: 52,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.18),
              shape: BoxShape.circle,
            ),
            child: Icon(
              hasActive
                  ? Icons.notifications_active_rounded
                  : Icons.notifications_off_outlined,
              color: Colors.white,
              size: 28,
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  hasActive
                      ? "$activeCount channel${activeCount == 1 ? '' : 's'} active"
                      : "No channels active",
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                    letterSpacing: -0.3,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  hasActive
                      ? "Amina will reach you when it matters."
                      : "Enable a channel below to get alerts.",
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.8),
                    fontSize: 14,
                    height: 1.3,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Section header ───────────────────────────────────────────────────────────

class _SectionHeader extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  const _SectionHeader({
    required this.icon,
    required this.title,
    required this.subtitle,
  });

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Row(
      children: [
        Container(
          width: 36,
          height: 36,
          decoration: BoxDecoration(
            color: cs.primaryContainer,
            shape: BoxShape.circle,
          ),
          child: Icon(icon, color: cs.primary, size: 18),
        ),
        const SizedBox(width: 12),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: cs.onSurface,
                letterSpacing: -0.2,
              ),
            ),
            Text(
              subtitle,
              style: TextStyle(fontSize: 13, color: cs.onSurfaceVariant),
            ),
          ],
        ),
      ],
    );
  }
}

// ─── Channels card ────────────────────────────────────────────────────────────

class _ChannelsCard extends ConsumerWidget {
  final NotificationSettingsState settings;
  const _ChannelsCard({required this.settings});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final amina    = Theme.of(context).extension<AminaColors>()!;
    final channels = NotifChannel.values;

    return _SettingsCard(
      child: Column(
        children: [
          for (int i = 0; i < channels.length; i++) ...[
            _ChannelTile(
              channel: channels[i],
              config: settings.channels[channels[i]] ?? const ChannelConfig(),
            ),
            if (i < channels.length - 1)
              Divider(height: 1, indent: 76, endIndent: 0, color: amina.cardBorder),
          ],
        ],
      ),
    );
  }
}

class _ChannelTile extends ConsumerWidget {
  final NotifChannel channel;
  final ChannelConfig config;
  const _ChannelTile({required this.channel, required this.config});

  Future<void> _handleToggle(
    BuildContext context,
    WidgetRef ref,
    bool val,
  ) async {
    final notifier = ref.read(notificationSettingsProvider.notifier);
    if (!val) {
      notifier.setChannelEnabled(channel, enabled: false);
      return;
    }
    if (config.contact.isNotEmpty) {
      notifier.setChannelEnabled(channel, enabled: true);
      return;
    }
    final contact = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Theme.of(context).colorScheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      builder: (_) => _ContactSheet(channel: channel),
    );
    if (contact != null && contact.isNotEmpty) {
      notifier.setChannelContact(channel, contact);
      notifier.setChannelEnabled(channel, enabled: true);
    }
  }

  void _editContact(BuildContext context, WidgetRef ref) async {
    final contact = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Theme.of(context).colorScheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      builder: (_) => _ContactSheet(channel: channel, initial: config.contact),
    );
    if (contact != null && contact.isNotEmpty) {
      ref.read(notificationSettingsProvider.notifier)
          .setChannelContact(channel, contact);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    final m = _meta[channel]!;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: config.enabled ? m.lightBg : amina.inputFill,
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  m.icon,
                  color: config.enabled ? m.color : cs.onSurfaceVariant,
                  size: 22,
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      m.label,
                      style: TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w600,
                        color: cs.onSurface,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      config.enabled
                          ? (config.contact.isNotEmpty
                              ? "Connected"
                              : "Tap the switch to connect")
                          : m.description,
                      style: TextStyle(
                        fontSize: 13,
                        color: config.enabled ? cs.primary : cs.onSurfaceVariant,
                        fontWeight: config.enabled
                            ? FontWeight.w500
                            : FontWeight.normal,
                      ),
                    ),
                  ],
                ),
              ),
              SizedBox(
                width: 56,
                height: 36,
                child: FittedBox(
                  fit: BoxFit.contain,
                  child: Switch(
                    value: config.enabled,
                    onChanged: (val) => _handleToggle(context, ref, val),
                    activeThumbColor: Colors.white,
                    activeTrackColor: cs.primary,
                    inactiveThumbColor: Colors.white,
                    inactiveTrackColor: amina.cardBorder,
                  ),
                ),
              ),
            ],
          ),

          if (config.enabled && config.contact.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 10, left: 58),
              child: GestureDetector(
                onTap: () => _editContact(context, ref),
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 6,
                  ),
                  decoration: BoxDecoration(
                    color: m.lightBg,
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: m.color.withValues(alpha: 0.3)),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.edit_outlined, size: 13, color: m.color),
                      const SizedBox(width: 6),
                      Text(
                        config.contact,
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w500,
                          color: m.color,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

// ─── Health alerts card ───────────────────────────────────────────────────────

class _AlertsCard extends ConsumerWidget {
  final NotificationSettingsState settings;
  const _AlertsCard({required this.settings});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final amina = Theme.of(context).extension<AminaColors>()!;
    final n = ref.read(notificationSettingsProvider.notifier);
    return _SettingsCard(
      child: Column(
        children: [
          _AlertTile(
            icon: Icons.medication_rounded,
            iconColor: const Color(0xFF3D9970),
            iconBg: const Color(0xFFEDF7F3),
            title: "Medication Reminders",
            subtitle: "Notify me when it's time to take my medication",
            value: settings.medicationReminders,
            onChanged: (_) => n.toggleMedicationReminders(),
          ),
          Divider(height: 1, indent: 72, color: amina.cardBorder),
          _AlertTile(
            icon: Icons.calendar_today_rounded,
            iconColor: const Color(0xFF3B82F6),
            iconBg: const Color(0xFFEFF6FF),
            title: "Appointment Alerts",
            subtitle: "Remind me 24 hours before a scheduled visit",
            value: settings.appointmentAlerts,
            onChanged: (_) => n.toggleAppointmentAlerts(),
          ),
          Divider(height: 1, indent: 72, color: amina.cardBorder),
          _AlertTile(
            icon: Icons.show_chart_rounded,
            iconColor: const Color(0xFFF59E0B),
            iconBg: const Color(0xFFFEF3C7),
            title: "Glucose Reminders",
            subtitle: "Alert me when it's time to log my blood glucose",
            value: settings.glucoseReminders,
            onChanged: (_) => n.toggleGlucoseReminders(),
          ),
          Divider(height: 1, indent: 72, color: amina.cardBorder),
          _AlertTile(
            icon: Icons.bar_chart_rounded,
            iconColor: const Color(0xFF8B5CF6),
            iconBg: const Color(0xFFF5F0FF),
            title: "Weekly Health Report",
            subtitle: "Get a summary of my week every Sunday",
            value: settings.weeklyReport,
            onChanged: (_) => n.toggleWeeklyReport(),
          ),
        ],
      ),
    );
  }
}

class _AlertTile extends StatelessWidget {
  final IconData icon;
  final Color iconColor;
  final Color iconBg;
  final String title;
  final String subtitle;
  final bool value;
  final ValueChanged<bool> onChanged;

  const _AlertTile({
    required this.icon,
    required this.iconColor,
    required this.iconBg,
    required this.title,
    required this.subtitle,
    required this.value,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(color: iconBg, shape: BoxShape.circle),
            child: Icon(icon, color: iconColor, size: 20),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                    color: cs.onSurface,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  subtitle,
                  style: TextStyle(
                    fontSize: 13,
                    color: cs.onSurfaceVariant,
                    height: 1.35,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          SizedBox(
            width: 56,
            height: 36,
            child: FittedBox(
              fit: BoxFit.contain,
              child: Switch(
                value: value,
                onChanged: onChanged,
                activeThumbColor: Colors.white,
                activeTrackColor: cs.primary,
                inactiveThumbColor: Colors.white,
                inactiveTrackColor: amina.cardBorder,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Quiet hours card ─────────────────────────────────────────────────────────

class _QuietHoursCard extends ConsumerWidget {
  final NotificationSettingsState settings;
  const _QuietHoursCard({required this.settings});

  String _fmt(QuietTime t) {
    final isPm        = t.hour >= 12;
    final hourOfPeriod = t.hour % 12 == 0 ? 12 : t.hour % 12;
    final m           = t.minute.toString().padLeft(2, '0');
    return "$hourOfPeriod:$m ${isPm ? 'PM' : 'AM'}";
  }

  Future<void> _pickTime(
    BuildContext context,
    WidgetRef ref,
    QuietTime initial, {
    required bool isStart,
  }) async {
    final cs = Theme.of(context).colorScheme;
    final picked = await showTimePicker(
      context: context,
      initialTime: TimeOfDay(hour: initial.hour, minute: initial.minute),
      builder: (ctx, child) => Theme(
        data: Theme.of(ctx).copyWith(
          colorScheme: cs.copyWith(primary: cs.primary),
        ),
        child: child!,
      ),
    );
    if (picked == null) return;
    final qt = QuietTime(hour: picked.hour, minute: picked.minute);
    final n  = ref.read(notificationSettingsProvider.notifier);
    if (isStart) {
      n.setQuietStart(qt);
    } else {
      n.setQuietEnd(qt);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    final n = ref.read(notificationSettingsProvider.notifier);

    return _SettingsCard(
      child: Column(
        children: [
          // Master toggle
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
            child: Row(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: settings.quietHoursEnabled
                        ? cs.primaryContainer
                        : amina.inputFill,
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    Icons.bedtime_rounded,
                    color: settings.quietHoursEnabled
                        ? cs.primary
                        : cs.onSurfaceVariant,
                    size: 22,
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        "Enable Quiet Hours",
                        style: TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w600,
                          color: cs.onSurface,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        "Silence all alerts during your rest time",
                        style: TextStyle(fontSize: 13, color: cs.onSurfaceVariant),
                      ),
                    ],
                  ),
                ),
                SizedBox(
                  width: 56,
                  height: 36,
                  child: FittedBox(
                    fit: BoxFit.contain,
                    child: Switch(
                      value: settings.quietHoursEnabled,
                      onChanged: (_) => n.toggleQuietHours(),
                      activeThumbColor: Colors.white,
                      activeTrackColor: cs.primary,
                      inactiveThumbColor: Colors.white,
                      inactiveTrackColor: amina.cardBorder,
                    ),
                  ),
                ),
              ],
            ),
          ),

          if (settings.quietHoursEnabled) ...[
            Divider(height: 1, indent: 20, endIndent: 20, color: amina.cardBorder),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 14, 20, 16),
              child: Row(
                children: [
                  Expanded(
                    child: _TimeButton(
                      label: "From",
                      time: _fmt(settings.quietStart),
                      onTap: () => _pickTime(
                        context, ref, settings.quietStart, isStart: true),
                    ),
                  ),
                  const SizedBox(width: 14),
                  Text("→",
                      style: TextStyle(fontSize: 20, color: cs.onSurfaceVariant)),
                  const SizedBox(width: 14),
                  Expanded(
                    child: _TimeButton(
                      label: "Until",
                      time: _fmt(settings.quietEnd),
                      onTap: () => _pickTime(
                        context, ref, settings.quietEnd, isStart: false),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _TimeButton extends StatelessWidget {
  final String label;
  final String time;
  final VoidCallback onTap;
  const _TimeButton({required this.label, required this.time, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Material(
      color: cs.primaryContainer,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: cs.primary.withValues(alpha: 0.3)),
          ),
          child: Column(
            children: [
              Text(
                label,
                style: TextStyle(
                  fontSize: 12,
                  color: cs.onSurfaceVariant,
                  fontWeight: FontWeight.w500,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                time,
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                  color: cs.primary,
                  letterSpacing: -0.5,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ─── Shared settings card wrapper ─────────────────────────────────────────────

class _SettingsCard extends StatelessWidget {
  final Widget child;
  const _SettingsCard({required this.child});

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    return Container(
      decoration: BoxDecoration(
        color: cs.surface,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: amina.cardBorder),
        boxShadow: const [
          BoxShadow(
            color: Color(0x06000000),
            blurRadius: 16,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: child,
    );
  }
}

// ─── Contact entry bottom sheet ───────────────────────────────────────────────

class _ContactSheet extends StatefulWidget {
  final NotifChannel channel;
  final String initial;
  const _ContactSheet({required this.channel, this.initial = ''});

  @override
  State<_ContactSheet> createState() => _ContactSheetState();
}

class _ContactSheetState extends State<_ContactSheet> {
  late final TextEditingController _ctrl;

  @override
  void initState() {
    super.initState();
    _ctrl = TextEditingController(text: widget.initial);
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    final m = _meta[widget.channel]!;

    return Padding(
      padding: EdgeInsets.only(
        left: 24,
        right: 24,
        top: 12,
        bottom: MediaQuery.of(context).viewInsets.bottom + 32,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Drag handle
          Center(
            child: Container(
              width: 36,
              height: 4,
              margin: const EdgeInsets.only(bottom: 24),
              decoration: BoxDecoration(
                color: amina.cardBorder,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),

          // Channel icon + title
          Row(
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  color: m.lightBg,
                  shape: BoxShape.circle,
                ),
                child: Icon(m.icon, color: m.color, size: 24),
              ),
              const SizedBox(width: 14),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    "Connect ${m.label}",
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                      color: cs.onSurface,
                      letterSpacing: -0.3,
                    ),
                  ),
                  Text(
                    "Enter your ${m.contactLabel}",
                    style: TextStyle(fontSize: 14, color: cs.onSurfaceVariant),
                  ),
                ],
              ),
            ],
          ),

          const SizedBox(height: 24),

          Text(
            "Amina will send your health alerts to this ${m.contactLabel}.",
            style: TextStyle(
              fontSize: 15,
              color: cs.onSurfaceVariant,
              height: 1.45,
            ),
          ),

          const SizedBox(height: 20),

          // Contact input
          TextField(
            controller: _ctrl,
            keyboardType: m.keyboardType,
            autofocus: true,
            style: TextStyle(fontSize: 17, color: cs.onSurface),
            decoration: InputDecoration(
              hintText: m.contactHint,
              hintStyle: TextStyle(color: cs.onSurfaceVariant),
              prefixIcon: Icon(m.icon, color: m.color),
              contentPadding: const EdgeInsets.symmetric(
                  vertical: 16, horizontal: 16),
              filled: true,
              fillColor: amina.inputFill,
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(16),
                borderSide: BorderSide(color: amina.cardBorder),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(16),
                borderSide: BorderSide(color: m.color, width: 2),
              ),
            ),
          ),

          const SizedBox(height: 24),

          // Save button
          SizedBox(
            width: double.infinity,
            height: 54,
            child: ElevatedButton(
              onPressed: () =>
                  Navigator.of(context).pop(_ctrl.text.trim()),
              style: ElevatedButton.styleFrom(
                backgroundColor: m.color,
                foregroundColor: Colors.white,
                elevation: 0,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
              ),
              child: const Text(
                "Save & Enable",
                style: TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ),

          const SizedBox(height: 10),

          Center(
            child: TextButton(
              onPressed: () => Navigator.of(context).pop(null),
              child: Text(
                "Cancel",
                style: TextStyle(
                  fontSize: 16,
                  color: cs.onSurfaceVariant,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
