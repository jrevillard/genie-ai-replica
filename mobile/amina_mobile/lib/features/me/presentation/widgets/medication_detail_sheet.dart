import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../today/presentation/providers/prescription_provider.dart';
import '../../../../core/theme/app_theme.dart';

// ─── Sheet ────────────────────────────────────────────────────────────────────

/// Full-detail modal bottom sheet for a single [PrescriptionEntry].
///
/// Open via [showMedicationDetailSheet] — do not push this as a route.
class MedicationDetailSheet extends ConsumerWidget {
  final PrescriptionEntry entry;

  const MedicationDetailSheet({super.key, required this.entry});

  // ── Helpers ────────────────────────────────────────────────────────────────

  PrescriptionEntry _live(WidgetRef ref) {
    return ref.watch(prescriptionProvider).firstWhere(
          (e) => e.id == entry.id,
          orElse: () => entry,
        );
  }

  static String _formatDate(DateTime d) {
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return '${months[d.month - 1]} ${d.day}, ${d.year}';
  }

  // ── Delete with confirmation ───────────────────────────────────────────────

  Future<void> _confirmDelete(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) {
        final cs = Theme.of(ctx).colorScheme;
        return AlertDialog(
          shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(20)),
          title: Text(
            'Remove medication?',
            style: TextStyle(
                fontSize: 18, fontWeight: FontWeight.w700, color: cs.onSurface),
          ),
          content: Text(
            'This will permanently remove ${entry.medicationName} from your list. '
            'You can always add it again later.',
            style: TextStyle(fontSize: 15, color: cs.onSurfaceVariant, height: 1.5),
          ),
          actionsPadding:
              const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: Text('Cancel',
                  style: TextStyle(color: cs.onSurfaceVariant, fontSize: 15)),
            ),
            ElevatedButton(
              onPressed: () => Navigator.of(ctx).pop(true),
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.red.shade400,
                foregroundColor: Colors.white,
                elevation: 0,
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12)),
              ),
              child: const Text('Remove',
                  style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
            ),
          ],
        );
      },
    );

    if (confirmed == true && context.mounted) {
      ref.read(prescriptionProvider.notifier).remove(entry.id);
      Navigator.of(context).pop();
    }
  }

  // ── Build ──────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final live  = _live(ref);
    final taken = live.takenToday;
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;

    return SafeArea(
      top: false,
      child: SingleChildScrollView(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 32),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // ── Drag handle ───────────────────────────────────────────────
              Center(
                child: Container(
                  margin: const EdgeInsets.only(top: 12, bottom: 20),
                  width: 36,
                  height: 4,
                  decoration: BoxDecoration(
                    color: amina.cardBorder,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),

              // ── Hero header ───────────────────────────────────────────────
              _Header(entry: live, taken: taken),

              const SizedBox(height: 24),

              // ── Section label ─────────────────────────────────────────────
              Text(
                'Prescription Details',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: cs.onSurfaceVariant,
                  letterSpacing: 0.5,
                ),
              ),
              const SizedBox(height: 10),

              // ── Detail card ───────────────────────────────────────────────
              _DetailCard(entry: live),

              const SizedBox(height: 28),

              // ── Mark as taken button ──────────────────────────────────────
              _TakenButton(
                taken: taken,
                onToggle: () {
                  final notifier = ref.read(prescriptionProvider.notifier);
                  taken
                      ? notifier.clearTakenToday(live.id)
                      : notifier.markTakenToday(live.id);
                },
              ),

              const SizedBox(height: 12),

              // ── Remove button ─────────────────────────────────────────────
              SizedBox(
                width: double.infinity,
                height: 50,
                child: TextButton.icon(
                  onPressed: () => _confirmDelete(context, ref),
                  icon: Icon(Icons.delete_outline_rounded,
                      color: Colors.red.shade400, size: 20),
                  label: Text(
                    'Remove Medication',
                    style: TextStyle(
                      color: Colors.red.shade400,
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  style: TextButton.styleFrom(
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(16),
                      side: BorderSide(
                          color: Colors.red.shade200.withValues(alpha: 0.5)),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ─── Header widget ────────────────────────────────────────────────────────────

class _Header extends StatelessWidget {
  final PrescriptionEntry entry;
  final bool taken;

  const _Header({required this.entry, required this.taken});

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Large icon circle
        AnimatedContainer(
          duration: const Duration(milliseconds: 300),
          width: 64,
          height: 64,
          decoration: BoxDecoration(
            color: taken ? amina.inputFill : cs.primaryContainer,
            shape: BoxShape.circle,
            border: Border.all(
              color: taken
                  ? amina.cardBorder
                  : cs.primary.withValues(alpha: 0.3),
              width: 1.5,
            ),
          ),
          child: Icon(
            Icons.medication_rounded,
            color: taken ? cs.onSurfaceVariant : cs.primary,
            size: 30,
          ),
        ),

        const SizedBox(width: 16),

        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Badges row
              Row(
                children: [
                  if (taken)
                    _HeaderBadge(
                      label: 'Taken Today',
                      icon: Icons.check_circle_rounded,
                      color: cs.primary,
                      bg: cs.primaryContainer,
                    ),
                  if (entry.fromScan) ...[
                    if (taken) const SizedBox(width: 6),
                    const _HeaderBadge(
                      label: 'AI Scanned',
                      icon: Icons.auto_awesome_rounded,
                      color: Color(0xFF3B82F6),
                      bg: Color(0xFFEFF6FF),
                    ),
                  ],
                ],
              ),
              if (taken || entry.fromScan) const SizedBox(height: 6),

              // Medication name
              Text(
                entry.medicationName,
                style: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.w800,
                  color: cs.onSurface,
                  letterSpacing: -0.5,
                  height: 1.1,
                ),
              ),

              const SizedBox(height: 4),

              // Quick summary line
              Text(
                '${entry.dosage}  ·  ${entry.frequency}',
                style: TextStyle(
                  fontSize: 15,
                  color: cs.onSurfaceVariant,
                  fontWeight: FontWeight.w500,
                ),
              ),

              const SizedBox(height: 4),

              // Date added
              Text(
                'Added ${MedicationDetailSheet._formatDate(entry.dateAdded)}',
                style: TextStyle(
                  fontSize: 12,
                  color: cs.onSurfaceVariant.withValues(alpha: 0.7),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _HeaderBadge extends StatelessWidget {
  final String label;
  final IconData icon;
  final Color color;
  final Color bg;

  const _HeaderBadge({
    required this.label,
    required this.icon,
    required this.color,
    required this.bg,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: color),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: color,
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Detail card ─────────────────────────────────────────────────────────────

class _DetailCard extends StatelessWidget {
  final PrescriptionEntry entry;

  const _DetailCard({required this.entry});

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;

    final liveRows = <_DetailRowData>[
      _DetailRowData(
        icon:      Icons.medication_outlined,
        iconColor: cs.primary,
        iconBg:    cs.primaryContainer,
        label:     'Dosage',
        value:     entry.dosage,
      ),
      _DetailRowData(
        icon:      Icons.repeat_rounded,
        iconColor: const Color(0xFF3B82F6),
        iconBg:    const Color(0xFFEFF6FF),
        label:     'Frequency',
        value:     entry.frequency,
      ),
      _DetailRowData(
        icon:      Icons.calendar_month_outlined,
        iconColor: const Color(0xFFF59E0B),
        iconBg:    const Color(0xFFFEF3C7),
        label:     'Duration',
        value:     entry.duration,
      ),
      if (entry.notes.isNotEmpty)
        _DetailRowData(
          icon:      Icons.notes_rounded,
          iconColor: const Color(0xFF8B5CF6),
          iconBg:    const Color(0xFFF5F3FF),
          label:     'Notes',
          value:     entry.notes,
        ),
    ];

    return Container(
      decoration: BoxDecoration(
        color: cs.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: amina.cardBorder),
        boxShadow: const [
          BoxShadow(
            color: Color(0x06000000),
            blurRadius: 16,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        children: [
          for (int i = 0; i < liveRows.length; i++) ...[
            _DetailRow(data: liveRows[i]),
            if (i < liveRows.length - 1)
              Divider(height: 1, indent: 72, color: amina.cardBorder),
          ],
        ],
      ),
    );
  }
}

class _DetailRowData {
  final IconData icon;
  final Color iconColor;
  final Color iconBg;
  final String label;
  final String value;

  const _DetailRowData({
    required this.icon,
    required this.iconColor,
    required this.iconBg,
    required this.label,
    required this.value,
  });
}

class _DetailRow extends StatelessWidget {
  final _DetailRowData data;

  const _DetailRow({required this.data});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Icon circle
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: data.iconBg,
              shape: BoxShape.circle,
            ),
            child: Icon(data.icon, color: data.iconColor, size: 19),
          ),

          const SizedBox(width: 16),

          // Label + value
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  data.label,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: cs.onSurfaceVariant,
                    letterSpacing: 0.3,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  data.value,
                  style: TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w600,
                    color: cs.onSurface,
                    height: 1.35,
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

// ─── Taken button ─────────────────────────────────────────────────────────────

class _TakenButton extends StatelessWidget {
  final bool taken;
  final VoidCallback onToggle;

  const _TakenButton({required this.taken, required this.onToggle});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;

    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 260),
      switchInCurve: Curves.easeOut,
      child: taken
          // ── Already taken — outlined "undo" style ──────────────────────────
          ? SizedBox(
              key: const ValueKey('taken'),
              width: double.infinity,
              height: 54,
              child: OutlinedButton.icon(
                onPressed: onToggle,
                style: OutlinedButton.styleFrom(
                  side: BorderSide(color: cs.primary, width: 1.5),
                  foregroundColor: cs.primary,
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(16)),
                ),
                icon: const Icon(Icons.check_circle_rounded, size: 20),
                label: const Text(
                  'Taken Today  ·  Undo',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            )
          // ── Not yet taken — filled CTA ──────────────────────────────────
          : SizedBox(
              key: const ValueKey('not-taken'),
              width: double.infinity,
              height: 54,
              child: ElevatedButton.icon(
                onPressed: onToggle,
                style: ElevatedButton.styleFrom(
                  backgroundColor: cs.primary,
                  foregroundColor: Colors.white,
                  elevation: 0,
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(16)),
                ),
                icon: const Icon(Icons.check_circle_outline_rounded, size: 20),
                label: const Text(
                  'Mark as Taken Today',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ),
    );
  }
}

// ─── Convenience function ─────────────────────────────────────────────────────

void showMedicationDetailSheet(
  BuildContext context,
  PrescriptionEntry entry,
) {
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: Theme.of(context).colorScheme.surface,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
    ),
    builder: (_) => MedicationDetailSheet(entry: entry),
  );
}
