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

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/theme/theme_provider.dart';
import '../../../../features/auth/presentation/providers/auth_provider.dart';
import '../../../../features/auth/presentation/screens/login_screen.dart';
import '../providers/app_settings_provider.dart';
import '../providers/notification_settings_provider.dart';
import 'caregiver_access_screen.dart'; // hidden from settings — feature lives in its own tab
import 'change_password_screen.dart';
import 'notification_settings_screen.dart';
import 'profile_details_screen.dart';

// ─── Screen ───────────────────────────────────────────────────────────────────

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cs     = Theme.of(context).colorScheme;
    final amina  = Theme.of(context).extension<AminaColors>()!;
    final settings  = ref.watch(appSettingsProvider);
    final notif     = ref.watch(notificationSettingsProvider);

    return Scaffold(
      backgroundColor: amina.scaffoldBg,
      appBar: AppBar(
        backgroundColor: cs.surface,
        elevation: 0,
        scrolledUnderElevation: 0,
        leading: IconButton(
          icon: Icon(Icons.arrow_back_ios_new_rounded,
              color: cs.onSurface, size: 20),
          onPressed: () => Navigator.of(context).pop(),
        ),
        title: Text(
          'Settings',
          style: TextStyle(
            color:      cs.onSurface,
            fontWeight: FontWeight.bold,
            fontSize:   18,
          ),
        ),
        centerTitle: true,
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(0.8),
          child: Container(height: 0.8, color: amina.cardBorder),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
        children: [

          // ── Account ──────────────────────────────────────────────────────
          _SectionHeader('Account'),
          const SizedBox(height: 10),
          _SettingsCard(children: [
            _NavTile(
              icon:      Icons.person_outline_rounded,
              iconColor: cs.primary,
              iconBg:    cs.primaryContainer,
              title:     'Profile Details',
              subtitle:  'Name, age, region, health conditions',
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                    builder: (_) => const ProfileDetailsScreen()),
              ),
            ),
            const _Divider(),
            _NavTile(
              icon:      Icons.lock_outline_rounded,
              iconColor: const Color(0xFF6366F1),
              iconBg:    const Color(0xFFEEF2FF),
              title:     'Change Password',
              subtitle:  'Update your login credentials',
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                    builder: (_) => const ChangePasswordScreen()),
              ),
            ),
            // Hidden: Caregiver Access lives in its own tab — keep code for future reuse
            // const _Divider(),
            // _NavTile(
            //   icon:      Icons.people_outline_rounded,
            //   iconColor: const Color(0xFF0EA5E9),
            //   iconBg:    const Color(0xFFE0F2FE),
            //   title:     'Caregiver Access',
            //   subtitle:  'Manage who can view your data',
            //   onTap: () => Navigator.of(context).push(
            //     MaterialPageRoute<void>(
            //         builder: (_) => const CaregiverAccessScreen()),
            //   ),
            // ),
          ]),

          const SizedBox(height: 28),

          // ── Notifications ─────────────────────────────────────────────────
          _SectionHeader('Notifications'),
          const SizedBox(height: 10),
          _SettingsCard(children: [
            _NavTile(
              icon:      Icons.notifications_rounded,
              iconColor: cs.primary,
              iconBg:    cs.primaryContainer,
              title:     'Notification Channels',
              subtitle:  notif.activeChannelCount > 0
                  ? '${notif.activeChannelCount} channel${notif.activeChannelCount == 1 ? '' : 's'} active'
                  : 'Set up alerts for your health',
              badge:     notif.activeChannelCount,
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => const NotificationSettingsScreen(),
                ),
              ),
            ),
            const _Divider(),
            _ToggleTile(
              icon:      Icons.medication_outlined,
              iconColor: const Color(0xFFF59E0B),
              iconBg:    const Color(0xFFFEF3C7),
              title:     'Medication Reminders',
              subtitle:  'Alerts when it\'s time for your meds',
              value:     notif.medicationReminders,
              onChanged: (_) => ref
                  .read(notificationSettingsProvider.notifier)
                  .toggleMedicationReminders(),
            ),
            const _Divider(),
            _ToggleTile(
              icon:      Icons.calendar_today_rounded,
              iconColor: const Color(0xFF3B82F6),
              iconBg:    const Color(0xFFEFF6FF),
              title:     'Appointment Alerts',
              subtitle:  'Reminders before each appointment',
              value:     notif.appointmentAlerts,
              onChanged: (_) => ref
                  .read(notificationSettingsProvider.notifier)
                  .toggleAppointmentAlerts(),
            ),
            const _Divider(),
            _ToggleTile(
              icon:      Icons.show_chart_rounded,
              iconColor: const Color(0xFFEC4899),
              iconBg:    const Color(0xFFFDF2F8),
              title:     'Glucose Reminders',
              subtitle:  'Prompts to log your blood sugar',
              value:     notif.glucoseReminders,
              onChanged: (_) => ref
                  .read(notificationSettingsProvider.notifier)
                  .toggleGlucoseReminders(),
            ),
            const _Divider(),
            _ToggleTile(
              icon:      Icons.bar_chart_rounded,
              iconColor: cs.onSurfaceVariant,
              iconBg:    amina.inputFill,
              title:     'Weekly Report',
              subtitle:  'Summary of your weekly health trends',
              value:     notif.weeklyReport,
              onChanged: (_) => ref
                  .read(notificationSettingsProvider.notifier)
                  .toggleWeeklyReport(),
            ),
          ]),

          const SizedBox(height: 28),

          // ── Appearance ────────────────────────────────────────────────────
          _SectionHeader('Appearance'),
          const SizedBox(height: 10),
          _SettingsCard(children: [
            _ToggleTile(
              icon:      Icons.dark_mode_rounded,
              iconColor: const Color(0xFF6366F1),
              iconBg:    const Color(0xFFEEF2FF),
              title:     'Dark Mode',
              subtitle:  'Switch to the Charcoal Premium theme',
              value:     ref.watch(themeModeProvider) == ThemeMode.dark,
              onChanged: (_) => ref.read(themeModeProvider.notifier).toggle(),
            ),
            const _Divider(),
            _SegmentTile<AppLanguage>(
              icon:      Icons.language_rounded,
              iconColor: const Color(0xFF0EA5E9),
              iconBg:    const Color(0xFFE0F2FE),
              title:     'Language',
              options:   AppLanguage.values,
              selected:  settings.language,
              labelOf:   (l) => switch (l) {
                AppLanguage.english => 'EN',
                AppLanguage.wolof   => 'WO',
                AppLanguage.french  => 'FR',
              },
              onChanged: (l) =>
                  ref.read(appSettingsProvider.notifier).setLanguage(l),
            ),
            const _Divider(),
            _SegmentTile<AppFontSize>(
              icon:      Icons.text_fields_rounded,
              iconColor: const Color(0xFFF59E0B),
              iconBg:    const Color(0xFFFEF3C7),
              title:     'Text Size',
              options:   AppFontSize.values,
              selected:  settings.fontSize,
              labelOf:   (f) => switch (f) {
                AppFontSize.small  => 'S',
                AppFontSize.normal => 'M',
                AppFontSize.large  => 'L',
              },
              onChanged: (f) =>
                  ref.read(appSettingsProvider.notifier).setFontSize(f),
            ),
          ]),

          const SizedBox(height: 28),

          // ── Privacy & Help ────────────────────────────────────────────────
          _SectionHeader('Privacy & Support'),
          const SizedBox(height: 10),
          _SettingsCard(children: [
            const _NavTile(
              icon:      Icons.shield_outlined,
              iconColor: Color(0xFF3B82F6),
              iconBg:    Color(0xFFEFF6FF),
              title:     'Privacy & Data',
              subtitle:  'Manage your health data and export',
              onTap:     _noop,
            ),
            const _Divider(),
            const _NavTile(
              icon:      Icons.help_outline_rounded,
              iconColor: Color(0xFFF59E0B),
              iconBg:    Color(0xFFFEF3C7),
              title:     'Help & Support',
              subtitle:  'FAQs and contact Amina Care',
              onTap:     _noop,
            ),
            const _Divider(),
            _NavTile(
              icon:      Icons.info_outline_rounded,
              iconColor: cs.onSurfaceVariant,
              iconBg:    amina.inputFill,
              title:     'About Amina',
              subtitle:  'Version 1.0.0',
              onTap:     () {},
            ),
          ]),

          const SizedBox(height: 28),

          // ── Sign Out ──────────────────────────────────────────────────────
          SizedBox(
            width: double.infinity,
            child: TextButton.icon(
              onPressed: () => _handleSignOut(context, ref),
              style: TextButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 18),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                  side: BorderSide(
                      color: Colors.red.shade200.withValues(alpha: 0.6)),
                ),
              ),
              icon: Icon(Icons.logout_rounded,
                  color: Colors.red.shade400, size: 20),
              label: Text(
                'Sign Out',
                style: TextStyle(
                  color:      Colors.red.shade400,
                  fontSize:   16,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ),

          const SizedBox(height: 12),

          // ── Delete Account ────────────────────────────────────────────────
          SizedBox(
            width: double.infinity,
            child: TextButton.icon(
              onPressed: () => _confirmDelete(context, ref),
              style: TextButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 18),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
              ),
              icon: const Icon(Icons.delete_forever_rounded,
                  color: Color(0xFFB91C1C), size: 20),
              label: const Text(
                'Delete Account',
                style: TextStyle(
                  color:      Color(0xFFB91C1C),
                  fontSize:   15,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
          ),

          const SizedBox(height: 48),
        ],
      ),
    );
  }

  Future<void> _handleSignOut(BuildContext context, WidgetRef ref) async {
    await ref.read(authProvider.notifier).logout();
    if (!context.mounted) return;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute<void>(builder: (_) => const LoginScreen()),
      (_) => false,
    );
  }

  void _confirmDelete(BuildContext context, WidgetRef ref) {
    showModalBottomSheet<void>(
      context:           context,
      isScrollControlled: true,
      backgroundColor:   Colors.transparent,
      builder: (_) => _DeleteAccountSheet(
        onDeleteConfirmed: () async {
          await ref.read(authProvider.notifier).logout();
          if (!context.mounted) return;
          Navigator.of(context).pushAndRemoveUntil(
            MaterialPageRoute<void>(builder: (_) => const LoginScreen()),
            (_) => false,
          );
        },
      ),
    );
  }
}

