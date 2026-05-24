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
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/providers/app_mode_provider.dart';
import '../../../../core/theme/app_theme.dart';
import '../providers/patient_health_provider.dart';

// ─── Clinical identity colours (kept hardcoded — not theme tokens) ────────────

const _kGood    = Color(0xFF059669);
const _kGoodBg  = Color(0xFFECFDF5);
const _kAlert   = Color(0xFFD97706);
const _kAlertBg = Color(0xFFFFFBEB);
const _kNone    = Color(0xFF9CA3AF);
const _kNoneBg  = Color(0xFFF9FAFB);
const _kCyan    = Color(0xFF0EA5E9);
const _kPink    = Color(0xFFEC4899);

// ─── Main screen ──────────────────────────────────────────────────────────────

class CaregiverHealthView extends ConsumerWidget {
  final CaredPatient? patient;
  const CaregiverHealthView({super.key, this.patient});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    final state = patient != null
        ? stateForCaredPatient(patient!)
        : ref.watch(patientHealthProvider);

    return Scaffold(
      backgroundColor: amina.scaffoldBg,
      body: CustomScrollView(
        physics: const BouncingScrollPhysics(),
        slivers: [
          // ── App bar ────────────────────────────────────────────────────────
          SliverAppBar(
            pinned:                 true,
            backgroundColor:        amina.scaffoldBg,
            elevation:              0,
            scrolledUnderElevation: 0,
            leading: IconButton(
              icon: Icon(Icons.arrow_back_ios_new_rounded,
                  color: cs.onSurface, size: 20),
              onPressed: () => Navigator.of(context).maybePop(),
            ),
            title: Text(
              'Health Overview',
              style: TextStyle(
                color:         cs.onSurface,
                fontSize:      17,
                fontWeight:    FontWeight.w700,
                letterSpacing: -0.2,
              ),
            ),
            centerTitle: true,
            actions: [
              Container(
                margin:  const EdgeInsets.only(right: 16, top: 10, bottom: 10),
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
                decoration: BoxDecoration(
                  color:        cs.primaryContainer,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: cs.primary.withValues(alpha: 0.35)),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.visibility_outlined, color: cs.primary, size: 12),
                    const SizedBox(width: 4),
                    Text(
                      'View Only',
                      style: TextStyle(
                        color:      cs.primary,
                        fontSize:   10.5,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),

          SliverToBoxAdapter(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SizedBox(height: 8),
                _PatientHeader(state: state),
                const SizedBox(height: 16),
                _StatusBanner(hasAlerts: state.hasCurrentAlerts),
                const SizedBox(height: 20),

                // ── Medication adherence ─────────────────────────────────
                if (state.meds.isNotEmpty) ...[
                  _SectionLabel(label: 'Medications Today',
                      icon: Icons.medication_rounded),
                  const SizedBox(height: 14),
                  _MedicationAdherenceCard(state: state),
                  const SizedBox(height: 28),
                ],

                // ── 7-day calendar ───────────────────────────────────────
                _SectionLabel(label: '7-Day Overview',
                    icon: Icons.calendar_month_rounded),
                const SizedBox(height: 14),
                _TrendCalendar(weekData: state.weekData),
                const SizedBox(height: 28),

                // ── Health insights chart ────────────────────────────────
                _HealthInsightsChart(state: state),
                const SizedBox(height: 28),

                // ── Symptom history ──────────────────────────────────────
                _SectionLabel(label: 'Symptom History',
                    icon: Icons.healing_rounded),
                const SizedBox(height: 14),
                _SymptomHistoryCard(weekData: state.weekData),
                const SizedBox(height: 28),

                // ── Trend insights ───────────────────────────────────────
                _TrendInsightCard(state: state),
                const SizedBox(height: 28),

                // ── Patient notes ────────────────────────────────────────
                if (state.notes.isNotEmpty) ...[
                  _SectionLabel(label: 'Patient Notes',
                      icon: Icons.chat_bubble_outline_rounded),
                  const SizedBox(height: 14),
                  _PatientNotesFeed(
                    notes:           state.notes,
                    patientInitials: state.patientInitials,
                    patientName:     state.patientName,
                  ),
                ],
                const SizedBox(height: 48),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Patient header ───────────────────────────────────────────────────────────

class _PatientHeader extends StatelessWidget {
  final PatientHealthState state;
  const _PatientHeader({required this.state});

  String _syncLabel() {
    final diff = DateTime.now().difference(state.lastSync);
    if (diff.inSeconds < 60)  return 'Just synced';
    if (diff.inMinutes < 60)  return 'Synced ${diff.inMinutes} min ago';
    if (diff.inHours   < 24)  return 'Synced ${diff.inHours}h ago';
    return 'Synced yesterday';
  }

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;

    return Container(
      margin:  const EdgeInsets.symmetric(horizontal: 20),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color:        cs.surface,
        borderRadius: BorderRadius.circular(26),
        border:       Border.all(color: amina.cardBorder),
        boxShadow: [
          BoxShadow(
            color:      cs.primary.withValues(alpha: 0.08),
            blurRadius: 24,
            offset:     const Offset(0, 6),
          ),
          BoxShadow(
            color:      Colors.black.withValues(alpha: 0.04),
            blurRadius: 8,
          ),
        ],
      ),
      child: Row(
        children: [
          // Avatar
          Container(
            width:  68,
            height: 68,
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFF3D9970), Color(0xFF1E6B4A)],
                begin:  Alignment.topLeft,
                end:    Alignment.bottomRight,
              ),
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color:      const Color(0xFF3D9970).withValues(alpha: 0.40),
                  blurRadius: 14,
                  offset:     const Offset(0, 5),
                ),
              ],
            ),
            child: Center(
              child: Text(
                state.patientInitials,
                style: const TextStyle(
                  color:         Colors.white,
                  fontSize:      23,
                  fontWeight:    FontWeight.w800,
                  letterSpacing: 0.5,
                ),
              ),
            ),
          ),

          const SizedBox(width: 16),

          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  state.patientName,
                  style: TextStyle(
                    fontSize:      21,
                    fontWeight:    FontWeight.w800,
                    color:         cs.onSurface,
                    letterSpacing: -0.4,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  'Under your care',
                  style: TextStyle(fontSize: 12.5, color: cs.onSurfaceVariant),
                ),
                const SizedBox(height: 9),
                Row(
                  children: [
                    Container(
                      width: 7, height: 7,
                      decoration: const BoxDecoration(
                          color: _kGood, shape: BoxShape.circle),
                    ),
                    const SizedBox(width: 6),
                    Text(
                      _syncLabel(),
                      style: const TextStyle(
                        fontSize:   12,
                        color:      _kGood,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),

          // Heart status icon
          Container(
            width:  46,
            height: 46,
            decoration: BoxDecoration(
              color:  _kGoodBg,
              shape:  BoxShape.circle,
              border: Border.all(color: _kGood.withValues(alpha: 0.30)),
            ),
            child: const Icon(Icons.favorite_rounded, color: _kGood, size: 22),
          ),
        ],
      ),
    );
  }
}

// ─── Status banner ────────────────────────────────────────────────────────────

class _StatusBanner extends StatelessWidget {
  final bool hasAlerts;
  const _StatusBanner({required this.hasAlerts});

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 350),
      margin:  const EdgeInsets.symmetric(horizontal: 20),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 13),
      decoration: BoxDecoration(
        color: hasAlerts ? _kAlertBg : _kGoodBg,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: hasAlerts
              ? _kAlert.withValues(alpha: 0.40)
              : _kGood.withValues(alpha: 0.35),
        ),
      ),
      child: Row(
        children: [
          Icon(
            hasAlerts ? Icons.warning_amber_rounded : Icons.check_circle_rounded,
            color: hasAlerts ? _kAlert : _kGood,
            size:  22,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              hasAlerts
                  ? 'One or more readings need attention — check below.'
                  : 'All readings look stable today 🌿  Everything is under control.',
              style: TextStyle(
                fontSize:   13,
                fontWeight: FontWeight.w600,
                color:      hasAlerts ? _kAlert : _kGood,
                height:     1.4,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Section label ────────────────────────────────────────────────────────────

class _SectionLabel extends StatelessWidget {
  final String   label;
  final IconData icon;
  const _SectionLabel({required this.label, required this.icon});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20),
      child: Row(
        children: [
          Container(
            width:  28,
            height: 28,
            decoration: BoxDecoration(
              color: cs.primaryContainer,
              shape: BoxShape.circle,
            ),
            child: Icon(icon, color: cs.primary, size: 14),
          ),
          const SizedBox(width: 9),
          Text(
            label,
            style: TextStyle(
              fontSize:      15.5,
              fontWeight:    FontWeight.w800,
              color:         cs.onSurface,
              letterSpacing: -0.2,
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Trend calendar ───────────────────────────────────────────────────────────

class _TrendCalendar extends StatelessWidget {
  final List<PatientDayData> weekData;
  const _TrendCalendar({required this.weekData});

  @override
  Widget build(BuildContext context) {
    final today = DateTime.now();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          height: 106,
          child: ListView.builder(
            scrollDirection: Axis.horizontal,
            padding:         const EdgeInsets.symmetric(horizontal: 20),
            physics:         const BouncingScrollPhysics(),
            itemCount:       weekData.length,
            itemBuilder: (_, i) {
              final day     = weekData[i];
              final isToday = day.date.day   == today.day &&
                              day.date.month == today.month;
              return Padding(
                padding: EdgeInsets.only(
                    right: i < weekData.length - 1 ? 10 : 0),
                child: _DayBubble(data: day, isToday: isToday),
              );
            },
          ),
        ),

        // Legend
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 0),
          child: Row(
            children: [
              _LegendDot(color: _kGood,  label: 'Stable'),
              const SizedBox(width: 16),
              _LegendDot(color: _kAlert, label: 'Alert'),
              const SizedBox(width: 16),
              _LegendDot(color: _kNone,  label: 'No data'),
            ],
          ),
        ),
      ],
    );
  }
}

class _LegendDot extends StatelessWidget {
  final Color  color;
  final String label;
  const _LegendDot({required this.color, required this.label});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 8, height: 8,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: 5),
        Text(
          label,
          style: TextStyle(
            fontSize:   11,
            color:      cs.onSurfaceVariant,
            fontWeight: FontWeight.w500,
          ),
        ),
      ],
    );
  }
}

