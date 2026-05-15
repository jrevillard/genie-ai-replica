import 'dart:math' as math;
import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/theme/app_theme.dart';
import '../../data/models/daily_health_record.dart';
import '../providers/health_calendar_provider.dart';
import 'health_tracker_calendar.dart';

// ─── Metric enum ──────────────────────────────────────────────────────────────

enum HealthTrendMetric { bp, glucose, mood }

// ─── Semantic metric colours — data identity, fixed across both modes ──────────
//
// Same rule as category colours in care_plan_sheet.dart: these are chart-legend
// identifiers, not UI-state colours.  They must NOT adapt to theme.

const _kBpBlue       = Color(0xFF3B82F6);  // BP      — blue
const _kGlucoseGreen = Color(0xFF10B981);  // Glucose — emerald
const _kMoodPurple   = Color(0xFFA78BFA);  // Mood    — lavender

// ─── Provider ─────────────────────────────────────────────────────────────────

final _selectedMetricProvider =
    StateProvider<HealthTrendMetric>((_) => HealthTrendMetric.bp);

// ─── Mock data generator ──────────────────────────────────────────────────────

class TrendsMockDataGenerator {
  TrendsMockDataGenerator._();

  static final _rng = math.Random(9999);

  static Map<String, DailyHealthRecord> generate() {
    final now    = DateTime.now();
    final today  = DateTime(now.year, now.month, now.day);
    final result = <String, DailyHealthRecord>{};

    for (var i = 29; i >= 0; i--) {
      final date     = today.subtract(Duration(days: i));
      final progress = (29 - i) / 29;

      final sysBP  = (145 - progress * 25 + (_rng.nextDouble() - 0.5) * 14)
          .round().clamp(100, 165);
      final diasBP = (88  - progress * 8  + (_rng.nextDouble() - 0.5) * 8)
          .round().clamp(60, 105);
      final gluc      = (165 - progress * 55 + (_rng.nextDouble() - 0.5) * 22)
          .clamp(80.0, 200.0);
      final moodBase  = (1.5 + progress * 2.0).clamp(0.0, 4.0);
      final moodIndex = (moodBase + (_rng.nextDouble() - 0.4))
          .round().clamp(0, 4);

      result[DailyHealthRecord.keyFor(date)] = DailyHealthRecord(
        date:    date,
        glucose: double.parse(gluc.toStringAsFixed(1)),
        bp:      BloodPressure(systolic: sysBP, diastolic: diasBP),
        mood:    MoodLevel.values[moodIndex],
      );
    }

    return result;
  }
}

// ─── Spot builder ─────────────────────────────────────────────────────────────

List<FlSpot> _buildSpots(
  Map<String, DailyHealthRecord> live,
  Map<String, DailyHealthRecord> mock,
  HealthTrendMetric metric,
) {
  final now   = DateTime.now();
  final today = DateTime(now.year, now.month, now.day);
  final spots = <FlSpot>[];

  for (var i = 29; i >= 0; i--) {
    final date = today.subtract(Duration(days: i));
    final key     = DailyHealthRecord.keyFor(date);
    final liveRec = live[key];
    final mockRec = mock[key];
    if (liveRec == null && mockRec == null) continue;

    final x = (29 - i).toDouble();
    final double? y = switch (metric) {
      HealthTrendMetric.bp      => liveRec?.bp?.systolic.toDouble()  ?? mockRec?.bp?.systolic.toDouble(),
      HealthTrendMetric.glucose => liveRec?.glucose                   ?? mockRec?.glucose,
      HealthTrendMetric.mood    => liveRec?.mood?.index.toDouble()    ?? mockRec?.mood?.index.toDouble(),
    };

    if (y != null) spots.add(FlSpot(x, y));
  }

  return spots;
}

/// Ensures at least 2 FlSpots so fl_chart renders a line instead of a dot.
/// Anchors a flat segment from x=0 using the earliest real point's y-value,
/// matching the Today tab behaviour where a single value shows as a flat line.
List<FlSpot> _extendToLine(List<FlSpot> spots) {
  if (spots.length <= 1) {
    if (spots.isEmpty) return spots;
    return [FlSpot(0, spots.first.y), spots.first];
  }
  if (spots.first.x > 0) {
    return [FlSpot(0, spots.first.y), ...spots];
  }
  return spots;
}

