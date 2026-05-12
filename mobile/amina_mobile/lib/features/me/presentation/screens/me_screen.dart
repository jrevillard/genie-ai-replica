import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/theme/app_theme.dart';
import 'settings_screen.dart';
import '../../../today/presentation/providers/prescription_provider.dart';
import '../../../today/presentation/providers/vitals_provider.dart';
import '../../../today/presentation/widgets/health_metric_card.dart';
import '../../../today/presentation/widgets/log_vitals_sheet.dart';
import '../../../today/presentation/widgets/rx_entry_sheet.dart';
import '../providers/stock_provider.dart';
import '../widgets/appointment_card.dart';
import '../widgets/medication_detail_sheet.dart';
import '../widgets/medication_list_card.dart';
import '../widgets/profile_avatar_card.dart';

// ─── Screen ───────────────────────────────────────────────────────────────────

class MeScreen extends ConsumerWidget {
  const MeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final medications  = ref.watch(prescriptionProvider);
    final latest       = ref.watch(latestVitalsProvider);
    final allVitals    = ref.watch(vitalsProvider);
    final latestGlucose  = allVitals.where((e) => e.glucose.isNotEmpty).firstOrNull;
    final latestBp       = allVitals.where((e) => e.bloodPressure.isNotEmpty).firstOrNull;
    final latestMood     = allVitals.where((e) => e.mood.isNotEmpty).firstOrNull;
    final latestSymptoms = allVitals.where((e) => e.symptoms.isNotEmpty).firstOrNull;
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;

    return Scaffold(
      backgroundColor: amina.scaffoldBg,
      appBar: AppBar(
        backgroundColor:        cs.surface,
        elevation:              0,
        scrolledUnderElevation: 0,
        surfaceTintColor:       Colors.transparent,
        centerTitle:            true,
        leading: Padding(
          padding: const EdgeInsets.all(10),
          child: GestureDetector(
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const SettingsScreen()),
            ),
            child: Container(
              decoration: BoxDecoration(
                color: amina.inputFill,
                shape: BoxShape.circle,
              ),
              child: Icon(
                Icons.settings_outlined,
                color: cs.onSurfaceVariant,
                size:  20,
              ),
            ),
          ),
        ),
        title: Text(
          'My Profile',
          style: TextStyle(
            color:         cs.onSurface,
            fontWeight:    FontWeight.w700,
            fontSize:      17,
            letterSpacing: -0.3,
          ),
        ),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(0.8),
          child: Container(height: 0.8, color: amina.cardBorder),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 20),

            const ProfileAvatarCard(),

            const SizedBox(height: 30),

            _HealthSnapshotSection(
              latest:          latest,
              latestGlucose:   latestGlucose,
              latestBp:        latestBp,
              latestMood:      latestMood,
              latestSymptoms:  latestSymptoms,
              onTap: () => showLogVitalsSheet(context),
            ),

            const SizedBox(height: 30),

            _MedicationsSection(
              medications: medications,
              onAdd:    () => showRxEntrySheet(context, medicationOnly: true),
              onTapMed: (entry) => showMedicationDetailSheet(context, entry),
            ),

            const SizedBox(height: 30),

            _SectionLabel("My Appointments"),
            const SizedBox(height: 12),
            const AppointmentCard(
              hospital:  "City General Hospital",
              time:      "Feb 24, 10:00 AM",
              specialty: "Cardiology",
            ),
            const AppointmentCard(
              hospital:  "Diabetes Care Center",
              time:      "Feb 28, 2:00 PM",
              specialty: "Endocrinology",
            ),

            const SizedBox(height: 48),
          ],
        ),
      ),
    );
  }
}

// ─── Health Snapshot section ──────────────────────────────────────────────────

class _HealthSnapshotSection extends StatelessWidget {
  final VitalsEntry? latest;
  final VitalsEntry? latestGlucose;
  final VitalsEntry? latestBp;
  final VitalsEntry? latestMood;
  final VitalsEntry? latestSymptoms;
  final VoidCallback onTap;