class _DayBubble extends StatelessWidget {
  final PatientDayData data;
  final bool           isToday;
  const _DayBubble({required this.data, required this.isToday});

  static const _dayLabels = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

  Color get _ringColor {
    if (!data.hasData)  return _kNone;
    if (data.hasAlerts) return _kAlert;
    return _kGood;
  }

  Color get _bgColor {
    if (!data.hasData)  return _kNoneBg;
    if (data.hasAlerts) return _kAlertBg;
    return _kGoodBg;
  }

  @override
  Widget build(BuildContext context) {
    final cs       = Theme.of(context).colorScheme;
    final dayLabel = _dayLabels[data.date.weekday - 1];

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // Weekday label
        Text(
          dayLabel,
          style: TextStyle(
            fontSize:   11,
            fontWeight: isToday ? FontWeight.w800 : FontWeight.w500,
            color:      isToday ? cs.primary : cs.onSurfaceVariant,
          ),
        ),
        const SizedBox(height: 6),

        // Bubble
        AnimatedContainer(
          duration: const Duration(milliseconds: 280),
          width:  isToday ? 62 : 56,
          height: isToday ? 62 : 56,
          decoration: BoxDecoration(
            color: isToday
                ? cs.primary.withValues(alpha: 0.10)
                : _bgColor,
            shape: BoxShape.circle,
            border: Border.all(
              color: isToday
                  ? cs.primary
                  : _ringColor.withValues(alpha: 0.55),
              width: isToday ? 2.5 : 1.5,
            ),
            boxShadow: isToday
                ? [BoxShadow(
                    color:      cs.primary.withValues(alpha: 0.22),
                    blurRadius: 12,
                  )]
                : data.hasAlerts
                    ? [BoxShadow(
                        color:      _kAlert.withValues(alpha: 0.18),
                        blurRadius: 8,
                      )]
                    : null,
          ),
          child: Stack(
            alignment: Alignment.center,
            children: [
              Text(
                '${data.date.day}',
                style: TextStyle(
                  fontSize:   18,
                  fontWeight: FontWeight.w900,
                  color:      isToday ? cs.primary : _ringColor,
                  height:     1.0,
                ),
              ),
              if (data.symptoms.isNotEmpty)
                Positioned(
                  bottom: 8,
                  child: Container(
                    width: 5, height: 5,
                    decoration: const BoxDecoration(
                        color: _kAlert, shape: BoxShape.circle),
                  ),
                ),
            ],
          ),
        ),

        const SizedBox(height: 5),

        // Status dot
        Container(
          width: 5, height: 5,
          decoration: BoxDecoration(
            color: data.hasData ? _ringColor : Colors.transparent,
            shape: BoxShape.circle,
          ),
        ),
      ],
    );
  }
}