void _noop() {}

// ─── Section header ───────────────────────────────────────────────────────────

class _SectionHeader extends StatelessWidget {
  final String text;
  const _SectionHeader(this.text);

  @override
  Widget build(BuildContext context) => Text(
        text,
        style: TextStyle(
          fontSize:   13,
          fontWeight: FontWeight.w700,
          color:      Theme.of(context).colorScheme.onSurfaceVariant,
          letterSpacing: 0.8,
        ),
      );
}

// ─── Settings card ────────────────────────────────────────────────────────────

class _SettingsCard extends StatelessWidget {
  final List<Widget> children;
  const _SettingsCard({required this.children});

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    return Container(
      decoration: BoxDecoration(
        color:        cs.surface,
        borderRadius: BorderRadius.circular(24),
        border:       Border.all(color: amina.cardBorder),
        boxShadow: const [
          BoxShadow(
            color:      Color(0x06000000),
            blurRadius: 16,
            offset:     Offset(0, 4),
          ),
        ],
      ),
      child: Column(children: children),
    );
  }
}

class _Divider extends StatelessWidget {
  const _Divider();

  @override
  Widget build(BuildContext context) => Divider(
        height: 1,
        indent: 72,
        color: Theme.of(context).extension<AminaColors>()!.cardBorder,
      );
}