  const _HealthSnapshotSection({
    required this.latest,
    required this.latestGlucose,
    required this.latestBp,
    required this.latestMood,
    required this.latestSymptoms,
    required this.onTap,
  });

  static bool _isBpElevated(String bp) {
    if (bp.isEmpty) return false;
    final systolic = int.tryParse(bp.split('/').first.trim());
    return systolic != null && systolic >= 130;
  }

  static bool _isGlucoseHigh(String g) {
    final val = int.tryParse(g.trim());
    return val != null && val >= 180;
  }

  static String _timeAgo(DateTime dt) {
    final diff = DateTime.now().difference(dt);
    if (diff.inMinutes < 1)  return 'Just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours   < 24) return '${diff.inHours}h ago';
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return '${months[dt.month - 1]} ${dt.day}';
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;

    final glucose  = latestGlucose?.glucose       ?? '';
    final bp       = latestBp?.bloodPressure      ?? '';
    final mood     = latestMood?.mood             ?? '';
    final symptoms = latestSymptoms?.symptoms     ?? const [];

    final bpAlert      = _isBpElevated(bp);
    final glucoseAlert = _isGlucoseHigh(glucose);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            const _SectionLabel("My Health Snapshot"),
            const Spacer(),
            if (latest != null)
              Text(
                'Updated ${_timeAgo(latest!.timestamp)}',
                style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant),
              ),
          ],
        ),
        const SizedBox(height: 4),
        Text(
          latest == null
              ? 'Log your first check-in to see your readings here.'
              : 'Tap any card to update your readings.',
          style: TextStyle(
            fontSize: 13,
            color:    cs.onSurfaceVariant,
            height:   1.4,
          ),
        ),

        const SizedBox(height: 14),

        if (latest == null)
          _SnapshotEmptyState(onTap: onTap)
        else
          GridView.count(
            shrinkWrap:       true,
            physics:          const NeverScrollableScrollPhysics(),
            crossAxisCount:   2,
            crossAxisSpacing: 12,
            mainAxisSpacing:  12,
            childAspectRatio: 1.15,
            children: [
              HealthMetricCard(
                icon:       Icons.show_chart_rounded,
                label:      'Blood Glucose',
                value:      glucose.isNotEmpty ? '$glucose mg/dL' : '— mg/dL',
                statusText: glucose.isEmpty
                    ? 'Not logged today'
                    : glucoseAlert
                        ? 'High — check in'
                        : 'Within range',
                gradient:   glucoseAlert ? kHealthGradAmber : kHealthGradBlue,
                isAlert:    glucoseAlert,
                compact:    true,
                onTap:      onTap,
              ),
              HealthMetricCard(
                icon:       Icons.favorite_rounded,
                label:      'Blood Pressure',
                value:      bp.isNotEmpty ? bp : '—/—',
                statusText: bp.isEmpty
                    ? 'Not logged today'
                    : bpAlert
                        ? 'Elevated — rest'
                        : 'Normal',
                gradient:   bpAlert ? kHealthGradAmber : kHealthGradRose,
                isAlert:    bpAlert,
                compact:    true,
                onTap:      onTap,
              ),
              MoodMetricCard(mood: mood,     compact: true, onTap: onTap),
              SymptomsMetricCard(symptoms: symptoms, compact: true, onTap: onTap),
            ],
          ),
      ],
    );
  }
}

// ─── Snapshot empty state ─────────────────────────────────────────────────────

class _SnapshotEmptyState extends StatelessWidget {
  final VoidCallback onTap;
  const _SnapshotEmptyState({required this.onTap});

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;