// ─── Insight computation ──────────────────────────────────────────────────────

typedef _Insight = ({String label, bool? improving, String value});

_Insight _computeInsight(List<FlSpot> spots, HealthTrendMetric metric) {
  String fmt(double v) => switch (metric) {
        HealthTrendMetric.bp      => '${v.round()} mmHg',
        HealthTrendMetric.glucose => '${v.round()} mg/dL',
        HealthTrendMetric.mood    =>
            const ['Terrible', 'Bad', 'Okay', 'Good', 'Excellent']
                [v.round().clamp(0, 4)],
      };

  if (spots.isEmpty) return (label: 'No data yet', improving: null, value: '—');

  final last = spots.last.y;
  if (spots.length < 4) {
    return (label: 'Keep logging!', improving: null, value: fmt(last));
  }

  final half      = spots.length ~/ 2;
  final earlyAvg  = spots.sublist(0, half).fold(0.0, (s, p) => s + p.y) / half;
  final recentAvg = spots.sublist(half).fold(0.0, (s, p) => s + p.y) /
      (spots.length - half);
  final pct = ((recentAvg - earlyAvg) / earlyAvg * 100).round().abs();

  // For BP and glucose, lower is better; for mood, higher is better.
  final improving = metric == HealthTrendMetric.mood
      ? recentAvg > earlyAvg
      : recentAvg < earlyAvg;

  final trend = pct < 3 ? 'Stable' : improving ? 'Improving $pct%' : 'Up $pct%';
  return (label: trend, improving: improving, value: fmt(last));
}

// ─── Color / icon / label helpers ─────────────────────────────────────────────

Color _metricColor(HealthTrendMetric m) => switch (m) {
      HealthTrendMetric.bp      => _kBpBlue,
      HealthTrendMetric.glucose => _kGlucoseGreen,
      HealthTrendMetric.mood    => _kMoodPurple,
    };

IconData _metricIcon(HealthTrendMetric m) => switch (m) {
      HealthTrendMetric.bp      => Icons.favorite_rounded,
      HealthTrendMetric.glucose => Icons.show_chart_rounded,
      HealthTrendMetric.mood    => Icons.mood_rounded,
    };

String _metricLabel(HealthTrendMetric m) => switch (m) {
      HealthTrendMetric.bp      => 'BP',
      HealthTrendMetric.glucose => 'Glucose',
      HealthTrendMetric.mood    => 'Mood',
    };

// ─── Insight arrow colour ─────────────────────────────────────────────────────
//
// Improving → cs.primary (sage green — positive signal already themed).
// Worsening → cs.error   (M3 error role — softer premium red, same as
//             health_insights_section.dart alert colour).

Color _arrowColor(bool? improving, ColorScheme cs) => improving == null
    ? cs.onSurfaceVariant
    : improving
        ? cs.primary
        : cs.error;

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC WIDGET
// ═══════════════════════════════════════════════════════════════════════════════

class HealthTrendsChart extends ConsumerStatefulWidget {
  /// When true the trends section collapses to a one-line summary.
  final bool collapsed;
  const HealthTrendsChart({super.key, this.collapsed = false});

  @override
  ConsumerState<HealthTrendsChart> createState() => _HealthTrendsChartState();
}