// ─── Nav tile (chevron) ───────────────────────────────────────────────────────

class _NavTile extends StatelessWidget {
  final IconData     icon;
  final Color        iconColor;
  final Color        iconBg;
  final String       title;
  final String       subtitle;
  final int          badge;
  final VoidCallback onTap;

  const _NavTile({
    required this.icon,
    required this.iconColor,
    required this.iconBg,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.badge = 0,
  });

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap:        onTap,
        borderRadius: BorderRadius.circular(24),
        splashColor:  iconColor.withValues(alpha: 0.06),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
          child: Row(
            children: [
              _IconBubble(icon: icon, color: iconColor, bg: iconBg),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title,
                        style: TextStyle(
                          fontSize:   17,
                          fontWeight: FontWeight.w600,
                          color:      cs.onSurface,
                        )),
                    const SizedBox(height: 2),
                    Text(subtitle,
                        style: TextStyle(
                            fontSize: 13, color: cs.onSurfaceVariant)),
                  ],
                ),
              ),
              if (badge > 0) ...[
                _BadgeChip(badge),
                const SizedBox(width: 8),
              ],
              Icon(Icons.chevron_right_rounded,
                  color: cs.onSurfaceVariant, size: 20),
            ],
          ),
        ),
      ),
    );
  }
}