    return GestureDetector(
      onTap: onTap,
      child: Container(
        width:   double.infinity,
        padding: const EdgeInsets.symmetric(vertical: 32, horizontal: 20),
        decoration: BoxDecoration(
          color:        cs.surface,
          borderRadius: BorderRadius.circular(20),
          border:       Border.all(color: amina.cardBorder),
          boxShadow: [
            BoxShadow(
              color:      amina.sageGlow,
              blurRadius: 12,
              offset:     const Offset(0, 3),
            ),
          ],
        ),
        child: Column(
          children: [
            Container(
              width:  56,
              height: 56,
              decoration: BoxDecoration(
                color: cs.primaryContainer,
                shape: BoxShape.circle,
              ),
              child: Icon(
                Icons.monitor_heart_outlined,
                color: cs.primary,
                size:  28,
              ),
            ),
            const SizedBox(height: 14),
            Text(
              'No readings logged yet',
              style: TextStyle(
                fontSize:   16,
                fontWeight: FontWeight.w700,
                color:      cs.onSurface,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              'Tap here to log your vitals, mood, and symptoms\nand they\'ll appear right here.',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 13.5,
                color:    cs.onSurfaceVariant,
                height:   1.45,
              ),
            ),
            const SizedBox(height: 20),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 11),
              decoration: BoxDecoration(
                color:        cs.primary,
                borderRadius: BorderRadius.circular(14),
              ),
              child: const Text(
                'Log Your First Check-in',
                style: TextStyle(
                  color:      Colors.white,
                  fontSize:   14,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ─── Medications section ──────────────────────────────────────────────────────

class _MedicationsSection extends ConsumerStatefulWidget {
  final List<PrescriptionEntry>         medications;
  final VoidCallback                    onAdd;
  final ValueChanged<PrescriptionEntry> onTapMed;

  const _MedicationsSection({
    required this.medications,
    required this.onAdd,
    required this.onTapMed,
  });

  @override
  ConsumerState<_MedicationsSection> createState() =>
      _MedicationsSectionState();
}

class _MedicationsSectionState extends ConsumerState<_MedicationsSection> {
  bool _syncing = false;

  Future<void> _syncStock() async {
    if (_syncing) return;
    setState(() => _syncing = true);
    await ref.read(stockProvider.notifier).refresh();
    if (mounted) setState(() => _syncing = false);
  }

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    final medications = widget.medications;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            _SectionLabel("My Medications"),
            if (medications.isNotEmpty) ...[
              const SizedBox(width: 10),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 2),
                decoration: BoxDecoration(
                  color:        cs.primaryContainer,
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  '${medications.length}',
                  style: TextStyle(
                    fontSize:   12,
                    fontWeight: FontWeight.w700,
                    color:      cs.primary,
                  ),
                ),
              ),
            ],
            const Spacer(),
            if (medications.isNotEmpty) ...[
              Tooltip(
                message: 'Actualizar stock hospitalario',
                child: GestureDetector(
                  onTap: _syncStock,
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 220),
                    width:  34, height: 34,
                    decoration: BoxDecoration(
                      color:  _syncing ? cs.primaryContainer : amina.inputFill,
                      shape:  BoxShape.circle,
                      border: Border.all(
                        color: _syncing ? cs.primary : amina.cardBorder,
                        width: 1.2,
                      ),
                    ),
                    child: _syncing
                        ? Padding(
                            padding: const EdgeInsets.all(8),
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color:       cs.primary,
                            ),
                          )
                        : Icon(
                            Icons.sync_rounded,
                            size:  17,
                            color: cs.onSurfaceVariant,
                          ),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              TextButton.icon(
                onPressed: widget.onAdd,
                icon:  const Icon(Icons.add_rounded, size: 17),
                label: const Text('Add'),
                style: TextButton.styleFrom(
                  foregroundColor: cs.primary,
                  textStyle: const TextStyle(
                      fontSize: 14, fontWeight: FontWeight.w600),
                  padding: const EdgeInsets.symmetric(
                      horizontal: 12, vertical: 6),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(20),
                    side: BorderSide(color: cs.primary),
                  ),
                ),
              ),
            ],
          ],
        ),

        const SizedBox(height: 14),

        if (medications.isEmpty)
          _MedicationsEmptyState(onAdd: widget.onAdd)
        else
          Column(
            children: [
              _TakenTodayBanner(medications: medications),
              const SizedBox(height: 12),
              ...medications.map(
                (med) => MedicationListCard(
                  entry: med,
                  onTap: () => widget.onTapMed(med),
                ),
              ),
            ],
          ),
      ],
    );
  }
}

