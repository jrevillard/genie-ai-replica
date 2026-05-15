import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/theme/app_theme.dart';
import '../providers/health_insights_provider.dart';
import '../providers/vitals_provider.dart';

// ── Semantic signal colours ────────────────────────────────────────────────────
//
// Rule (same as care_plan_sheet.dart):
//   • Caution amber stays fixed — it's a universal "warning" signal.
//   • Good (green)  → cs.primary  (our Sage, already themed).
//   • Alert (red)   → cs.error    (M3 role — softer, premium feel in dark).
//   • AI violet     → fixed category identity, same token used in the care
//                     plan sheet for the AI plan type.

const _kCaution  = Color(0xFFF59E0B); // amber — caution signal
const _kAiViolet = Color(0xFF8B5CF6); // AI category identity

// ── Severity → colour ─────────────────────────────────────────────────────────

Color _severityColor(InsightSeverity s, ColorScheme cs) => switch (s) {
  InsightSeverity.good    => cs.primary,   // sage — themed
  InsightSeverity.caution => _kCaution,    // amber — fixed semantic signal
  InsightSeverity.alert   => cs.error,     // M3 error — adapts to mode
};

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC WIDGET
// ═══════════════════════════════════════════════════════════════════════════════

class HealthInsightsSection extends ConsumerWidget {
  final void Function(String) onAskAmina;
  const HealthInsightsSection({super.key, required this.onAskAmina});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s          = ref.watch(healthInsightsProvider);
    final latest     = ref.watch(latestVitalsProvider);
    final allVitals  = ref.watch(vitalsProvider);
    final hasGlucose = allVitals.any((e) => e.glucose.isNotEmpty);
    final hasBp      = allVitals.any((e) => e.bloodPressure.isNotEmpty);
    final hasMood    = allVitals.any((e) => e.mood.isNotEmpty);
    final hasData    = hasGlucose || hasBp || hasMood;

    final cs     = Theme.of(context).colorScheme;
    final amina  = Theme.of(context).extension<AminaColors>()!;
    final isDark = cs.brightness == Brightness.dark;

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 20),
      decoration: BoxDecoration(
        color:        cs.surface,
        borderRadius: BorderRadius.circular(28),
        border:       Border.all(color: amina.cardBorder),
        boxShadow: [
          BoxShadow(color: amina.sageGlow, blurRadius: 24, offset: Offset.zero),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [

          // ── Header ────────────────────────────────────────────────────
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
            child: Row(
              children: [
                const Text('💡', style: TextStyle(fontSize: 20)),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Health Insights',
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
                        'Powered by Amina AI',
                        style: TextStyle(
                          color:      cs.onSurfaceVariant,
                          fontSize:   12,
                          fontFamily: 'Inter',
                        ),
                      ),
                    ],
                  ),
                ),
                _LiveBadge(cs: cs),
              ],
            ),
          ),

          if (!hasData) ...[
            // ── Empty state ───────────────────────────────────────────
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 20, 20, 24),
              child: Column(
                children: [
                  Icon(Icons.monitor_heart_outlined,
                      color: cs.onSurfaceVariant.withValues(alpha: 0.4),
                      size: 40),
                  const SizedBox(height: 12),
                  Text(
                    'No readings logged yet',
                    style: TextStyle(
                      color:      cs.onSurface,
                      fontSize:   15,
                      fontWeight: FontWeight.w700,
                      fontFamily: 'Inter',
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'Use the "Log Today" card to record your\nglucose and blood pressure.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color:      cs.onSurfaceVariant,
                      fontSize:   13,
                      fontFamily: 'Inter',
                      height:     1.45,
                    ),
                  ),
                ],
              ),
            ),
          ] else ...[
            // ── Section label + divider ───────────────────────────────
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 10),
              child: Row(
                children: [
                  Text(
                    "TODAY'S READINGS",
                    style: TextStyle(
                      color:         cs.onSurfaceVariant,
                      fontSize:      10.5,
                      fontWeight:    FontWeight.w700,
                      letterSpacing: 1.2,
                      fontFamily:    'Inter',
                    ),
                  ),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.only(left: 12),
                      child: Divider(color: amina.divider, height: 1),
                    ),
                  ),
                ],
              ),
            ),

            // ── Bento pair: Glucose | Heart Score ────────────────────
            if (hasGlucose || hasBp) ...[
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: IntrinsicHeight(
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      if (hasGlucose)
                        Expanded(
                          child: _MetricCard(
                            icon:     Icons.water_drop_rounded,
                            label:    'Glucose Spikes',
                            value:    s.glucose.value.toStringAsFixed(0),
                            unit:     'mg/dL',
                            severity: s.glucose.severity,
                            trend:    s.glucose.weekTrend,
                            cs:       cs,
                            isDark:   isDark,
                            onTap:    () => onAskAmina(
                              'My glucose is ${s.glucose.value.toStringAsFixed(0)} mg/dL. '
                              'What does this mean and how can I improve it?'),
                          ),
                        ),
                      if (hasGlucose && hasBp)
                        const SizedBox(width: 10),
                      if (hasBp)
                        Expanded(
                          child: _MetricCard(
                            icon:     Icons.favorite_rounded,
                            label:    'Heart Score',
                            value:    '${s.systolic.value.toStringAsFixed(0)}/'
                                      '${s.diastolic.value.toStringAsFixed(0)}',
                            unit:     'mmHg',
                            severity: s.systolic.severity,
                            trend:    s.systolic.weekTrend,
                            cs:       cs,
                            isDark:   isDark,
                            onTap:    () => onAskAmina(
                              'My BP is ${s.systolic.value.toStringAsFixed(0)}/'
                              '${s.diastolic.value.toStringAsFixed(0)} mmHg. '
                              'How can I lower it naturally?'),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 10),
            ],

            // ── AI Insight card ───────────────────────────────────────
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              child: _AiInsightCard(
                cs:         cs,
                isDark:     isDark,
                latest:     latest,
                moodTrend:  s.moodTrend,
                latestMood: s.latestMood,
                onTap:  () => onAskAmina(
                    'Based on my latest readings — glucose ${latest?.glucose.isNotEmpty == true ? "${latest!.glucose} mg/dL" : "not logged"}, '
                    'BP ${latest?.bloodPressure.isNotEmpty == true ? latest!.bloodPressure : "not logged"}, '
                    'mood ${s.latestMood.isNotEmpty ? s.latestMood : "not logged"} — '
                    'what health advice do you have for me today?'),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LIVE BADGE
// ═══════════════════════════════════════════════════════════════════════════════

class _LiveBadge extends StatelessWidget {
  final ColorScheme cs;
  const _LiveBadge({required this.cs});

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color:        cs.primaryContainer,
          borderRadius: BorderRadius.circular(20),
          border:       Border.all(color: cs.primary.withValues(alpha: 0.40)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width:  6,
              height: 6,
              decoration: BoxDecoration(color: cs.primary, shape: BoxShape.circle),
            ),
            const SizedBox(width: 5),
            Text(
              'Live',
              style: TextStyle(
                color:      cs.primary,
                fontSize:   11,
                fontWeight: FontWeight.w700,
                fontFamily: 'Inter',
              ),
            ),
          ],
        ),
      );
}

