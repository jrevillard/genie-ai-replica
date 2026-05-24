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

﻿import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/theme/app_theme.dart';
import '../providers/habits_provider.dart';
import '../../../today/presentation/providers/prescription_provider.dart';
import '../../../today/presentation/providers/vitals_provider.dart';

// ── Semantic data colours — fixed across both modes ───────────────────────────
//
// Vitals display colours are data-identity signals (like chart legend colours).
// They must not adapt to theme so their meaning stays consistent.

const _kCaution     = Color(0xFFF59E0B); // glucose alert  — amber caution
const _kGlucoseBlue = Color(0xFF3B82F6); // glucose normal — blue data identity
const _kBpPink      = Color(0xFFF472B6); // BP normal      — pink data identity
// BP alert → cs.error  (M3 role — consistent with health_insights_section)

// ─── Internal model ───────────────────────────────────────────────────────────

class _HabitData {
  final String        emoji;
  final String        label;
  final int           current;
  final int           goal;
  final String        unit;
  final Color         color;
  final VoidCallback? onIncrement;
  final VoidCallback? onDecrement;
  final String?       manageHint; // shown instead of stepper when no increment/decrement

  const _HabitData({
    required this.emoji,
    required this.label,
    required this.current,
    required this.goal,
    required this.unit,
    required this.color,
    this.onIncrement,
    this.onDecrement,
    this.manageHint,
  });

  double get progress      => goal == 0 ? 1.0 : (current / goal).clamp(0.0, 1.0);
  bool   get isDone        => progress >= 1.0;
  String get progressLabel =>
      goal == 0 ? 'None added' : '$current / $goal $unit';
  int    get pct           => (progress * 100).round();
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC WIDGET
// ═══════════════════════════════════════════════════════════════════════════════

/// Four bento-style habit tiles backed by Riverpod providers.
///
/// Compositing-safe: no Opacity widget, no BackdropFilter, no ColorFiltered,
/// no ShaderMask — safe inside IndexedStack on all frames.
class DailyHabitOverview extends ConsumerWidget {
  const DailyHabitOverview({super.key});

  static String _dayLabel() {
    const days = [
      'Monday', 'Tuesday', 'Wednesday', 'Thursday',
      'Friday', 'Saturday', 'Sunday',
    ];
    final now = DateTime.now();
    return '${days[now.weekday - 1]}, ${_monthAbbr(now.month)} ${now.day}';
  }

  static String _monthAbbr(int m) => const [
    '', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ][m];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final habits    = ref.watch(habitsProvider);
    final meds      = ref.watch(prescriptionProvider);
    final latest    = ref.watch(latestVitalsProvider);
    final allVitals = ref.watch(vitalsProvider);
    final latestGlucose = allVitals.where((e) => e.glucose.isNotEmpty).firstOrNull;
    final latestBp      = allVitals.where((e) => e.bloodPressure.isNotEmpty).firstOrNull;
    // ── Single theme read — propagated to every child ──────────────────
    final cs     = Theme.of(context).colorScheme;
    final amina  = Theme.of(context).extension<AminaColors>()!;
    final isDark = cs.brightness == Brightness.dark;

    final medsTaken = meds.where((m) => m.takenToday).length;
    final medsTotal = meds.length;

    final notifier = ref.read(habitsProvider.notifier);
    final items = <_HabitData>[
      _HabitData(
        emoji: '💧', label: 'Water',
        current: habits.waterCups, goal: 8, unit: 'cups',
        color: const Color(0xFF3B82F6),
        onIncrement: () => notifier.addWater(),
        onDecrement: () => notifier.removeWater(),
      ),
      _HabitData(
        emoji: '🚶', label: 'Walk',
        current: habits.walkMinutes, goal: 30, unit: 'min',
        color: const Color(0xFF3D9970),
        onIncrement: () => notifier.addWalk(),
        onDecrement: () => notifier.removeWalk(),
      ),
      _HabitData(
        emoji: '💊', label: 'Meds',
        current: medsTaken, goal: medsTotal, unit: 'taken',
        color: const Color(0xFF7C3AED),
        manageHint: 'Manage in Me tab',
      ),
      _HabitData(
        emoji: '🌙', label: 'Sleep',
        current: habits.sleepHours, goal: 8, unit: 'hours',
        color: const Color(0xFFEA580C),
        onIncrement: () => notifier.addSleep(),
        onDecrement: () => notifier.removeSleep(),
      ),
    ];