// ─── Taken-today banner ───────────────────────────────────────────────────────

class _TakenTodayBanner extends StatelessWidget {
  final List<PrescriptionEntry> medications;
  const _TakenTodayBanner({required this.medications});

  @override
  Widget build(BuildContext context) {
    final cs       = Theme.of(context).colorScheme;
    final takenCount = medications.where((m) => m.takenToday).length;
    final total      = medications.length;
    final allDone    = takenCount == total;

    return AnimatedContainer(
      duration: const Duration(milliseconds: 400),
      width:   double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: allDone ? cs.primaryContainer : const Color(0xFFFFFBEB),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: allDone
              ? cs.primary.withValues(alpha: 0.35)
              : const Color(0xFFF59E0B).withValues(alpha: 0.4),
        ),
      ),
      child: Row(
        children: [
          Icon(
            allDone
                ? Icons.check_circle_rounded
                : Icons.radio_button_unchecked_rounded,
            color: allDone ? cs.primary : const Color(0xFFB45309),
            size:  20,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              allDone
                  ? 'All medications taken today — great job! 🎉'
                  : '$takenCount of $total medications taken today',
              style: TextStyle(
                fontSize:   13,
                fontWeight: FontWeight.w600,
                color: allDone ? cs.primary : const Color(0xFF92400E),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Medications empty state ──────────────────────────────────────────────────

class _MedicationsEmptyState extends StatelessWidget {
  final VoidCallback onAdd;
  const _MedicationsEmptyState({required this.onAdd});

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;

    return Container(
      width:   double.infinity,
      padding: const EdgeInsets.symmetric(vertical: 36, horizontal: 24),
      decoration: BoxDecoration(
        color:        cs.surface,
        borderRadius: BorderRadius.circular(20),
        border:       Border.all(color: amina.cardBorder),
      ),
      child: Column(
        children: [
          Container(
            width:  64,
            height: 64,
            decoration: BoxDecoration(
              color: cs.primaryContainer,
              shape: BoxShape.circle,
            ),
            child: Icon(
              Icons.medication_outlined,
              color: cs.primary,
              size:  30,
            ),
          ),
          const SizedBox(height: 16),
          Text(
            'No medications yet',
            style: TextStyle(
              fontSize:   17,
              fontWeight: FontWeight.w700,
              color:      cs.onSurface,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'Add a prescription using the Scan or\nManual entry feature.',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 14,
              color:    cs.onSurfaceVariant,
              height:   1.5,
            ),
          ),
          const SizedBox(height: 20),
          ElevatedButton.icon(
            onPressed: onAdd,
            icon:  const Icon(Icons.add_rounded, size: 18),
            label: const Text('Add Medication',
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
            style: ElevatedButton.styleFrom(
              backgroundColor: cs.primary,
              foregroundColor: Colors.white,
              elevation:       0,
              padding: const EdgeInsets.symmetric(
                  horizontal: 24, vertical: 14),
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16)),
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Section label ────────────────────────────────────────────────────────────

class _SectionLabel extends StatelessWidget {
  final String text;
  const _SectionLabel(this.text);

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: TextStyle(
        fontSize:   18,
        fontWeight: FontWeight.bold,
        color:      Theme.of(context).colorScheme.onSurface,
      ),
    );
  }
}