// ═══════════════════════════════════════════════════════════════════════════════
// METRIC CARD  (half-width bento tile)
// ═══════════════════════════════════════════════════════════════════════════════

class _MetricCard extends StatelessWidget {
  final IconData        icon;
  final String          label;
  final String          value;
  final String          unit;
  final InsightSeverity severity;
  final List<double>    trend;
  final ColorScheme     cs;
  final bool            isDark;
  final VoidCallback    onTap;

  const _MetricCard({
    required this.icon,
    required this.label,
    required this.value,
    required this.unit,
    required this.severity,
    required this.trend,
    required this.cs,
    required this.isDark,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final color = _severityColor(severity, cs);

    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          // Light: flat tinted fill so the card reads clearly on white.
          // Dark:  gradient for a warm glow against charcoal.
          gradient: isDark
              ? LinearGradient(
                  begin:  Alignment.topLeft,
                  end:    Alignment.bottomRight,
                  colors: [cs.surface, color.withValues(alpha: 0.10)],
                )
              : null,
          color: isDark ? null : color.withValues(alpha: 0.07),
          borderRadius: BorderRadius.circular(20),
          border:       Border.all(color: color.withValues(alpha: 0.35)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [

            // Icon circle + label
            Row(
              children: [
                Container(
                  width:  32,
                  height: 32,
                  decoration: BoxDecoration(
                    color:  color.withValues(alpha: 0.18),
                    shape:  BoxShape.circle,
                    border: Border.all(color: color.withValues(alpha: 0.30)),
                  ),
                  child: Icon(icon, color: color, size: 15),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    label,
                    style: TextStyle(
                      color:      cs.onSurfaceVariant,
                      fontSize:   10.5,
                      fontWeight: FontWeight.w600,
                      fontFamily: 'Inter',
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),

            const SizedBox(height: 10),

            // Primary metric value — senior-accessible 28 sp bold.
            Text(
              value,
              style: TextStyle(
                color:      color,
                fontSize:   28,
                fontWeight: FontWeight.w900,
                fontFamily: 'Inter',
                height:     1.0,
              ),
            ),
            Text(
              unit,
              style: TextStyle(
                color:      cs.onSurfaceVariant,
                fontSize:   10.5,
                fontFamily: 'Inter',
              ),
            ),

            const SizedBox(height: 10),

            // Sparkline — ringColor blends the endpoint dot with the card.
            SizedBox(
              height: 36,
              child: CustomPaint(
                size:    const Size(double.infinity, 36),
                painter: _SparklinePainter(
                  data:      trend,
                  color:     color,
                  ringColor: cs.surface,
                ),
              ),
            ),

            const SizedBox(height: 10),

            // Status badge + Ask link
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                _SeverityBadge(severity: severity, color: color),
                _AskLink(color: color, onTap: onTap),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

// ── Severity badge ────────────────────────────────────────────────────────────

class _SeverityBadge extends StatelessWidget {
  final InsightSeverity severity;
  final Color           color;
  const _SeverityBadge({required this.severity, required this.color});

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
        decoration: BoxDecoration(
          color:        color.withValues(alpha: 0.14),
          borderRadius: BorderRadius.circular(8),
          border:       Border.all(color: color.withValues(alpha: 0.35)),
        ),
        child: Text(
          severity.badge,
          style: TextStyle(
            color:      color,
            fontSize:   9.5,
            fontWeight: FontWeight.w700,
            fontFamily: 'Inter',
          ),
        ),
      );
}

// ── Ask chevron link ──────────────────────────────────────────────────────────

class _AskLink extends StatelessWidget {
  final Color        color;
  final VoidCallback onTap;
  const _AskLink({required this.color, required this.onTap});

  @override
  Widget build(BuildContext context) => GestureDetector(
        onTap: onTap,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'Ask',
              style: TextStyle(
                color:      color.withValues(alpha: 0.85),
                fontSize:   11,
                fontWeight: FontWeight.w600,
                fontFamily: 'Inter',
              ),
            ),
            Icon(Icons.arrow_forward_ios_rounded,
                color: color.withValues(alpha: 0.70), size: 10),
          ],
        ),
      );
}

// ═══════════════════════════════════════════════════════════════════════════════
// AI INSIGHT CARD  (full-width)
//
// _kAiViolet is a fixed semantic colour — category identity (AI), same token
// used in care_plan_sheet.dart.  Tint alphas adapt to mode so the card looks
// right on both white and charcoal surfaces.
// ═══════════════════════════════════════════════════════════════════════════════

class _AiInsightCard extends StatelessWidget {
  final ColorScheme  cs;
  final bool         isDark;
  final VitalsEntry? latest;
  final List<double> moodTrend;
  final String       latestMood;
  final VoidCallback onTap;
  const _AiInsightCard({
    required this.cs,
    required this.isDark,
    required this.latest,
    required this.moodTrend,
    required this.latestMood,
    required this.onTap,
  });

  static const _moodLabels = ['Unwell', 'Low', 'Okay', 'Good', 'Great'];

  String get _moodEmoji => switch (latestMood) {
    'Great'  => '😊',
    'Good'   => '🙂',
    'Okay'   => '😐',
    'Low'    => '😔',
    'Unwell' => '😣',
    _        => '💫',
  };

  @override
  Widget build(BuildContext context) => GestureDetector(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            gradient: isDark
                ? LinearGradient(
                    colors: [cs.surface, _kAiViolet.withValues(alpha: 0.18)],
                    begin: Alignment.centerLeft,
                    end:   Alignment.centerRight,
                  )
                : null,
            color: isDark ? null : _kAiViolet.withValues(alpha: 0.07),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(
                color: _kAiViolet.withValues(alpha: isDark ? 0.40 : 0.25)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // ── Top row: icon + text + Ask pill ──────────────────────
              Row(
                children: [
                  Container(
                    width:  48,
                    height: 48,
                    decoration: BoxDecoration(
                      color:  _kAiViolet.withValues(alpha: 0.18),
                      shape:  BoxShape.circle,
                      border: Border.all(
                          color: _kAiViolet.withValues(alpha: 0.40)),
                    ),
                    child: Center(
                      child: Text(
                        _moodEmoji,
                        style: const TextStyle(fontSize: 22),
                      ),
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          latestMood.isNotEmpty
                              ? 'Feeling ${latestMood.toLowerCase()} lately'
                              : 'Ask Amina about your readings',
                          style: TextStyle(
                            color:      cs.onSurface,
                            fontSize:   14,
                            fontWeight: FontWeight.w700,
                            fontFamily: 'Inter',
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          latest?.symptoms.isNotEmpty == true
                              ? 'Symptoms: ${latest!.symptoms.take(3).join(", ")}.'
                              : 'Tap to get personalised health advice.',
                          style: TextStyle(
                            color:      cs.onSurfaceVariant,
                            fontSize:   11.5,
                            fontFamily: 'Inter',
                            height:     1.35,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 10),
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 12, vertical: 8),
                    decoration: BoxDecoration(
                      color:        _kAiViolet.withValues(
                          alpha: isDark ? 0.28 : 0.12),
                      borderRadius: BorderRadius.circular(16),
                      border:       Border.all(
                          color: _kAiViolet.withValues(
                              alpha: isDark ? 0.55 : 0.35)),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          'Ask',
                          style: TextStyle(
                            color:      _kAiViolet,
                            fontSize:   12,
                            fontWeight: FontWeight.w700,
                            fontFamily: 'Inter',
                          ),
                        ),
                        const SizedBox(width: 4),
                        Icon(Icons.arrow_forward_ios_rounded,
                            color: _kAiViolet.withValues(alpha: 0.80),
                            size: 10),
                      ],
                    ),
                  ),
                ],
              ),

              // ── Mood sparkline (only when there's meaningful history) ─
              if (moodTrend.any((v) => v > 0)) ...[
                const SizedBox(height: 12),
                // Y-axis labels + sparkline
                Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    // Min/max labels
                    Column(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('😊',
                            style: const TextStyle(fontSize: 11)),
                        const SizedBox(height: 22),
                        Text('😣',
                            style: const TextStyle(fontSize: 11)),
                      ],
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: SizedBox(
                        height: 44,
                        child: CustomPaint(
                          size: const Size(double.infinity, 44),
                          painter: _SparklinePainter(
                            data:      moodTrend,
                            color:     _kAiViolet,
                            ringColor: cs.surface,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    // Current mood label
                    Text(
                      latestMood,
                      style: TextStyle(
                        color:      _kAiViolet,
                        fontSize:   11,
                        fontWeight: FontWeight.w700,
                        fontFamily: 'Inter',
                      ),
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
      );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SPARKLINE PAINTER
// ═══════════════════════════════════════════════════════════════════════════════

class _SparklinePainter extends CustomPainter {
  final List<double> data;
  final Color        color;
  /// Card surface colour — used for the endpoint dot ring so it blends with
  /// the card background in both light (white) and dark (charcoal) modes.
  /// Replaces the old hardcoded Colors.white.
  final Color        ringColor;

  const _SparklinePainter({
    required this.data,
    required this.color,
    required this.ringColor,
  });

  @override
  void paint(Canvas canvas, Size size) {
    if (data.length < 2) return;

    final minV  = data.reduce(math.min);
    final maxV  = data.reduce(math.max);
    final range = maxV - minV;

    double px(int i)    => size.width * i / (data.length - 1);
    double py(double v) =>
        range > 0 ? size.height * (1 - (v - minV) / range) : size.height / 2;

    // Gradient fill below line
    final fill = Path()..moveTo(px(0), py(data[0]));
    for (var i = 1; i < data.length; i++) {
      final mx = (px(i - 1) + px(i)) / 2;
      fill.cubicTo(mx, py(data[i - 1]), mx, py(data[i]), px(i), py(data[i]));
    }
    fill
      ..lineTo(px(data.length - 1), size.height)
      ..lineTo(0, size.height)
      ..close();
    canvas.drawPath(fill, Paint()..color = color.withValues(alpha: 0.12));

    // Cubic line
    final line = Path()..moveTo(px(0), py(data[0]));
    for (var i = 1; i < data.length; i++) {
      final mx = (px(i - 1) + px(i)) / 2;
      line.cubicTo(mx, py(data[i - 1]), mx, py(data[i]), px(i), py(data[i]));
    }
    canvas.drawPath(
      line,
      Paint()
        ..style       = PaintingStyle.stroke
        ..strokeWidth = 1.8
        ..strokeCap   = StrokeCap.round
        ..color       = color,
    );

    // Endpoint dot — outer ring in card's surface colour, inner in accent.
    // Using two filled circles avoids a visible seam from stroke-based ring.
    final ex = px(data.length - 1);
    final ey = py(data.last);
    canvas.drawCircle(Offset(ex, ey), 5.0,
        Paint()..color = ringColor.withValues(alpha: 0.85));
    canvas.drawCircle(Offset(ex, ey), 3.2,
        Paint()..color = color);
  }

  @override
  bool shouldRepaint(covariant _SparklinePainter old) =>
      old.data      != data      ||
      old.color     != color     ||
      old.ringColor != ringColor;
}