// ─── Toggle tile ──────────────────────────────────────────────────────────────

class _ToggleTile extends StatelessWidget {
  final IconData             icon;
  final Color                iconColor;
  final Color                iconBg;
  final String               title;
  final String               subtitle;
  final bool                 value;
  final ValueChanged<bool>   onChanged;

  const _ToggleTile({
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
    final cs = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
      child: Row(
        children: [
          _IconBubble(icon: icon, color: iconColor, bg: iconBg),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title,
                    style: TextStyle(
                      fontSize:   17,
                      fontWeight: FontWeight.w600,
                      color:      cs.onSurface,
                    )),
                const SizedBox(height: 2),
                Text(subtitle,
                    style: TextStyle(fontSize: 13, color: cs.onSurfaceVariant)),
              ],
            ),
          ),
          Switch.adaptive(
            value:            value,
            onChanged:        onChanged,
            activeThumbColor: cs.primary,
            activeTrackColor: cs.primary.withValues(alpha: 0.35),
          ),
        ],
      ),
    );
  }
}

// ─── Segmented-choice tile ────────────────────────────────────────────────────

class _SegmentTile<T> extends StatelessWidget {
  final IconData       icon;
  final Color          iconColor;
  final Color          iconBg;
  final String         title;
  final List<T>        options;
  final T              selected;
  final String Function(T) labelOf;
  final ValueChanged<T>    onChanged;

