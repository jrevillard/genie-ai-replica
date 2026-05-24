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
import '../providers/daily_plan_provider.dart';
import 'care_plan_sheet.dart';

// ── Track category colours — semantic identity, fixed across both modes ────────
//
// Same token set as care_plan_sheet.dart (Medical/Traditional/AI palette).
// These are data-identity colours and must NOT adapt to theme — they work
// like a chart legend: consistent meaning regardless of light or dark mode.

const _kMedColor  = Color(0xFF06B6D4); // Medical      — cyan
const _kTradColor = Color(0xFF10B981); // Traditional  — emerald
const _kAiColor   = Color(0xFF8B5CF6); // AI           — violet

Color _trackColor(PlanTrack t) =>
    const [_kMedColor, _kTradColor, _kAiColor][t.index];

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC WIDGET
// ═══════════════════════════════════════════════════════════════════════════════

class DailyPlanSection extends ConsumerWidget {
  final void Function(String) onAskAmina;
  const DailyPlanSection({super.key, required this.onAskAmina});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state  = ref.watch(dailyPlanProvider);
    // ── Single theme read — propagated to every child ──────────────────
    final cs     = Theme.of(context).colorScheme;
    final amina  = Theme.of(context).extension<AminaColors>()!;
    final isDark = cs.brightness == Brightness.dark;

    final now  = TimeOfDay.now();
    final time = '${now.hour.toString().padLeft(2, '0')}:'
                 '${now.minute.toString().padLeft(2, '0')}';

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 20),
      decoration: BoxDecoration(
        color:        cs.surface,
        borderRadius: BorderRadius.circular(28),
        border:       Border.all(color: amina.cardBorder),
        // Soft sage ambient glow — not a heavy shadow.
        boxShadow: [
          BoxShadow(color: amina.sageGlow, blurRadius: 24, offset: Offset.zero),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [

          // ── Header ────────────────────────────────────────────────────────
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
            child: Row(
              children: [
                const Text('🗓', style: TextStyle(fontSize: 22)),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'My Care Plan',
                        style: TextStyle(
                          color:         cs.onSurface,
                          fontSize:      18,
                          fontWeight:    FontWeight.w800,
                          fontFamily:    'Inter',
                          letterSpacing: -0.4,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '${state.doneCount} of ${state.totalCount} tasks done today',
                        style: TextStyle(
                          color:      cs.onSurfaceVariant,
                          fontSize:   12,
                          fontFamily: 'Inter',
                        ),
                      ),
                    ],
                  ),
                ),
                // Time pill — neutral fill, no accent
                Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 10, vertical: 5),
                  decoration: BoxDecoration(
                    color:        amina.inputFill,
                    borderRadius: BorderRadius.circular(20),
                    border:       Border.all(color: amina.cardBorder),
                  ),
                  child: Text(
                    time,
                    style: TextStyle(
                      color:      cs.onSurfaceVariant,
                      fontSize:   11,
                      fontWeight: FontWeight.w600,
                      fontFamily: 'Inter',
                    ),
                  ),
                ),
              ],
            ),
          ),

          // ── 3 progress rings ──────────────────────────────────────────────
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 14, 12, 0),
            child: Row(
              children: PlanTrack.values.map((track) {
                return Expanded(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 4),
                    child: _PlanRing(
                      track:    track,
                      progress: state.progressFor(track),
                      color:    _trackColor(track),
                      cs:       cs,
                    ),
                  ),
                );
              }).toList(),
            ),
          ),

          // ── Quick-action pills ────────────────────────────────────────────
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 14, 20, 0),
            child: Row(
              children: [
                _QuickPill(
                  emoji:  '🥗',
                  label:  'Nutrition',
                  color:  _kTradColor,
                  cs:     cs,
                  isDark: isDark,
                  onTap:  () => onAskAmina(
                      'What should I eat today for my health condition?'),
                ),
                const SizedBox(width: 8),
                _QuickPill(
                  emoji:  '💊',
                  label:  'Meds',
                  color:  _kMedColor,
                  cs:     cs,
                  isDark: isDark,
                  onTap:  () => onAskAmina(
                      'Tell me about my medications and any interactions '
                      'I should know about.'),
                ),
                const SizedBox(width: 8),
                _QuickPill(
                  emoji:  '🚶',
                  label:  'Exercise',
                  color:  _kAiColor,
                  cs:     cs,
                  isDark: isDark,
                  onTap:  () => onAskAmina(
                      'What exercises are safe and beneficial for me today?'),
                ),
              ],
            ),
          ),

          // ── View Full Care Plan button ─────────────────────────────────────
          //
          // cs.primaryContainer gives:
          //   Light → soft sage-green tint   (EDF7F3)
          //   Dark  → deep sage tint on dark  (1A3D2A)
          // — premium in both modes, no hardcoded gradient needed.
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
            child: GestureDetector(
              onTap: () => showCarePlanSheet(context),
              child: Container(
                width:  double.infinity,
                height: 52,
                decoration: BoxDecoration(
                  color:        cs.primaryContainer,
                  borderRadius: BorderRadius.circular(18),
                  border:       Border.all(
                      color: cs.primary.withValues(alpha: 0.45)),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Text('📋', style: TextStyle(fontSize: 17)),
                    const SizedBox(width: 8),
                    Text(
                      'View Full Care Plan',
                      style: TextStyle(
                        color:      cs.primary,
                        fontSize:   14.5,
                        fontWeight: FontWeight.w700,
                        fontFamily: 'Inter',
                      ),
                    ),
                    const SizedBox(width: 6),
                    Icon(Icons.arrow_forward_ios_rounded,
                        color: cs.primary.withValues(alpha: 0.70), size: 13),
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

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN RING — animated circular progress
// ═══════════════════════════════════════════════════════════════════════════════

class _PlanRing extends StatelessWidget {
  final PlanTrack   track;
  final double      progress; // 0–1
  final Color       color;    // semantic category colour — stays fixed
  final ColorScheme cs;
  const _PlanRing({
    required this.track,
    required this.progress,
    required this.color,
    required this.cs,
  });

  @override
  Widget build(BuildContext context) {
    final pct = '${(progress * 100).round()}%';

    return Column(
      children: [
        TweenAnimationBuilder<double>(
          tween:    Tween(begin: 0, end: progress),
          duration: const Duration(milliseconds: 1100),
          curve:    Curves.easeOutCubic,
          builder:  (_, value, __) => Stack(
            alignment: Alignment.center,
            children: [
              // Soft glow disc — category colour at very low alpha
              Container(
                width:  80,
                height: 80,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: color.withValues(alpha: value > 0 ? 0.08 : 0),
                ),
              ),
              // Ring arc
              SizedBox(
                width:  80,
                height: 80,
                child: CustomPaint(
                  painter: _RingPainter(progress: value, color: color),
                ),
              ),
              // Centre percentage text — themed
              Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    pct,
                    style: TextStyle(
                      color:      value > 0
                          ? cs.onSurface
                          : cs.onSurfaceVariant,
                      fontSize:   16,
                      fontWeight: FontWeight.w800,
                      fontFamily: 'Inter',
                      height:     1.0,
                    ),
                  ),
                  if (progress >= 1.0) ...[
                    const SizedBox(height: 2),
                    Icon(Icons.check_rounded, color: color, size: 12),
                  ],
                ],
              ),
            ],
          ),
        ),

        const SizedBox(height: 10),

        Text(track.emoji, style: const TextStyle(fontSize: 18)),
        const SizedBox(height: 2),
        Text(
          track.label,
          style: TextStyle(
            color:      cs.onSurfaceVariant,
            fontSize:   11,
            fontWeight: FontWeight.w600,
            fontFamily: 'Inter',
          ),
        ),
      ],
    );
  }
}

