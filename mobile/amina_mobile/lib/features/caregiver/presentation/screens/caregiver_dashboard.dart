import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/providers/app_mode_provider.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../features/auth/presentation/providers/auth_provider.dart';
import '../../../../features/auth/presentation/screens/login_screen.dart';
import 'caregiver_health_view.dart';

// ─── Clinical identity colours (kept hardcoded — not theme tokens) ────────────

const _kGood    = Color(0xFF10B981); // online / healthy
const _kAlert   = Color(0xFFF59E0B); // threshold exceeded
const _kOffline = Color(0xFF4B5563); // offline indicator

// ═══════════════════════════════════════════════════════════════════════════════
// CaregiverDashboard
// ═══════════════════════════════════════════════════════════════════════════════

class CaregiverDashboard extends ConsumerWidget {
  const CaregiverDashboard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appModeProvider);
    final patients = appState.patients;
    return _buildScaffold(context, ref, patients);
  }

  Widget _buildScaffold(
      BuildContext context, WidgetRef ref, List<CaredPatient> patients) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;

    return Scaffold(
      backgroundColor: amina.scaffoldBg,
      body: CustomScrollView(
        physics: const BouncingScrollPhysics(),
        slivers: [
          // ── App bar ────────────────────────────────────────────────────────
          SliverAppBar(
            pinned:                    true,
            backgroundColor:           amina.scaffoldBg,
            elevation:                 0,
            scrolledUnderElevation:    0,
            automaticallyImplyLeading: false,
            title: Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 10, vertical: 5),
                  decoration: BoxDecoration(
                    color:        cs.primaryContainer,
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(
                        color: cs.primary.withValues(alpha: 0.35)),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text('🌿', style: TextStyle(fontSize: 13)),
                      const SizedBox(width: 5),
                      Text(
                        'Caregiver',
                        style: TextStyle(
                          color:      cs.primary,
                          fontSize:   12,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            actions: [
              IconButton(
                icon: Icon(Icons.logout_rounded,
                    color: cs.onSurfaceVariant, size: 21),
                tooltip:   'Sign out',
                onPressed: () => _confirmSignOut(context, ref),
              ),
            ],
          ),

          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(24, 12, 24, 0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Taking care of...',
                    style: TextStyle(
                      fontSize:      28,
                      fontWeight:    FontWeight.w800,
                      color:         cs.onSurface,
                      letterSpacing: -0.6,
                      fontFamily:    'Inter',
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '${patients.length} ${patients.length == 1 ? 'person' : 'people'} you\'re looking after',
                    style: TextStyle(fontSize: 14, color: cs.onSurfaceVariant),
                  ),
                  const SizedBox(height: 24),
                ],
              ),
            ),
          ),

          // ── Patient list ──────────────────────────────────────────────────
          if (patients.isEmpty)
            const SliverFillRemaining(child: _EmptyState())
          else
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(24, 0, 24, 48),
              sliver: SliverList(
                delegate: SliverChildBuilderDelegate(
                  (_, i) => Padding(
                    padding: EdgeInsets.only(
                        bottom: i < patients.length - 1 ? 14 : 0),
                    child: _PatientCard(patient: patients[i]),
                  ),
                  childCount: patients.length,
                ),
              ),
            ),
        ],
      ),
    );
  }

  Future<void> _confirmSignOut(
      BuildContext context, WidgetRef ref) async {
    final cs = Theme.of(context).colorScheme;

    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: Theme.of(ctx).colorScheme.surface,
        shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(20)),
        title: Text('Sign out?',
            style: TextStyle(
                color:      cs.onSurface,
                fontWeight: FontWeight.w700)),
        content: Text(
          'You will need to enter your linking code again to reconnect.',
          style: TextStyle(
              color: cs.onSurfaceVariant, fontSize: 14, height: 1.5),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: Text('Cancel',
                style: TextStyle(color: cs.onSurfaceVariant)),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Sign out',
                style: TextStyle(
                    color:      Color(0xFFEF4444),
                    fontWeight: FontWeight.w700)),
          ),
        ],
      ),
    );

    if (confirm != true || !context.mounted) return;

    await ref.read(authProvider.notifier).logout();
    if (!context.mounted) return;

    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const LoginScreen()),
      (_) => false,
    );
  }
}

// ─── Patient card ─────────────────────────────────────────────────────────────

class _PatientCard extends StatelessWidget {
  final CaredPatient patient;
  const _PatientCard({required this.patient});