    final doneCount = items.where((h) => h.isDone).length;
    final allDone   = doneCount == items.length;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // ── Section header ───────────────────────────────────────────────
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      "Today's Habits",
                      style: TextStyle(
                        fontSize:   22,
                        fontWeight: FontWeight.w800,
                        color:      cs.onSurface,
                        fontFamily: 'Inter',
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      _dayLabel(),
                      style: TextStyle(
                        fontSize:   13,
                        color:      cs.onSurfaceVariant,
                        fontWeight: FontWeight.w500,
                        fontFamily: 'Inter',
                      ),
                    ),
                  ],
                ),
              ),

              // Done counter pill
              Container(
                padding: const EdgeInsets.symmetric(
                    horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: allDone ? cs.primaryContainer : amina.inputFill,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(
                    color: allDone
                        ? cs.primary.withValues(alpha: 0.40)
                        : amina.cardBorder,
                  ),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      allDone
                          ? Icons.check_circle_rounded
                          : Icons.radio_button_unchecked_rounded,
                      size:  14,
                      color: allDone ? cs.primary : cs.onSurfaceVariant,
                    ),
                    const SizedBox(width: 5),
                    Text(
                      '$doneCount / ${items.length} done',
                      style: TextStyle(
                        fontSize:   12,
                        fontWeight: FontWeight.w700,
                        color:      allDone ? cs.primary : cs.onSurfaceVariant,
                        fontFamily: 'Inter',
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),

          const SizedBox(height: 14),

          // ── 2 × 2 bento grid ────────────────────────────────────────────
          GridView.builder(
            shrinkWrap:   true,
            physics:      const NeverScrollableScrollPhysics(),
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount:   2,
              crossAxisSpacing: 10,
              mainAxisSpacing:  10,
              mainAxisExtent:   118,
            ),
            itemCount:   items.length,
            itemBuilder: (_, i) => _HabitBentoTile(
              data:   items[i],
              cs:     cs,
              isDark: isDark,
            ),
          ),

          // ── Vitals strip ─────────────────────────────────────────────────
          const SizedBox(height: 14),
          _VitalsStrip(
            latest:        latest,
            latestGlucose: latestGlucose,
            latestBp:      latestBp,
            cs:            cs,
            amina:         amina,
          ),
        ],
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HABIT BENTO TILE
//
// Light: cs.surface bg + category tint + cs.onSurface text
// Dark:  cs.surface (charcoal) bg + deeper category tint + cs.onSurface text
//
// Using category color directly (not a Colors.white lerp) avoids hardcoded
// white and gives vivid, readable text in both modes.
// ═══════════════════════════════════════════════════════════════════════════════

class _HabitBentoTile extends StatelessWidget {
  final _HabitData  data;
  final ColorScheme cs;
  final bool        isDark;
  const _HabitBentoTile({
    required this.data,
    required this.cs,
    required this.isDark,
  });