// ─── Health Insights chart (tabbed: BP / Glucose / Mood) ─────────────────────

class _HealthInsightsChart extends StatefulWidget {
  final PatientHealthState state;
  const _HealthInsightsChart({required this.state});

  @override
  State<_HealthInsightsChart> createState() => _HealthInsightsChartState();
}

class _HealthInsightsChartState extends State<_HealthInsightsChart> {
  int _tab = 0; // 0 = BP, 1 = Glucose, 2 = Mood

  // ── Per-tab data ────────────────────────────────────────────────────────────

  List<double> get _series => switch (_tab) {
        0 => widget.state.bpSystolicSeries,
        1 => widget.state.glucoseSeries,
        _ => _moodSeries,
      };

  List<double> get _moodSeries => widget.state.weekData
      .where((d) => d.mood != null)
      .map((d) => switch (d.mood!) {
            'Great'   => 5.0,
            'Good'    => 4.0,
            'Neutral' => 3.0,
            'Low'     => 2.0,
            'Anxious' => 1.0,
            _         => 3.0,
          })
      .toList();

  String get _currentChip {
    final l = widget.state.latestReadings;
    return switch (_tab) {
      0 => l?.bloodPressure != null ? '${l!.bloodPressure} mmHg' : '— mmHg',
      1 => l?.glucose       != null ? '${l!.glucose!.round()} mg/dL' : '— mg/dL',
      _ => l?.mood ?? 'No data',
    };
  }

  Color get _accentColor => switch (_tab) {
        0 => _kPink,
        1 => _kCyan,
        _ => const Color(0xFF8B5CF6),
      };

  String get _statusText {
    final l = widget.state.latestReadings;
    return switch (_tab) {
      0 => _bpStatus(l?.bloodPressure),
      1 => _glucoseStatus(l?.glucose),
      _ => l?.mood ?? 'Not logged',
    };
  }

