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

import 'dart:math' as math;
import 'package:flutter/material.dart';

// ─── Design tokens ────────────────────────────────────────────────────────────

const _kInkPrimary = Color(0xFF111827);
const _kInkMuted   = Color(0xFF6B7280);

// ─── Habit data ───────────────────────────────────────────────────────────────

class _HabitData {
  final String emoji;
  final String label;
  final String target;
  final double progress; // 0.0 – 1.0
  final Color  color;

  const _HabitData({
    required this.emoji,
    required this.label,
    required this.target,
    required this.progress,
    required this.color,
  });
}

const _kHabits = [
  _HabitData(
    emoji:    '💧',
    label:    'Water',
    target:   '4 / 8 cups',
    progress: 0.50,
    color:    Color(0xFF3B82F6),
  ),
  _HabitData(
    emoji:    '🚶',
    label:    'Walk',
    target:   '9 / 30 min',
    progress: 0.30,
    color:    Color(0xFF3D9970),
  ),
  _HabitData(
    emoji:    '💊',
    label:    'Meds',
    target:   '2 / 2 taken',
    progress: 1.00,
    color:    Color(0xFF7C3AED),
  ),
  _HabitData(
    emoji:    '🧘',
    label:    'Rest',
    target:   '6 / 8 h',
    progress: 0.75,
    color:    Color(0xFFEA580C),
  ),
];

// ─── HabitsSection ────────────────────────────────────────────────────────────

/// Row of four habit tracking cards, each with a circular progress ring.
///
/// Progress values are currently static placeholders — wire to a Riverpod
/// provider (e.g. HabitsProvider) when real tracking is implemented.
class HabitsSection extends StatelessWidget {
  const HabitsSection({super.key});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // ── Section header ─────────────────────────────────────────────────
        const Padding(
          padding: EdgeInsets.fromLTRB(20, 0, 20, 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                "Today's Habits",
                style: TextStyle(
                  fontSize:      19,
                  fontWeight:    FontWeight.w700,
                  color:         _kInkPrimary,
                  letterSpacing: -0.4,
                ),
              ),
              SizedBox(height: 2),
              Text(
                'Keep your streak going',
                style: TextStyle(fontSize: 12.5, color: _kInkMuted),
              ),
            ],
          ),
        ),

        // ── Habit ring cards ───────────────────────────────────────────────
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: Row(
            children: [
              for (int i = 0; i < _kHabits.length; i++) ...[
                Expanded(child: _HabitRingCard(data: _kHabits[i])),
                if (i < _kHabits.length - 1) const SizedBox(width: 10),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

// ─── Habit ring card ──────────────────────────────────────────────────────────

class _HabitRingCard extends StatelessWidget {
  final _HabitData data;
  const _HabitRingCard({required this.data});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 6),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        boxShadow: const [
          BoxShadow(
            color:      Color(0x09000000),
            blurRadius: 10,
            offset:     Offset(0, 3),
          ),
        ],
      ),
      child: Column(
        children: [
          // ── Ring with emoji inside ──────────────────────────────────────
          SizedBox(
            width:  54,
            height: 54,
            child: CustomPaint(
              painter: _RingPainter(
                progress: data.progress,
                color:    data.color,
              ),
              child: Center(
                child: Text(
                  data.emoji,
                  style: const TextStyle(fontSize: 20),
                ),
              ),
            ),
          ),

          const SizedBox(height: 9),

          // ── Label ──────────────────────────────────────────────────────
          Text(
            data.label,
            style: const TextStyle(
              fontSize:   12,
              fontWeight: FontWeight.w700,
              color:      _kInkPrimary,
            ),
          ),

          const SizedBox(height: 3),

          // ── Target / progress text ─────────────────────────────────────
          Text(
            data.target,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 9.5,
              color:    _kInkMuted,
              height:   1.3,
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Ring painter ─────────────────────────────────────────────────────────────

/// Arc-style circular progress ring.
///
/// Draws a faint full-circle track and a coloured arc from 12 o'clock.
class _RingPainter extends CustomPainter {
  final double progress; // 0.0 – 1.0
  final Color  color;

  const _RingPainter({required this.progress, required this.color});

  static const _strokeWidth = 4.5;

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = (size.width - _strokeWidth) / 2;

    final trackPaint = Paint()
      ..color       = color.withValues(alpha: 0.14)
      ..style       = PaintingStyle.stroke
      ..strokeWidth = _strokeWidth
      ..strokeCap   = StrokeCap.round;

    final arcPaint = Paint()
      ..color       = color
      ..style       = PaintingStyle.stroke
      ..strokeWidth = _strokeWidth
      ..strokeCap   = StrokeCap.round;

    // Full-circle track
    canvas.drawCircle(center, radius, trackPaint);

    // Progress arc (starts at 12 o'clock = -π/2)
    if (progress > 0) {
      canvas.drawArc(
        Rect.fromCircle(center: center, radius: radius),
        -math.pi / 2,
        2 * math.pi * progress.clamp(0.0, 1.0),
        false,
        arcPaint,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _RingPainter old) =>
      old.progress != progress || old.color != color;
}