  @override
  Widget build(BuildContext context) {
    final cs       = Theme.of(context).colorScheme;
    final amina    = Theme.of(context).extension<AminaColors>()!;
    final hasAlert = patient.hasAlerts;

    return Material(
      color:        cs.surface,
      borderRadius: BorderRadius.circular(24),
      child: InkWell(
        borderRadius: BorderRadius.circular(24),
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => CaregiverHealthView(patient: patient),
          ),
        ),
        child: Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(24),
            border: Border.all(
              color: hasAlert
                  ? _kAlert.withValues(alpha: 0.30)
                  : amina.cardBorder,
            ),
            boxShadow: [
              BoxShadow(
                color: hasAlert
                    ? _kAlert.withValues(alpha: 0.08)
                    : cs.primary.withValues(alpha: 0.06),
                blurRadius: 20,
                offset:     const Offset(0, 4),
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // ── Top row ───────────────────────────────────────────────────
              Row(
                children: [
                  // Avatar with online indicator
                  Stack(
                    children: [
                      Container(
                        width:  56,
                        height: 56,
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            colors: hasAlert
                                ? [const Color(0xFFF59E0B),
                                   const Color(0xFFB45309)]
                                : [const Color(0xFF3D9970),
                                   const Color(0xFF1E6B4A)],
                            begin: Alignment.topLeft,
                            end:   Alignment.bottomRight,
                          ),
                          shape: BoxShape.circle,
                          boxShadow: [
                            BoxShadow(
                              color: (hasAlert ? _kAlert : cs.primary)
                                  .withValues(alpha: 0.35),
                              blurRadius: 14,
                              offset:     const Offset(0, 4),
                            ),
                          ],
                        ),
                        child: Center(
                          child: Text(
                            patient.initials,
                            style: const TextStyle(
                              color:         Colors.white,
                              fontSize:      20,
                              fontWeight:    FontWeight.w800,
                              letterSpacing: 0.3,
                            ),
                          ),
                        ),
                      ),
                      // Online dot
                      Positioned(
                        bottom: 2,
                        right:  2,
                        child: Container(
                          width:  12,
                          height: 12,
                          decoration: BoxDecoration(
                            color: patient.isOnline ? _kGood : _kOffline,
                            shape: BoxShape.circle,
                            border: Border.all(color: cs.surface, width: 2),
                          ),
                        ),
                      ),
                    ],
                  ),

                  const SizedBox(width: 14),

                  // Name + relationship
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          patient.name,
                          style: TextStyle(
                            fontSize:      18,
                            fontWeight:    FontWeight.w800,
                            color:         cs.onSurface,
                            letterSpacing: -0.3,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Row(
                          children: [
                            Text(
                              patient.relationship,
                              style: TextStyle(
                                  fontSize: 12.5,
                                  color:    cs.onSurfaceVariant),
                            ),
                            Text(' · ',
                                style: TextStyle(
                                    fontSize: 12,
                                    color:    cs.onSurfaceVariant)),
                            Text(
                              patient.activityLabel,
                              style: TextStyle(
                                fontSize:   12,
                                color:      patient.isOnline
                                    ? _kGood
                                    : cs.onSurfaceVariant,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),

                  // Alert badge or chevron
                  if (hasAlert)
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 9, vertical: 4),
                      decoration: BoxDecoration(
                        color:        _kAlert.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(
                            color: _kAlert.withValues(alpha: 0.40)),
                      ),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.warning_amber_rounded,
                              color: _kAlert, size: 13),
                          SizedBox(width: 4),
                          Text(
                            'Alert',
                            style: TextStyle(
                              color:      _kAlert,
                              fontSize:   11,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ),
                    )
                  else
                    Icon(Icons.chevron_right_rounded,
                        color: cs.onSurfaceVariant, size: 24),
                ],
              ),

              // ── Divider ───────────────────────────────────────────────────
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 14),
                child: Divider(color: amina.cardBorder, thickness: 1, height: 1),
              ),

              // ── Health snapshot ───────────────────────────────────────────
              Row(
                children: [
                  if (patient.latestGlucose != null)
                    _SnapChip(
                      icon:  Icons.show_chart_rounded,
                      label: '${patient.latestGlucose!.round()} mg/dL',
                      color: patient.latestGlucose! >= 180
                          ? _kAlert : _kGood,
                    ),
                  if (patient.latestBP != null) ...[
                    const SizedBox(width: 8),
                    _SnapChip(
                      icon:  Icons.favorite_rounded,
                      label: patient.latestBP!,
                      color: () {
                        final sys = int.tryParse(
                            patient.latestBP!.split('/').first.trim()) ?? 0;
                        return sys >= 130 ? _kAlert : _kGood;
                      }(),
                    ),
                  ],
                  if (patient.latestMood != null) ...[
                    const SizedBox(width: 8),
                    _SnapChip(
                      icon:  Icons.mood_rounded,
                      label: patient.latestMood!,
                      color: (patient.latestMood == 'Low' ||
                              patient.latestMood == 'Anxious')
                          ? _kAlert : _kGood,
                    ),
                  ],
                ],
              ),

              // ── Symptoms ─────────────────────────────────────────────────
              if (patient.latestSymptoms.isNotEmpty) ...[
                const SizedBox(height: 12),
                Wrap(
                  spacing:    6,
                  runSpacing: 6,
                  children: patient.latestSymptoms.map((s) => Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 9, vertical: 4),
                    decoration: BoxDecoration(
                      color:        _kAlert.withValues(alpha: 0.10),
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(
                          color: _kAlert.withValues(alpha: 0.25)),
                    ),
                    child: Text(
                      s,
                      style: const TextStyle(
                        fontSize:   11,
                        color:      _kAlert,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  )).toList(),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

// ─── Health snapshot chip ─────────────────────────────────────────────────────

class _SnapChip extends StatelessWidget {
  final IconData icon;
  final String   label;
  final Color    color;
  const _SnapChip({
    required this.icon,
    required this.label,
    required this.color,
  });

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color:        color.withValues(alpha: 0.10),
          borderRadius: BorderRadius.circular(20),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: color, size: 11),
            const SizedBox(width: 4),
            Text(
              label,
              style: TextStyle(
                fontSize:   11,
                color:      color,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      );
}

// ─── Empty state ─────────────────────────────────────────────────────────────

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;

    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width:  80,
            height: 80,
            decoration: BoxDecoration(
              color: cs.primaryContainer,
              shape: BoxShape.circle,
            ),
            child: const Center(
              child: Text('👥', style: TextStyle(fontSize: 36)),
            ),
          ),
          const SizedBox(height: 18),
          Text(
            'Nobody here yet',
            style: TextStyle(
              fontSize:   19,
              fontWeight: FontWeight.w700,
              color:      cs.onSurface,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'The people you\'re caring for will appear here\nonce they share their linking code.',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 14,
              color:    cs.onSurfaceVariant,
              height:   1.55,
            ),
          ),
        ],
      ),
    );
  }
}