  @override
  Widget build(BuildContext context) {
    final color       = data.color;
    final hasSteppers = data.onIncrement != null || data.onDecrement != null;

    return Container(
      decoration: BoxDecoration(
        gradient: isDark
            ? LinearGradient(
                colors: [cs.surface, color.withValues(alpha: 0.14)],
                begin:  Alignment.topLeft,
                end:    Alignment.bottomRight,
              )
            : null,
        color:        isDark ? null : color.withValues(alpha: 0.07),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: color.withValues(alpha: 0.30), width: 1.5),
        boxShadow: [
          BoxShadow(
            color:      color.withValues(alpha: isDark ? 0.18 : 0.10),
            blurRadius: 16,
            offset:     const Offset(0, 6),
          ),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            // ── Progress ring + emoji ──────────────────────────────────────
            SizedBox(
              width:  40,
              height: 40,
              child: CustomPaint(
                painter: _RingPainter(
                  progress:   data.progress,
                  trackColor: cs.onSurface.withValues(alpha: 0.10),
                  arcColor:   color,
                ),
                child: Center(
                  child: Text(data.emoji,
                      style: const TextStyle(fontSize: 17)),
                ),
              ),
            ),

            const SizedBox(width: 12),

            // ── Text + stepper column ──────────────────────────────────────
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment:  MainAxisAlignment.center,
                mainAxisSize:       MainAxisSize.min,
                children: [
                  // Label + % badge
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          data.label,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize:      14,
                            fontWeight:    FontWeight.w800,
                            color:         cs.onSurface,
                            letterSpacing: -0.2,
                            fontFamily:    'Inter',
                          ),
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color:        color.withValues(alpha: 0.15),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          '${data.pct}%',
                          style: TextStyle(
                            fontSize:   10,
                            fontWeight: FontWeight.w700,
                            color:      color,
                            fontFamily: 'Inter',
                          ),
                        ),
                      ),
                    ],
                  ),

                  const SizedBox(height: 3),

                  Text(
                    data.progressLabel,
                    style: TextStyle(
                      fontSize:   11,
                      color:      cs.onSurfaceVariant,
                      fontWeight: FontWeight.w500,
                      fontFamily: 'Inter',
                    ),
                  ),

                  const SizedBox(height: 6),

                  ClipRRect(
                    borderRadius: BorderRadius.circular(4),
                    child: LinearProgressIndicator(
                      value:           data.progress,
                      minHeight:       3,
                      backgroundColor: cs.onSurface.withValues(alpha: 0.10),
                      valueColor:      AlwaysStoppedAnimation(color),
                    ),
                  ),

                  const SizedBox(height: 7),

                  // ── Stepper OR manage hint ─────────────────────────────
                  if (hasSteppers)
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        _StepBtn(
                          icon:    Icons.remove_rounded,
                          onTap:   data.onDecrement,
                          color:   color,
                          enabled: data.current > 0,
                        ),
                        _StepBtn(
                          icon:    Icons.add_rounded,
                          onTap:   data.onIncrement,
                          color:   color,
                          enabled: data.progress < 1.0,
                        ),
                      ],
                    )
                  else
                    Text(
                      data.manageHint ?? '',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize:   10,
                        color:      cs.onSurfaceVariant.withValues(alpha: 0.60),
                        fontWeight: FontWeight.w500,
                        fontFamily: 'Inter',
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Step button ───────────────────────────────────────────────────────────────

class _StepBtn extends StatelessWidget {
  final IconData     icon;
  final VoidCallback? onTap;
  final Color        color;
  final bool         enabled;
  const _StepBtn({
    required this.icon,
    required this.onTap,
    required this.color,
    required this.enabled,
  });

  @override
  Widget build(BuildContext context) {
    final active = enabled && onTap != null;
    return GestureDetector(
      onTap: active ? onTap : null,
      child: Container(
        width:  28,
        height: 28,
        decoration: BoxDecoration(
          color:        active
              ? color.withValues(alpha: 0.15)
              : Colors.transparent,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(
            color: active
                ? color.withValues(alpha: 0.40)
                : color.withValues(alpha: 0.15),
          ),
        ),
        child: Icon(
          icon,
          size:  16,
          color: active ? color : color.withValues(alpha: 0.30),
        ),
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// VITALS STRIP
// ═══════════════════════════════════════════════════════════════════════════════

class _VitalsStrip extends StatelessWidget {
  final VitalsEntry? latest;
  final VitalsEntry? latestGlucose;
  final VitalsEntry? latestBp;
  final ColorScheme  cs;
  final AminaColors  amina;
  const _VitalsStrip({
    required this.latest,
    required this.latestGlucose,
    required this.latestBp,
    required this.cs,
    required this.amina,
  });

  static bool _isBpElevated(String bp) {
    if (bp.isEmpty) return false;
    final systolic = int.tryParse(bp.split('/').first.trim());
    return systolic != null && systolic >= 130;
  }

  static bool _isGlucoseHigh(String g) {
    final v = int.tryParse(g.trim());
    return v != null && v >= 180;
  }

  @override
  Widget build(BuildContext context) {
    final glucose      = latestGlucose?.glucose       ?? '';
    final bp           = latestBp?.bloodPressure      ?? '';
    final glucoseAlert = _isGlucoseHigh(glucose);
    final bpAlert      = _isBpElevated(bp);

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color:        cs.surface,
        borderRadius: BorderRadius.circular(20),
        border:       Border.all(color: amina.cardBorder),
        boxShadow: [
          BoxShadow(
            color:      cs.shadow.withValues(alpha: 0.04),
            blurRadius: 12,
            offset:     const Offset(0, 3),
          ),
        ],
      ),
      child: Row(
        children: [
          // Heart icon circle — sage themed
          Container(
            width:  40,
            height: 40,
            decoration: BoxDecoration(
              color: cs.primaryContainer,
              shape: BoxShape.circle,
            ),
            child: Icon(
              Icons.favorite_rounded,
              color: cs.primary,
              size:  20,
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: latest == null
                ? Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'No vitals logged today',
                        style: TextStyle(
                          fontSize:   15,
                          fontWeight: FontWeight.w700,
                          color:      cs.onSurface,
                          fontFamily: 'Inter',
                        ),
                      ),
                      Text(
                        'Go to Today tab to log your readings.',
                        style: TextStyle(
                          fontSize:   12,
                          color:      cs.onSurfaceVariant,
                          fontFamily: 'Inter',
                        ),
                      ),
                    ],
                  )
                : Row(
                    children: [
                      Expanded(
                        child: _VitalCell(
                          label:       'Glucose',
                          value:       glucose.isNotEmpty
                              ? '$glucose mg/dL' : '—',
                          isAlert:     glucoseAlert,
                          alertColor:  _kCaution,
                          normalColor: _kGlucoseBlue,
                          cs:          cs,
                        ),
                      ),
                      Container(
                        width:  1,
                        height: 36,
                        color:  amina.divider,
                        margin: const EdgeInsets.symmetric(horizontal: 12),
                      ),
                      Expanded(
                        child: _VitalCell(
                          label:       'Blood Pressure',
                          value:       bp.isNotEmpty ? bp : '—/—',
                          isAlert:     bpAlert,
                          alertColor:  cs.error,   // M3 role — not a raw red
                          normalColor: _kBpPink,
                          cs:          cs,
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

class _VitalCell extends StatelessWidget {
  final String      label;
  final String      value;
  final bool        isAlert;
  final Color       alertColor;
  final Color       normalColor;
  final ColorScheme cs;

  const _VitalCell({
    required this.label,
    required this.value,
    required this.isAlert,
    required this.alertColor,
    required this.normalColor,
    required this.cs,
  });

  @override
  Widget build(BuildContext context) {
    final accent = isAlert ? alertColor : normalColor;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: TextStyle(
            fontSize:   11,
            color:      cs.onSurfaceVariant,
            fontWeight: FontWeight.w500,
            fontFamily: 'Inter',
          ),
        ),
        const SizedBox(height: 2),
        Text(
          value,
          style: TextStyle(
            fontSize:   15,
            fontWeight: FontWeight.w800,
            color:      accent,
            fontFamily: 'Inter',
          ),
        ),
        if (isAlert)
          Text(
            'Check with doctor',
            style: TextStyle(
              fontSize:   10,
              color:      alertColor,
              fontWeight: FontWeight.w600,
              fontFamily: 'Inter',
            ),
          ),
      ],
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// RING PAINTER  — pure canvas, no compositing side-effects
// ═══════════════════════════════════════════════════════════════════════════════

class _RingPainter extends CustomPainter {
  final double progress;
  final Color  trackColor;
  final Color  arcColor;

  const _RingPainter({
    required this.progress,
    required this.trackColor,
    required this.arcColor,
  });

  static const _stroke = 4.5;

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = (size.shortestSide - _stroke) / 2;

    // Track ring
    canvas.drawCircle(
      center,
      radius,
      Paint()
        ..color       = trackColor
        ..style       = PaintingStyle.stroke
        ..strokeWidth = _stroke
        ..strokeCap   = StrokeCap.round,
    );

    // Progress arc
    if (progress > 0) {
      canvas.drawArc(
        Rect.fromCircle(center: center, radius: radius),
        -math.pi / 2,
        2 * math.pi * progress.clamp(0.0, 1.0),
        false,
        Paint()
          ..color       = arcColor
          ..style       = PaintingStyle.stroke
          ..strokeWidth = _stroke
          ..strokeCap   = StrokeCap.round,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _RingPainter old) =>
      old.progress   != progress   ||
      old.trackColor != trackColor ||
      old.arcColor   != arcColor;
}