  static String _bpStatus(String? bp) {
    if (bp == null) return 'No data';
    final sys = int.tryParse(bp.split('/').first.trim()) ?? 0;
    if (sys >= 140) return 'High — alert';
    if (sys >= 130) return 'Elevated';
    return 'Normal';
  }

  static String _glucoseStatus(double? g) {
    if (g == null) return 'No data';
    if (g >= 180)  return 'High — alert';
    if (g >= 100)  return 'Pre-diabetic';
    return 'Within range';
  }

  String get _footerLabel {
    final tabName = switch (_tab) { 0 => 'BP', 1 => 'Glucose', _ => 'Mood' };
    return '$tabName · $_statusText · last 30 days';
  }

  // ── Build ───────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20),
      child: Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color:        cs.surface,
          borderRadius: BorderRadius.circular(26),
          border:       Border.all(color: amina.cardBorder),
          boxShadow: [
            BoxShadow(
              color:      Colors.black.withValues(alpha: 0.05),
              blurRadius: 16,
              offset:     const Offset(0, 5),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [

            // ── Header row ────────────────────────────────────────────────
            Row(
              children: [
                // Live indicator dot
                Container(
                  width:  8,
                  height: 8,
                  decoration: BoxDecoration(
                    color:  _kGood,
                    shape:  BoxShape.circle,
                    boxShadow: [
                      BoxShadow(
                        color:      _kGood.withValues(alpha: 0.55),
                        blurRadius: 6,
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  'Health Insights',
                  style: TextStyle(
                    fontSize:      15,
                    fontWeight:    FontWeight.w800,
                    color:         cs.onSurface,
                    letterSpacing: -0.2,
                  ),
                ),
                const Spacer(),
                // Current reading chip
                AnimatedSwitcher(
                  duration: const Duration(milliseconds: 220),
                  child: Container(
                    key:     ValueKey(_tab),
                    padding: const EdgeInsets.symmetric(
                        horizontal: 10, vertical: 5),
                    decoration: BoxDecoration(
                      color:        _accentColor.withValues(alpha: 0.10),
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(
                          color: _accentColor.withValues(alpha: 0.30)),
                    ),
                    child: Text(
                      _currentChip,
                      style: TextStyle(
                        fontSize:   11.5,
                        fontWeight: FontWeight.w700,
                        color:      _accentColor,
                      ),
                    ),
                  ),
                ),
              ],
            ),

            const SizedBox(height: 16),

            // ── Tab row ───────────────────────────────────────────────────
            Row(
              children: [
                _ChartTab(
                  icon:     Icons.favorite_rounded,
                  label:    'BP',
                  selected: _tab == 0,
                  color:    _kPink,
                  onTap:    () => setState(() => _tab = 0),
                ),
                const SizedBox(width: 8),
                _ChartTab(
                  icon:     Icons.show_chart_rounded,
                  label:    'Glucose',
                  selected: _tab == 1,
                  color:    _kCyan,
                  onTap:    () => setState(() => _tab = 1),
                ),
                const SizedBox(width: 8),
                _ChartTab(
                  icon:     Icons.mood_rounded,
                  label:    'Mood',
                  selected: _tab == 2,
                  color:    const Color(0xFF8B5CF6),
                  onTap:    () => setState(() => _tab = 2),
                ),
              ],
            ),

            const SizedBox(height: 20),

            // ── Sparkline chart ───────────────────────────────────────────
            AnimatedSwitcher(
              duration: const Duration(milliseconds: 280),
              child: _series.length >= 3
                  ? SizedBox(
                      key:    ValueKey(_tab),
                      height: 110,
                      width:  double.infinity,
                      child:  CustomPaint(
                        painter: _SparklinePainter(
                          values:       _series,
                          color:        _accentColor,
                          surfaceColor: cs.surface,
                        ),
                      ),
                    )
                  : SizedBox(
                      key:    const ValueKey('empty'),
                      height: 110,
                      child:  Center(
                        child: Text(
                          'Not enough data yet',
                          style: TextStyle(
                            fontSize: 13,
                            color:    cs.onSurfaceVariant,
                          ),
                        ),
                      ),
                    ),
            ),

            const SizedBox(height: 12),

            // ── Footer label ──────────────────────────────────────────────
            AnimatedSwitcher(
              duration: const Duration(milliseconds: 200),
              child: Text(
                _footerLabel,
                key:   ValueKey(_tab),
                style: TextStyle(
                  fontSize:   12,
                  color:      cs.onSurfaceVariant,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ─── Chart tab pill ───────────────────────────────────────────────────────────

class _ChartTab extends StatelessWidget {
  final IconData     icon;
  final String       label;
  final bool         selected;
  final Color        color;
  final VoidCallback onTap;

  const _ChartTab({
    required this.icon,
    required this.label,
    required this.selected,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;

    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 7),
        decoration: BoxDecoration(
          color: selected
              ? color.withValues(alpha: 0.12)
              : cs.surfaceContainerHighest.withValues(alpha: 0.50),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: selected
                ? color.withValues(alpha: 0.45)
                : Colors.transparent,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              icon,
              size:  13,
              color: selected ? color : cs.onSurfaceVariant,
            ),
            const SizedBox(width: 5),
            Text(
              label,
              style: TextStyle(
                fontSize:   13,
                fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                color:      selected ? color : cs.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ─── Sparkline painter ────────────────────────────────────────────────────────

class _SparklinePainter extends CustomPainter {
  final List<double> values;
  final Color        color;
  final Color        surfaceColor;

  const _SparklinePainter({
    required this.values,
    required this.color,
    required this.surfaceColor,
  });

  @override
  void paint(Canvas canvas, Size size) {
    if (values.length < 2) return;

    final minV  = values.reduce(math.min);
    final maxV  = values.reduce(math.max);
    final range = (maxV - minV).clamp(1.0, double.infinity);

    Offset toPoint(int i) {
      final x = i / (values.length - 1) * size.width;
      final y = size.height -
          ((values[i] - minV) / range * size.height * 0.78 +
              size.height * 0.11);
      return Offset(x, y);
    }

    final points = List.generate(values.length, toPoint);

    // Fill gradient under the line.
    final fillPath = Path()..moveTo(points.first.dx, size.height);
    for (int i = 0; i < points.length - 1; i++) {
      final mid = Offset(
        (points[i].dx + points[i + 1].dx) / 2,
        (points[i].dy + points[i + 1].dy) / 2,
      );
      fillPath.quadraticBezierTo(
          points[i].dx, points[i].dy, mid.dx, mid.dy);
    }
    fillPath
      ..lineTo(points.last.dx, points.last.dy)
      ..lineTo(points.last.dx, size.height)
      ..close();

    canvas.drawPath(
      fillPath,
      Paint()
        ..shader = LinearGradient(
          begin:  Alignment.topCenter,
          end:    Alignment.bottomCenter,
          colors: [
            color.withValues(alpha: 0.22),
            color.withValues(alpha: 0.01),
          ],
        ).createShader(Rect.fromLTWH(0, 0, size.width, size.height)),
    );

    // Stroke line.
    final linePath = Path()..moveTo(points.first.dx, points.first.dy);
    for (int i = 0; i < points.length - 1; i++) {
      final mid = Offset(
        (points[i].dx + points[i + 1].dx) / 2,
        (points[i].dy + points[i + 1].dy) / 2,
      );
      linePath.quadraticBezierTo(
          points[i].dx, points[i].dy, mid.dx, mid.dy);
    }
    linePath.lineTo(points.last.dx, points.last.dy);

    canvas.drawPath(
      linePath,
      Paint()
        ..color       = color
        ..style       = PaintingStyle.stroke
        ..strokeWidth = 2.0
        ..strokeCap   = StrokeCap.round,
    );

    // Terminal dot.
    canvas.drawCircle(points.last, 3.5, Paint()..color = color);
    canvas.drawCircle(
      points.last,
      3.5,
      Paint()
        ..color       = surfaceColor
        ..style       = PaintingStyle.stroke
        ..strokeWidth = 1.5,
    );
  }

  @override
  bool shouldRepaint(covariant _SparklinePainter old) =>
      old.values.length != values.length ||
      old.color != color ||
      old.surfaceColor != surfaceColor;
}

// ─── Medication adherence card ────────────────────────────────────────────────

class _MedicationAdherenceCard extends StatelessWidget {
  final PatientHealthState state;
  const _MedicationAdherenceCard({required this.state});

  @override
  Widget build(BuildContext context) {
    final cs     = Theme.of(context).colorScheme;
    final amina  = Theme.of(context).extension<AminaColors>()!;
    final taken  = state.takenCount;
    final total  = state.meds.length;
    final allOk  = taken == total;
    final ratio  = total > 0 ? taken / total : 0.0;
    final accent = allOk ? _kGood : _kAlert;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20),
      child: Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color:        cs.surface,
          borderRadius: BorderRadius.circular(24),
          border:       Border.all(color: amina.cardBorder),
          boxShadow: [
            BoxShadow(
              color:      Colors.black.withValues(alpha: 0.04),
              blurRadius: 14,
              offset:     const Offset(0, 4),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [

            // ── Header row ─────────────────────────────────────────────
            Row(
              children: [
                // Progress ring label
                RichText(
                  text: TextSpan(
                    children: [
                      TextSpan(
                        text: '$taken',
                        style: TextStyle(
                          fontSize:   22,
                          fontWeight: FontWeight.w900,
                          color:      accent,
                          height:     1.0,
                        ),
                      ),
                      TextSpan(
                        text: ' / $total taken',
                        style: TextStyle(
                          fontSize:   14,
                          fontWeight: FontWeight.w500,
                          color:      cs.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
                const Spacer(),
                Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 10, vertical: 5),
                  decoration: BoxDecoration(
                    color:        accent.withValues(alpha: 0.10),
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(
                        color: accent.withValues(alpha: 0.30)),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        allOk
                            ? Icons.check_circle_rounded
                            : Icons.schedule_rounded,
                        color: accent,
                        size:  13,
                      ),
                      const SizedBox(width: 5),
                      Text(
                        allOk ? 'All taken' : '${total - taken} pending',
                        style: TextStyle(
                          fontSize:   12,
                          fontWeight: FontWeight.w700,
                          color:      accent,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),

            const SizedBox(height: 12),

            // ── Progress bar ────────────────────────────────────────────
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: LinearProgressIndicator(
                value:           ratio,
                minHeight:       7,
                backgroundColor: amina.cardBorder,
                valueColor:      AlwaysStoppedAnimation<Color>(accent),
              ),
            ),

            const SizedBox(height: 18),

            // ── Med list ────────────────────────────────────────────────
            ...List.generate(state.meds.length, (i) {
              final med = state.meds[i];
              return Padding(
                padding: EdgeInsets.only(
                    bottom: i < state.meds.length - 1 ? 12 : 0),
                child: Row(
                  children: [
                    // Status icon
                    Container(
                      width:  32,
                      height: 32,
                      decoration: BoxDecoration(
                        color: med.taken
                            ? _kGood.withValues(alpha: 0.10)
                            : _kAlert.withValues(alpha: 0.08),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(
                          color: med.taken
                              ? _kGood.withValues(alpha: 0.30)
                              : _kAlert.withValues(alpha: 0.25),
                        ),
                      ),
                      child: Icon(
                        med.taken
                            ? Icons.check_rounded
                            : Icons.schedule_rounded,
                        size:  16,
                        color: med.taken ? _kGood : _kAlert,
                      ),
                    ),
                    const SizedBox(width: 12),

                    // Name + dosage
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            med.name,
                            style: TextStyle(
                              fontSize:   14,
                              fontWeight: FontWeight.w600,
                              color:      med.taken
                                  ? cs.onSurfaceVariant
                                  : cs.onSurface,
                              decoration: med.taken
                                  ? TextDecoration.lineThrough
                                  : null,
                              decorationColor:
                                  cs.onSurfaceVariant,
                            ),
                          ),
                          Text(
                            med.dosage,
                            style: TextStyle(
                              fontSize: 12,
                              color:    cs.onSurfaceVariant
                                  .withValues(alpha: 0.70),
                            ),
                          ),
                        ],
                      ),
                    ),

                    // Time + status label
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Text(
                          med.time,
                          style: TextStyle(
                            fontSize:   12,
                            fontWeight: FontWeight.w500,
                            color:      cs.onSurfaceVariant,
                          ),
                        ),
                        if (!med.taken)
                          Text(
                            'Due',
                            style: TextStyle(
                              fontSize:   11,
                              fontWeight: FontWeight.w700,
                              color:      _kAlert,
                            ),
                          ),
                      ],
                    ),
                  ],
                ),
              );
            }),
          ],
        ),
      ),
    );
  }
}

// ─── Symptom history card ─────────────────────────────────────────────────────

class _SymptomHistoryCard extends StatelessWidget {
  final List<PatientDayData> weekData;
  const _SymptomHistoryCard({required this.weekData});

  static const _dayLabels = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;

    final daysWithSymptoms = weekData
        .where((d) => d.symptoms.isNotEmpty)
        .toList();

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20),
      child: Container(
        width:   double.infinity,
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color:        cs.surface,
          borderRadius: BorderRadius.circular(24),
          border:       Border.all(color: amina.cardBorder),
          boxShadow: [
            BoxShadow(
              color:      Colors.black.withValues(alpha: 0.04),
              blurRadius: 14,
              offset:     const Offset(0, 4),
            ),
          ],
        ),
        child: daysWithSymptoms.isEmpty
            ? Row(
                children: [
                  const Text('✅', style: TextStyle(fontSize: 20)),
                  const SizedBox(width: 12),
                  Text(
                    'No symptoms reported this week',
                    style: TextStyle(
                      fontSize:   14,
                      fontWeight: FontWeight.w500,
                      color:      _kGood,
                    ),
                  ),
                ],
              )
            : Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: List.generate(daysWithSymptoms.length, (i) {
                  final day   = daysWithSymptoms[i];
                  final label = _dayLabels[day.date.weekday - 1];
                  final dateStr =
                      '$label ${day.date.day}';

                  return Padding(
                    padding: EdgeInsets.only(
                        bottom: i < daysWithSymptoms.length - 1 ? 14 : 0),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // Date badge
                        Container(
                          width:  44,
                          padding: const EdgeInsets.symmetric(
                              vertical: 5),
                          decoration: BoxDecoration(
                            color:        _kAlertBg,
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(
                                color: _kAlert.withValues(alpha: 0.25)),
                          ),
                          child: Text(
                            dateStr,
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              fontSize:   11,
                              fontWeight: FontWeight.w700,
                              color:      _kAlert,
                            ),
                          ),
                        ),
                        const SizedBox(width: 12),

                        // Symptom chips
                        Expanded(
                          child: Wrap(
                            spacing:    6,
                            runSpacing: 6,
                            children: day.symptoms
                                .map((s) => Container(
                                      padding:
                                          const EdgeInsets.symmetric(
                                              horizontal: 10,
                                              vertical:   4),
                                      decoration: BoxDecoration(
                                        color:        _kAlert
                                            .withValues(alpha: 0.08),
                                        borderRadius:
                                            BorderRadius.circular(20),
                                        border: Border.all(
                                            color: _kAlert.withValues(
                                                alpha: 0.25)),
                                      ),
                                      child: Text(
                                        s,
                                        style: TextStyle(
                                          fontSize:   12,
                                          fontWeight: FontWeight.w600,
                                          color:      cs.onSurface,
                                        ),
                                      ),
                                    ))
                                .toList(),
                          ),
                        ),
                      ],
                    ),
                  );
                }),
              ),
      ),
    );
  }
}

// ─── Trend insight card ───────────────────────────────────────────────────────

class _TrendInsightCard extends StatelessWidget {
  final PatientHealthState state;
  const _TrendInsightCard({required this.state});

  // Derive human-readable insights from weekData.
  List<({IconData icon, Color color, String text})> _insights() {
    final insights = <({IconData icon, Color color, String text})>[];

    // Glucose trend
    final gSeries = state.glucoseSeries;
    if (gSeries.length >= 4) {
      final recent = gSeries.skip(gSeries.length ~/ 2).toList();
      final avg    = recent.reduce((a, b) => a + b) / recent.length;
      if (avg >= 180) {
        insights.add((
          icon:  Icons.trending_up_rounded,
          color: _kAlert,
          text:  'Glucose has been high recently (avg ${avg.round()} mg/dL) — consider reaching out.',
        ));
      } else if (avg >= 100) {
        insights.add((
          icon:  Icons.show_chart_rounded,
          color: _kCyan,
          text:  'Glucose is in the pre-diabetic range (avg ${avg.round()} mg/dL) — monitoring closely.',
        ));
      } else {
        insights.add((
          icon:  Icons.trending_down_rounded,
          color: _kGood,
          text:  'Glucose looks stable this week (avg ${avg.round()} mg/dL). 👍',
        ));
      }
    }

    // Blood pressure alerts this week
    final alertDays = state.weekData.where((d) => d.hasAlerts).length;
    if (alertDays >= 3) {
      insights.add((
        icon:  Icons.warning_amber_rounded,
        color: _kAlert,
        text:  '$alertDays of 7 days had readings above threshold — your attention may be needed.',
      ));
    } else if (alertDays == 0) {
      insights.add((
        icon:  Icons.check_circle_rounded,
        color: _kGood,
        text:  'All 7 days were within healthy ranges. Great week! 🌿',
      ));
    } else {
      insights.add((
        icon:  Icons.info_outline_rounded,
        color: _kCyan,
        text:  '$alertDays day${alertDays == 1 ? '' : 's'} had elevated readings this week.',
      ));
    }

    // Mood pattern
    final moods = state.weekData
        .where((d) => d.mood != null)
        .map((d) => d.mood!)
        .toList();
    final lowMoods = moods
        .where((m) => m == 'Low' || m == 'Anxious')
        .length;
    if (moods.isNotEmpty) {
      if (lowMoods >= 2) {
        insights.add((
          icon:  Icons.sentiment_dissatisfied_rounded,
          color: _kAlert,
          text:  'Patient reported low or anxious mood on $lowMoods day${lowMoods == 1 ? '' : 's'} — a check-in might help.',
        ));
      } else {
        insights.add((
          icon:  Icons.sentiment_satisfied_rounded,
          color: _kGood,
          text:  'Mood has been mostly positive this week. 😊',
        ));
      }
    }

    return insights;
  }

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    final rows  = _insights();

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20),
      child: Container(
        width:   double.infinity,
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color:        cs.surface,
          borderRadius: BorderRadius.circular(24),
          border:       Border.all(color: amina.cardBorder),
          boxShadow: [
            BoxShadow(
              color:      Colors.black.withValues(alpha: 0.04),
              blurRadius: 14,
              offset:     const Offset(0, 4),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header
            Row(
              children: [
                Container(
                  width:  32,
                  height: 32,
                  decoration: BoxDecoration(
                    color:  cs.primaryContainer,
                    shape:  BoxShape.circle,
                  ),
                  child: Icon(Icons.insights_rounded,
                      color: cs.primary, size: 16),
                ),
                const SizedBox(width: 10),
                Text(
                  'Weekly Insights',
                  style: TextStyle(
                    fontSize:      15,
                    fontWeight:    FontWeight.w800,
                    color:         cs.onSurface,
                    letterSpacing: -0.2,
                  ),
                ),
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color:        cs.primaryContainer,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    'Last 7 days',
                    style: TextStyle(
                      fontSize:   10,
                      fontWeight: FontWeight.w600,
                      color:      cs.primary,
                    ),
                  ),
                ),
              ],
            ),

            const SizedBox(height: 16),

            // Insight rows
            ...List.generate(rows.length, (i) {
              final r = rows[i];
              return Padding(
                padding: EdgeInsets.only(
                    bottom: i < rows.length - 1 ? 14 : 0),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width:  34,
                      height: 34,
                      decoration: BoxDecoration(
                        color:        r.color.withValues(alpha: 0.10),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Icon(r.icon,
                          color: r.color, size: 17),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsets.only(top: 7),
                        child: Text(
                          r.text,
                          style: TextStyle(
                            fontSize: 13.5,
                            color:    cs.onSurface,
                            height:   1.5,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              );
            }),
          ],
        ),
      ),
    );
  }
}

// ─── Patient notes feed ───────────────────────────────────────────────────────

class _PatientNotesFeed extends StatelessWidget {
  final List<PatientNote> notes;
  final String            patientInitials;
  final String            patientName;

  const _PatientNotesFeed({
    required this.notes,
    required this.patientInitials,
    required this.patientName,
  });

  String _timeLabel(DateTime dt) {
    final diff = DateTime.now().difference(dt);
    if (diff.inMinutes < 1)  return 'Just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours   < 24) return '${diff.inHours}h ago';
    if (diff.inDays    == 1) return 'Yesterday';
    return '${diff.inDays}d ago';
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;

    if (notes.isEmpty) {
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 32),
        child: Center(
          child: Column(
            children: [
              const Icon(Icons.chat_bubble_outline_rounded,
                  color: _kNone, size: 44),
              const SizedBox(height: 10),
              Text('No notes yet',
                  style: TextStyle(color: cs.onSurfaceVariant, fontSize: 15)),
            ],
          ),
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(26),
        child: Container(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin:  Alignment.topLeft,
              end:    Alignment.bottomRight,
              colors: [
                const Color(0xFF3D9970).withValues(alpha: 0.14),
                const Color(0xFF0EA5E9).withValues(alpha: 0.10),
                const Color(0xFF8B5CF6).withValues(alpha: 0.07),
              ],
            ),
          ),
          child: Stack(
            children: [
              Positioned(
                top: -40, right: -40,
                child: _Blob(size: 140,
                    color: cs.primary.withValues(alpha: 0.18)),
              ),
              Positioned(
                bottom: 10, left: -30,
                child: _Blob(size: 110,
                    color: _kCyan.withValues(alpha: 0.14)),
              ),
              Positioned(
                top: 80, left: 40,
                child: _Blob(size: 70,
                    color: const Color(0xFF8B5CF6).withValues(alpha: 0.10)),
              ),

              Padding(
                padding: const EdgeInsets.symmetric(vertical: 14),
                child: Column(
                  children: notes
                      .map((n) => _NoteCard(
                            note:            n,
                            patientInitials: patientInitials,
                            patientName:     patientName,
                            timeLabel:       _timeLabel(n.timestamp),
                          ))
                      .toList(),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ─── Note card (glassmorphism) ────────────────────────────────────────────────

class _NoteCard extends StatelessWidget {
  final PatientNote note;
  final String      patientInitials;
  final String      patientName;
  final String      timeLabel;

  const _NoteCard({
    required this.note,
    required this.patientInitials,
    required this.patientName,
    required this.timeLabel,
  });

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(20),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 12, sigmaY: 12),
          child: Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color:        cs.surface.withValues(alpha: 0.80),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(
                color: cs.onSurface.withValues(alpha: 0.10),
                width: 1.2,
              ),
              boxShadow: [
                BoxShadow(
                  color:      Colors.black.withValues(alpha: 0.06),
                  blurRadius: 10,
                  offset:     const Offset(0, 3),
                ),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width:  30,
                      height: 30,
                      decoration: const BoxDecoration(
                        gradient: LinearGradient(
                          colors: [Color(0xFF3D9970), Color(0xFF1E6B4A)],
                          begin:  Alignment.topLeft,
                          end:    Alignment.bottomRight,
                        ),
                        shape: BoxShape.circle,
                      ),
                      child: Center(
                        child: Text(
                          patientInitials,
                          style: const TextStyle(
                            color:      Colors.white,
                            fontSize:   11,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 9),
                    Text(
                      patientName,
                      style: TextStyle(
                        fontSize:   13,
                        fontWeight: FontWeight.w700,
                        color:      cs.onSurface,
                      ),
                    ),
                    const Spacer(),
                    Text(
                      timeLabel,
                      style: TextStyle(
                        fontSize: 11,
                        color:    cs.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),

                const SizedBox(height: 10),

                Text(
                  note.content,
                  style: TextStyle(
                    fontSize: 14,
                    color:    cs.onSurface,
                    height:   1.55,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ─── Decorative blob ─────────────────────────────────────────────────────────

class _Blob extends StatelessWidget {
  final double size;
  final Color  color;
  const _Blob({required this.size, required this.color});

  @override
  Widget build(BuildContext context) => Container(
        width:  size,
        height: size,
        decoration: BoxDecoration(color: color, shape: BoxShape.circle),
      );
}