class _HealthTrendsChartState extends ConsumerState<HealthTrendsChart> {
  @override
  Widget build(BuildContext context) {
    final metric     = ref.watch(_selectedMetricProvider);
    final calState   = ref.watch(healthCalendarProvider);
    final vitalsLive = ref.watch(vitalsAsRecordsProvider);
    // Real data only — vitals (Today tab) + explicit calendar edits.
    // Per-field merge so a calendar edit with glucose=null does not erase
    // a glucose value already logged in the Today tab for the same day.
    final realData = mergeRecordsPerField(vitalsLive, calState.userRecords);
    final spots    = _buildSpots(realData, const {}, metric);
    // _extendToLine ensures fl_chart renders a line even with a single point,
    // anchoring a flat segment at x=0 with the earliest real value.
    // Insight is computed from raw spots (real-data count drives "Keep logging!").
    final dispSpots = _extendToLine(spots);
    final insight  = _computeInsight(spots, metric);
    final color    = _metricColor(metric);
    // ── Single theme read — propagated to every child ──────────────────
    final cs     = Theme.of(context).colorScheme;
    final amina  = Theme.of(context).extension<AminaColors>()!;
    final isDark = cs.brightness == Brightness.dark;

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 0),
      decoration: BoxDecoration(
        color:        cs.surface,
        borderRadius: BorderRadius.circular(24),
        border:       Border.all(color: amina.cardBorder),
        boxShadow: [
          // Metric-tinted glow — subtle category signal
          BoxShadow(
            color:      color.withValues(alpha: isDark ? 0.14 : 0.08),
            blurRadius: 22,
            offset:     const Offset(0, 6),
          ),
          // Base ambient shadow — themed
          BoxShadow(
            color:      cs.shadow.withValues(alpha: isDark ? 0.30 : 0.06),
            blurRadius: 12,
            offset:     const Offset(0, 3),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // ── Trends section — collapses on scroll ──────────────────────
            AnimatedSize(
              duration: const Duration(milliseconds: 320),
              curve:    Curves.easeInOut,
              child: widget.collapsed
                  ? _CollapsedSummary(
                      metric:  metric,
                      color:   color,
                      insight: insight,
                      cs:      cs,
                    )
                  : _ExpandedTrends(
                      metric:         metric,
                      color:          color,
                      spots:          dispSpots,
                      insight:        insight,
                      cs:             cs,
                      amina:          amina,
                      isDark:         isDark,
                      onMetricChange: (m) =>
                          ref.read(_selectedMetricProvider.notifier).state = m,
                    ),
            ),

            // ── Divider between chart and fused calendar ──────────────────
            Divider(height: 1, thickness: 1, color: amina.divider),

            // ── Fused calendar — reads its own theme ──────────────────────
            const HealthTrackerCalendar(showCard: false),
          ],
        ),
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// COLLAPSED SUMMARY — one-liner shown when the user scrolls past the chart
// ═══════════════════════════════════════════════════════════════════════════════

class _CollapsedSummary extends StatelessWidget {
  final HealthTrendMetric metric;
  final Color             color;
  final _Insight          insight;
  final ColorScheme       cs;
  const _CollapsedSummary({
    required this.metric,
    required this.color,
    required this.insight,
    required this.cs,
  });

  @override
  Widget build(BuildContext context) {
    final arrowC = _arrowColor(insight.improving, cs);
    final arrow  = insight.improving == null
        ? '·'
        : insight.improving! ? '↓' : '↑';

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 11),
      child: Row(
        children: [
          // Metric glow dot — semantic category colour
          Container(
            width:  8,
            height: 8,
            decoration: BoxDecoration(
              color:  color,
              shape:  BoxShape.circle,
              boxShadow: [
                BoxShadow(color: color.withValues(alpha: 0.55), blurRadius: 6),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Text(
            _metricLabel(metric),
            style: TextStyle(
              color:      color,
              fontSize:   13,
              fontWeight: FontWeight.w700,
              fontFamily: 'Inter',
            ),
          ),
          const SizedBox(width: 6),
          Text(
            insight.value,
            style: TextStyle(
              color:      cs.onSurface,
              fontSize:   13,
              fontWeight: FontWeight.w600,
              fontFamily: 'Inter',
            ),
          ),
          const SizedBox(width: 6),
          Text(
            arrow,
            style: TextStyle(
              color:      arrowC,
              fontSize:   13,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(width: 4),
          Text(
            insight.label,
            style: TextStyle(
              color:      arrowC.withValues(alpha: 0.80),
              fontSize:   12,
              fontWeight: FontWeight.w500,
              fontFamily: 'Inter',
            ),
          ),
          const Spacer(),
          Icon(Icons.keyboard_arrow_down_rounded,
              color: cs.onSurfaceVariant, size: 18),
        ],
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPANDED TRENDS — compact sparkline + chips layout
// ═══════════════════════════════════════════════════════════════════════════════

class _ExpandedTrends extends StatelessWidget {
  final HealthTrendMetric               metric;
  final Color                           color;
  final List<FlSpot>                    spots;
  final _Insight                        insight;
  final ColorScheme                     cs;
  final AminaColors                     amina;
  final bool                            isDark;
  final ValueChanged<HealthTrendMetric> onMetricChange;
  const _ExpandedTrends({
    required this.metric,
    required this.color,
    required this.spots,
    required this.insight,
    required this.cs,
    required this.amina,
    required this.isDark,
    required this.onMetricChange,
  });

  @override
  Widget build(BuildContext context) {
    final insightColor = _arrowColor(insight.improving, cs);
    final arrowStr = insight.improving == null
        ? ''
        : insight.improving! ? ' ↓' : ' ↑';

    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // ── Header row ────────────────────────────────────────────────
          Row(
            children: [
              Text(
                'Health Insights',
                style: TextStyle(
                  color:         cs.onSurface,
                  fontSize:      14,
                  fontWeight:    FontWeight.w800,
                  fontFamily:    'Inter',
                  letterSpacing: -0.2,
                ),
              ),
              const SizedBox(width: 8),
              // Active metric glow dot
              Container(
                width:  6,
                height: 6,
                decoration: BoxDecoration(
                  color:  color,
                  shape:  BoxShape.circle,
                  boxShadow: [
                    BoxShadow(
                        color: color.withValues(alpha: 0.60), blurRadius: 6),
                  ],
                ),
              ),
              const Spacer(),
              // Inline insight badge
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color:        insightColor.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(20),
                  border:       Border.all(
                      color: insightColor.withValues(alpha: 0.30)),
                ),
                child: Text(
                  '${insight.value}$arrowStr',
                  style: TextStyle(
                    color:      insightColor,
                    fontSize:   11,
                    fontWeight: FontWeight.w700,
                    fontFamily: 'Inter',
                  ),
                ),
              ),
            ],
          ),

          const SizedBox(height: 10),

          // ── Metric chips ──────────────────────────────────────────────
          _MetricChips(
            selected: metric,
            onSelect: onMetricChange,
            cs:       cs,
            amina:    amina,
          ),

          const SizedBox(height: 10),

          // ── Sparkline ─────────────────────────────────────────────────
          _Sparkline(spots: spots, metric: metric, color: color, cs: cs),

          const SizedBox(height: 6),

          // ── Footer label ──────────────────────────────────────────────
          Text(
            '${_metricLabel(metric)} · ${insight.label} · last 30 days',
            style: TextStyle(
              color:      cs.onSurfaceVariant,
              fontSize:   10.5,
              fontFamily: 'Inter',
            ),
          ),
        ],
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// METRIC CHIPS — compact segmented control
// ═══════════════════════════════════════════════════════════════════════════════

class _MetricChips extends StatelessWidget {
  final HealthTrendMetric               selected;
  final ValueChanged<HealthTrendMetric> onSelect;
  final ColorScheme                     cs;
  final AminaColors                     amina;
  const _MetricChips({
    required this.selected,
    required this.onSelect,
    required this.cs,
    required this.amina,
  });

  @override
  Widget build(BuildContext context) => Container(
        height: 32,
        decoration: BoxDecoration(
          color:        amina.inputFill,
          borderRadius: BorderRadius.circular(10),
        ),
        child: Row(
          children: HealthTrendMetric.values.map((m) {
            final active = m == selected;
            final color  = _metricColor(m);
            return Expanded(
              child: GestureDetector(
                onTap:    () => onSelect(m),
                behavior: HitTestBehavior.opaque,
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 180),
                  margin: const EdgeInsets.all(3),
                  decoration: BoxDecoration(
                    // Active chip: tinted bg + coloured text — readable in
                    // both light and dark without needing a hardcoded white.
                    color:        active
                        ? color.withValues(alpha: 0.18)
                        : Colors.transparent,
                    borderRadius: BorderRadius.circular(7),
                    border: active
                        ? Border.all(color: color.withValues(alpha: 0.45))
                        : null,
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(
                        _metricIcon(m),
                        size:  12,
                        color: active ? color : cs.onSurfaceVariant,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        _metricLabel(m),
                        style: TextStyle(
                          fontSize:   11,
                          fontWeight: FontWeight.w700,
                          color:      active ? color : cs.onSurfaceVariant,
                          fontFamily: 'Inter',
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            );
          }).toList(),
        ),
      );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SPARKLINE — minimal 70px line chart, no grid, no axes
// ═══════════════════════════════════════════════════════════════════════════════

class _Sparkline extends StatelessWidget {
  final List<FlSpot>      spots;
  final HealthTrendMetric metric;
  final Color             color;
  final ColorScheme       cs;
  const _Sparkline({
    required this.spots,
    required this.metric,
    required this.color,
    required this.cs,
  });

  // Default comfortable ranges — expanded automatically when real data exceeds them.
  static const _kDefaultRanges = {
    HealthTrendMetric.bp:      (85.0,  165.0),
    HealthTrendMetric.glucose: (65.0,  210.0),
    HealthTrendMetric.mood:    (-0.3,    4.3),
  };

  (double min, double max) get _yRange {
    final (defMin, defMax) = _kDefaultRanges[metric]!;
    // Mood uses a fixed ordinal scale — never expand it.
    if (spots.isEmpty || metric == HealthTrendMetric.mood) {
      return (defMin, defMax);
    }
    final dataMin = spots.map((s) => s.y).reduce(math.min);
    final dataMax = spots.map((s) => s.y).reduce(math.max);
    // Add 12 % headroom above the peak and 5 % floor below the trough.
    final span    = defMax - defMin;
    return (
      math.min(dataMin - span * 0.05, defMin),
      math.max(dataMax * 1.12,        defMax),
    );
  }

  @override
  Widget build(BuildContext context) {
    final (minY, maxY) = _yRange;

    if (spots.isEmpty) {
      return SizedBox(
        height: 70,
        child: Center(
          child: Text(
            'Start logging to see your trend',
            style: TextStyle(
              color:      cs.onSurfaceVariant,
              fontSize:   12,
              fontFamily: 'Inter',
            ),
          ),
        ),
      );
    }

    return SizedBox(
      height: 70,
      child: LineChart(
        duration: const Duration(milliseconds: 300),
        LineChartData(
          minX: 0,   maxX: 29,
          minY: minY, maxY: maxY,
          gridData:   const FlGridData(show: false),
          borderData: FlBorderData(show: false),
          titlesData: const FlTitlesData(
            leftTitles:   AxisTitles(sideTitles: SideTitles(showTitles: false)),
            rightTitles:  AxisTitles(sideTitles: SideTitles(showTitles: false)),
            topTitles:    AxisTitles(sideTitles: SideTitles(showTitles: false)),
            bottomTitles: AxisTitles(sideTitles: SideTitles(showTitles: false)),
          ),
          lineTouchData: const LineTouchData(enabled: false),
          lineBarsData: [
            LineChartBarData(
              spots:            spots,
              isCurved:         true,
              curveSmoothness:  0.40,
              color:            color,
              barWidth:         2.0,
              isStrokeCapRound: true,
              shadow: Shadow(
                color:      color.withValues(alpha: 0.40),
                blurRadius: 8,
              ),
              // Only the last dot is visible — endpoint indicator.
              dotData: FlDotData(
                show: true,
                getDotPainter: (spot, _, _, index) {
                  final isLast = index == spots.length - 1;
                  return FlDotCirclePainter(
                    radius:      isLast ? 3.5 : 0,
                    color:       isLast ? color : Colors.transparent,
                    strokeWidth: isLast ? 1.5 : 0,
                    // cs.surface blends the dot ring with the card bg
                    // in both light (white) and dark (charcoal) modes.
                    strokeColor: isLast ? cs.surface : Colors.transparent,
                  );
                },
              ),
              belowBarData: BarAreaData(
                show: true,
                gradient: LinearGradient(
                  begin:  Alignment.topCenter,
                  end:    Alignment.bottomCenter,
                  colors: [
                    color.withValues(alpha: 0.22),
                    color.withValues(alpha: 0.00),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