  const _SegmentTile({
    required this.icon,
    required this.iconColor,
    required this.iconBg,
    required this.title,
    required this.options,
    required this.selected,
    required this.labelOf,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
      child: Row(
        children: [
          _IconBubble(icon: icon, color: iconColor, bg: iconBg),
          const SizedBox(width: 16),
          Expanded(
            child: Text(title,
                style: TextStyle(
                  fontSize:   17,
                  fontWeight: FontWeight.w600,
                  color:      cs.onSurface,
                )),
          ),
          Container(
            decoration: BoxDecoration(
              color:        amina.inputFill,
              borderRadius: BorderRadius.circular(12),
            ),
            padding: const EdgeInsets.all(3),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: options.map((opt) {
                final active = opt == selected;
                return GestureDetector(
                  onTap: () => onChanged(opt),
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 200),
                    padding: const EdgeInsets.symmetric(
                        horizontal: 13, vertical: 7),
                    decoration: BoxDecoration(
                      color: active ? cs.surface : Colors.transparent,
                      borderRadius: BorderRadius.circular(9),
                      boxShadow: active
                          ? const [
                              BoxShadow(
                                color:      Color(0x14000000),
                                blurRadius: 6,
                                offset:     Offset(0, 2),
                              )
                            ]
                          : null,
                    ),
                    child: Text(
                      labelOf(opt),
                      style: TextStyle(
                        fontSize:   13,
                        fontWeight: active
                            ? FontWeight.w700
                            : FontWeight.w500,
                        color: active ? cs.onSurface : cs.onSurfaceVariant,
                      ),
                    ),
                  ),
                );
              }).toList(),
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

class _IconBubble extends StatelessWidget {
  final IconData icon;
  final Color    color;
  final Color    bg;
  const _IconBubble({
    required this.icon,
    required this.color,
    required this.bg,
  });

  @override
  Widget build(BuildContext context) => Container(
        width:  44,
        height: 44,
        decoration: BoxDecoration(color: bg, shape: BoxShape.circle),
        child: Icon(icon, color: color, size: 22),
      );
}

class _BadgeChip extends StatelessWidget {
  final int count;
  const _BadgeChip(this.count);

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
        decoration: BoxDecoration(
          color:        Theme.of(context).colorScheme.primary,
          borderRadius: BorderRadius.circular(20),
        ),
        child: Text(
          '$count',
          style: const TextStyle(
            color:      Colors.white,
            fontSize:   12,
            fontWeight: FontWeight.w700,
          ),
        ),
      );
}

// ─── Delete account — 2-step bottom sheet ────────────────────────────────────

class _DeleteAccountSheet extends StatefulWidget {
  final Future<void> Function() onDeleteConfirmed;
  const _DeleteAccountSheet({required this.onDeleteConfirmed});

  @override
  State<_DeleteAccountSheet> createState() => _DeleteAccountSheetState();
}

class _DeleteAccountSheetState extends State<_DeleteAccountSheet> {
  int  _step       = 0;   // 0 = warning, 1 = type-confirm
  bool _understood = false;
  bool _deleting   = false;

  final _typeCtrl = TextEditingController();
  bool get _typeMatch =>
      _typeCtrl.text.trim().toUpperCase() == 'DELETE';

  @override
  void dispose() {
    _typeCtrl.dispose();
    super.dispose();
  }

  // ── Consequences list ──────────────────────────────────────────────────────

  static const _consequences = [
    (icon: '💊', text: 'All medications, schedules, and dose history'),
    (icon: '🩺', text: 'Every health reading — glucose, blood pressure, mood'),
    (icon: '💬', text: 'Your full conversation history with Amina'),
    (icon: '👨‍👩‍👧', text: 'All caregiver connections will be permanently severed'),
    (icon: '📊', text: 'Progress reports, trends, and health insights'),
    (icon: '🔒', text: 'Your login — you will not be able to sign back in'),
  ];

  // ── Build ──────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;

    return Container(
      decoration: BoxDecoration(
        color:        cs.surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
      ),
      padding: EdgeInsets.only(
        bottom: MediaQuery.viewInsetsOf(context).bottom + 32,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Drag handle
          const SizedBox(height: 14),
          Container(
            width: 44, height: 4,
            decoration: BoxDecoration(
              color:        amina.cardBorder,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          const SizedBox(height: 24),

          // Animated step switch
          AnimatedSwitcher(
            duration:       const Duration(milliseconds: 300),
            transitionBuilder: (child, anim) => FadeTransition(
              opacity: anim,
              child:   SlideTransition(
                position: Tween<Offset>(
                  begin: const Offset(0.04, 0),
                  end:   Offset.zero,
                ).animate(anim),
                child: child,
              ),
            ),
            child: _step == 0
                ? _WarningStep(
                    key:         const ValueKey(0),
                    cs:          cs,
                    amina:       amina,
                    understood:  _understood,
                    onToggle:    () => setState(() => _understood = !_understood),
                    onCancel:    () => Navigator.of(context).pop(),
                    onContinue:  _understood
                        ? () => setState(() => _step = 1)
                        : null,
                  )
                : _TypeConfirmStep(
                    key:        const ValueKey(1),
                    cs:         cs,
                    amina:      amina,
                    controller: _typeCtrl,
                    typeMatch:  _typeMatch,
                    deleting:   _deleting,
                    onBack:     () => setState(() { _step = 0; _typeCtrl.clear(); }),
                    onCancel:   () => Navigator.of(context).pop(),
                    onDelete:   _typeMatch && !_deleting ? _doDelete : null,
                    onChanged:  (_) => setState(() {}),
                  ),
          ),
        ],
      ),
    );
  }

  Future<void> _doDelete() async {
    setState(() => _deleting = true);
    Navigator.of(context).pop(); // close sheet first
    await widget.onDeleteConfirmed();
  }
}

// ── Step 0: Warning + consequences ────────────────────────────────────────────

class _WarningStep extends StatelessWidget {
  final ColorScheme  cs;
  final AminaColors  amina;
  final bool         understood;
  final VoidCallback onToggle;
  final VoidCallback onCancel;
  final VoidCallback? onContinue;

  const _WarningStep({
    super.key,
    required this.cs,
    required this.amina,
    required this.understood,
    required this.onToggle,
    required this.onCancel,
    required this.onContinue,
  });

  static const _kRed    = Color(0xFFB91C1C);
  static const _kRedBg  = Color(0xFFFEF2F2);
  static const _kRedSoft = Color(0xFFFECACA);

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [

            // ── Icon + title ──────────────────────────────────────────────
            Center(
              child: Container(
                width:  72,
                height: 72,
                decoration: BoxDecoration(
                  color:  _kRedBg,
                  shape:  BoxShape.circle,
                  border: Border.all(color: _kRedSoft, width: 2),
                  boxShadow: [
                    BoxShadow(
                      color:      _kRed.withValues(alpha: 0.18),
                      blurRadius: 24,
                      spreadRadius: 2,
                    ),
                  ],
                ),
                child: const Icon(Icons.delete_forever_rounded,
                    color: _kRed, size: 34),
              ),
            ),

            const SizedBox(height: 18),

            Center(
              child: Text(
                'Delete your account?',
                style: TextStyle(
                  fontSize:   22,
                  fontWeight: FontWeight.w800,
                  color:      cs.onSurface,
                  letterSpacing: -0.4,
                ),
              ),
            ),

            const SizedBox(height: 6),

            Center(
              child: Text(
                'This is permanent and cannot be undone.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 14,
                  color:    cs.onSurfaceVariant,
                  height:   1.4,
                ),
              ),
            ),

            const SizedBox(height: 24),

            // ── Consequences list ─────────────────────────────────────────
            Container(
              width:   double.infinity,
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(
                color:        _kRedBg,
                borderRadius: BorderRadius.circular(18),
                border:       Border.all(color: _kRedSoft),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Everything below will be gone forever:',
                    style: TextStyle(
                      fontSize:   12.5,
                      fontWeight: FontWeight.w700,
                      color:      _kRed,
                      letterSpacing: 0.2,
                    ),
                  ),
                  const SizedBox(height: 14),
                  ..._DeleteAccountSheetState._consequences.map((c) => Padding(
                        padding: const EdgeInsets.only(bottom: 11),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(c.icon,
                                style: const TextStyle(fontSize: 16)),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                c.text,
                                style: const TextStyle(
                                  fontSize: 13.5,
                                  color:    Color(0xFF1A1A1A),
                                  height:   1.4,
                                ),
                              ),
                            ),
                          ],
                        ),
                      )),
                ],
              ),
            ),

            const SizedBox(height: 20),

            // ── Acknowledgement checkbox ──────────────────────────────────
            GestureDetector(
              onTap:    onToggle,
              behavior: HitTestBehavior.opaque,
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  AnimatedContainer(
                    duration: const Duration(milliseconds: 180),
                    width:  24,
                    height: 24,
                    decoration: BoxDecoration(
                      color: understood
                          ? _kRed
                          : Colors.transparent,
                      borderRadius: BorderRadius.circular(7),
                      border: Border.all(
                        color: understood ? _kRed : amina.cardBorder,
                        width: 1.8,
                      ),
                    ),
                    child: understood
                        ? const Icon(Icons.check_rounded,
                            color: Colors.white, size: 15)
                        : null,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      'I understand that deleting my account is permanent '
                      'and my data cannot be recovered.',
                      style: TextStyle(
                        fontSize: 14,
                        color:    cs.onSurface,
                        height:   1.45,
                      ),
                    ),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 28),

            // ── Action buttons ────────────────────────────────────────────
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: onCancel,
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 15),
                      side:    BorderSide(color: amina.cardBorder),
                      shape:   RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14)),
                    ),
                    child: Text(
                      'Cancel',
                      style: TextStyle(
                        fontSize:   15,
                        fontWeight: FontWeight.w600,
                        color:      cs.onSurface,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: AnimatedOpacity(
                    duration: const Duration(milliseconds: 200),
                    opacity:  understood ? 1.0 : 0.35,
                    child: ElevatedButton(
                      onPressed: onContinue,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: _kRed,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 15),
                        elevation: 0,
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(14)),
                      ),
                      child: const Text(
                        'Continue →',
                        style: TextStyle(
                          fontSize:   15,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      );
}

// ── Step 1: Type "DELETE" to confirm ─────────────────────────────────────────

class _TypeConfirmStep extends StatelessWidget {
  final ColorScheme             cs;
  final AminaColors             amina;
  final TextEditingController   controller;
  final bool                    typeMatch;
  final bool                    deleting;
  final VoidCallback            onBack;
  final VoidCallback            onCancel;
  final VoidCallback?           onDelete;
  final ValueChanged<String>    onChanged;

  const _TypeConfirmStep({
    super.key,
    required this.cs,
    required this.amina,
    required this.controller,
    required this.typeMatch,
    required this.deleting,
    required this.onBack,
    required this.onCancel,
    required this.onDelete,
    required this.onChanged,
  });

  static const _kRed = Color(0xFFB91C1C);

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [

            // Back + title
            Row(
              children: [
                GestureDetector(
                  onTap: onBack,
                  child: Icon(Icons.arrow_back_ios_new_rounded,
                      color: cs.onSurface, size: 18),
                ),
                const SizedBox(width: 12),
                Text(
                  'Final confirmation',
                  style: TextStyle(
                    fontSize:   20,
                    fontWeight: FontWeight.w800,
                    color:      cs.onSurface,
                    letterSpacing: -0.3,
                  ),
                ),
              ],
            ),

            const SizedBox(height: 20),

            // Instruction
            RichText(
              text: TextSpan(
                style: TextStyle(
                  fontSize: 14.5,
                  color:    cs.onSurface,
                  height:   1.55,
                ),
                children: [
                  const TextSpan(
                      text: 'Type '),
                  TextSpan(
                    text: 'DELETE',
                    style: const TextStyle(
                      fontWeight: FontWeight.w800,
                      color:      _kRed,
                      letterSpacing: 1.2,
                    ),
                  ),
                  const TextSpan(
                      text: ' below to permanently delete your account '
                            'and all associated data.'),
                ],
              ),
            ),

            const SizedBox(height: 20),

            // Text field
            TextField(
              controller:   controller,
              onChanged:    onChanged,
              autofocus:    true,
              textCapitalization: TextCapitalization.characters,
              style: TextStyle(
                fontSize:      17,
                fontWeight:    FontWeight.w700,
                color:         typeMatch ? _kRed : cs.onSurface,
                letterSpacing: 2.0,
              ),
              decoration: InputDecoration(
                hintText:   'Type DELETE here',
                hintStyle: TextStyle(
                  color:       cs.onSurfaceVariant.withValues(alpha: 0.50),
                  fontWeight:  FontWeight.w400,
                  letterSpacing: 0,
                ),
                filled:    true,
                fillColor: typeMatch
                    ? const Color(0xFFFEF2F2)
                    : amina.inputFill,
                contentPadding: const EdgeInsets.symmetric(
                    horizontal: 16, vertical: 14),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: BorderSide(
                    color: typeMatch
                        ? _kRed.withValues(alpha: 0.55)
                        : amina.cardBorder,
                    width: 1.5,
                  ),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: BorderSide(
                    color: typeMatch
                        ? _kRed.withValues(alpha: 0.55)
                        : amina.cardBorder,
                    width: 1.5,
                  ),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: BorderSide(
                    color: typeMatch ? _kRed : cs.primary,
                    width: 2.0,
                  ),
                ),
              ),
            ),

            const SizedBox(height: 14),

            // Final warning banner
            Container(
              padding: const EdgeInsets.symmetric(
                  horizontal: 14, vertical: 11),
              decoration: BoxDecoration(
                color:        const Color(0xFFFEF2F2),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                    color: _kRed.withValues(alpha: 0.25)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.warning_amber_rounded,
                      color: _kRed, size: 18),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'This action is irreversible. Your data will be '
                      'permanently erased from our servers.',
                      style: const TextStyle(
                        fontSize: 12.5,
                        color:    Color(0xFF1A1A1A),
                        height:   1.4,
                      ),
                    ),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 24),

            // Buttons
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: onCancel,
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 15),
                      side:    BorderSide(color: amina.cardBorder),
                      shape:   RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14)),
                    ),
                    child: Text(
                      'Cancel',
                      style: TextStyle(
                        fontSize:   15,
                        fontWeight: FontWeight.w600,
                        color:      cs.onSurface,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: AnimatedOpacity(
                    duration: const Duration(milliseconds: 200),
                    opacity:  typeMatch ? 1.0 : 0.30,
                    child: ElevatedButton(
                      onPressed: onDelete,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: _kRed,
                        foregroundColor: Colors.white,
                        padding:   const EdgeInsets.symmetric(vertical: 15),
                        elevation: 0,
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(14)),
                      ),
                      child: deleting
                          ? const SizedBox(
                              width:  18,
                              height: 18,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                valueColor: AlwaysStoppedAnimation<Color>(
                                    Colors.white),
                              ),
                            )
                          : const Text(
                              'Delete Account',
                              style: TextStyle(
                                fontSize:   15,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      );
}