// ── Ring CustomPainter — compositing-safe (no MaskFilter) ─────────────────────

class _RingPainter extends CustomPainter {
  final double progress;
  final Color  color;
  const _RingPainter({required this.progress, required this.color});

  static const _stroke     = 5.5;
  static const _startAngle = -math.pi / 2;

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = (size.shortestSide - _stroke) / 2;
    final rect   = Rect.fromCircle(center: center, radius: radius);

    // Unfilled track ring
    canvas.drawArc(rect, 0, math.pi * 2, false,
      Paint()
        ..style       = PaintingStyle.stroke
        ..strokeWidth = _stroke
        ..color       = color.withValues(alpha: 0.13));

    if (progress <= 0) return;

    // Filled progress arc
    canvas.drawArc(rect, _startAngle, math.pi * 2 * progress, false,
      Paint()
        ..style       = PaintingStyle.stroke
        ..strokeWidth = _stroke
        ..strokeCap   = StrokeCap.round
        ..color       = color);
  }

  @override
  bool shouldRepaint(covariant _RingPainter old) =>
      old.progress != progress || old.color != color;
}

// ═══════════════════════════════════════════════════════════════════════════════
// QUICK-ACTION PILL
// ═══════════════════════════════════════════════════════════════════════════════

class _QuickPill extends StatelessWidget {
  final String       emoji;
  final String       label;
  final Color        color;    // semantic category colour — stays fixed
  final ColorScheme  cs;
  final bool         isDark;
  final VoidCallback onTap;
  const _QuickPill({
    required this.emoji,
    required this.label,
    required this.color,
    required this.cs,
    required this.isDark,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) => Expanded(
        child: GestureDetector(
          onTap: onTap,
          child: Container(
            height: 50,
            decoration: BoxDecoration(
              // Light: flat tint so the pill reads cleanly on white.
              // Dark:  gradient for a warm glow against charcoal.
              gradient: isDark
                  ? LinearGradient(
                      begin:  Alignment.topLeft,
                      end:    Alignment.bottomRight,
                      colors: [cs.surface, color.withValues(alpha: 0.10)],
                    )
                  : null,
              color:        isDark ? null : color.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(16),
              border:       Border.all(color: color.withValues(alpha: 0.35)),
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Container(
                  width:  26,
                  height: 26,
                  decoration: BoxDecoration(
                    color: color.withValues(alpha: 0.16),
                    shape: BoxShape.circle,
                  ),
                  child: Center(
                    child: Text(emoji, style: const TextStyle(fontSize: 13)),
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  label,
                  style: TextStyle(
                    color:      color,
                    fontSize:   10.5,
                    fontWeight: FontWeight.w700,
                    fontFamily: 'Inter',
                  ),
                ),
              ],
            ),
          ),
        ),
      );
}
