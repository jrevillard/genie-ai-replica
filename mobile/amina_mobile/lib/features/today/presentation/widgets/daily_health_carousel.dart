import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/vitals_provider.dart';
import 'health_metric_card.dart';
import 'log_vitals_sheet.dart';

import '../../../../core/theme/app_theme.dart';

// ─── Hero-card gradient (carousel-specific; not shared) ──────────────────────

const _kGradLog = LinearGradient(
  begin: Alignment.topLeft,
  end:   Alignment.bottomRight,
  colors: [Color(0xFF3D9970), Color(0xFF1E6B4A)],
);

// ─── Carousel dimensions ─────────────────────────────────────────────────────

const _kCardWidth  = 152.0;   // fixed width for each metric card in the scroll
const _kCardHeight = 174.0;   // SizedBox height that constrains the ListView
const _kHeroWidth  = 160.0;   // Log Today card is slightly wider than the rest
const _kHeroRadius = 24.0;    // hero card corner radius
const _kCardMargin = 14.0;    // right margin between carousel items

// ─── DailyHealthCarousel ──────────────────────────────────────────────────────

/// Horizontal, physics-bouncing carousel that serves as TodayHub's daily
/// command centre.
///
/// Metric cards (Glucose, BP, Mood, Symptoms) are instances of the shared
/// [HealthMetricCard] / [MoodMetricCard] / [SymptomsMetricCard] widgets from
/// `health_metric_card.dart`, wrapped in fixed-width [SizedBox] containers so
/// the carousel layout is consistent regardless of content length.
///
/// The "Log Today" hero card is carousel-exclusive and keeps its pulse
/// animation private.
class DailyHealthCarousel extends ConsumerStatefulWidget {
  const DailyHealthCarousel({super.key});

  @override
  ConsumerState<DailyHealthCarousel> createState() =>
      _DailyHealthCarouselState();
}

class _DailyHealthCarouselState extends ConsumerState<DailyHealthCarousel>
    with TickerProviderStateMixin {

  late final AnimationController _pulseCtrl;

  @override
  void initState() {
    super.initState();
    _pulseCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2400),
    )..repeat();
  }

  @override
  void dispose() {
    _pulseCtrl.dispose();
    super.dispose();
  }

  // ── Clinical thresholds (visual cue only — not medical advice) ─────────────

  bool _isBpElevated(String bp) {
    if (bp.isEmpty) return false;
    final systolic = int.tryParse(bp.split('/').first.trim());
    return systolic != null && systolic >= 130;
  }

  bool _isGlucoseHigh(String glucose) {
    final val = int.tryParse(glucose.trim());
    return val != null && val >= 180;
  }

  // ── Date pill label ────────────────────────────────────────────────────────

  String _todayLabel() {
    final now = DateTime.now();
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return '${months[now.month - 1]} ${now.day}';
  }

  // ── Build ──────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final latest   = ref.watch(latestVitalsProvider);
    final glucose  = latest?.glucose       ?? '';
    final bp       = latest?.bloodPressure ?? '';
    final mood     = latest?.mood          ?? '';
    final symptoms = latest?.symptoms      ?? const [];
    final cs       = Theme.of(context).colorScheme;
    final amina    = Theme.of(context).extension<AminaColors>()!;

    final bpAlert      = _isBpElevated(bp);
    final glucoseAlert = _isGlucoseHigh(glucose);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // ── Section header ─────────────────────────────────────────────────
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    "Today's Health",
                    style: TextStyle(
                      fontSize:      19,
                      fontWeight:    FontWeight.w700,
                      color:         cs.onSurface,
                      letterSpacing: -0.4,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'Your daily command centre',
                    style: TextStyle(fontSize: 12.5, color: cs.onSurfaceVariant),
                  ),
                ],
              ),
              const Spacer(),
              // Date pill
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 5),
                decoration: BoxDecoration(
                  color:        amina.inputFill,
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  _todayLabel(),
                  style: TextStyle(
                    fontSize:   12,
                    fontWeight: FontWeight.w600,
                    color:      cs.onSurfaceVariant,
                  ),
                ),
              ),
            ],
          ),
        ),

        // ── Scrollable card row ────────────────────────────────────────────
        //
        // Each shared card is constrained to _kCardWidth via SizedBox and
        // given a right margin via Padding so the carousel spacing is uniform.
        SizedBox(
          height: _kCardHeight,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding:         const EdgeInsets.only(left: 20),
            physics:         const BouncingScrollPhysics(),
            children: [
              // 1 ─ Hero: Log Today (carousel-exclusive pulsing card)
              _LogTodayCard(pulseCtrl: _pulseCtrl),

              // 2 ─ Blood Glucose
              Padding(
                padding: const EdgeInsets.only(right: _kCardMargin),
                child: SizedBox(
                  width: _kCardWidth,
                  child: HealthMetricCard(
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
                    onTap:      () => showLogVitalsSheet(
                      context,
                      focus: LogVitalsFocus.glucose,
                    ),
                  ),
                ),
              ),

              // 3 ─ Blood Pressure
              Padding(
                padding: const EdgeInsets.only(right: _kCardMargin),
                child: SizedBox(
                  width: _kCardWidth,
                  child: HealthMetricCard(
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
                    onTap:      () => showLogVitalsSheet(
                      context,
                      focus: LogVitalsFocus.bloodPressure,
                    ),
                  ),
                ),
              ),

              // 4 ─ Mood
              Padding(
                padding: const EdgeInsets.only(right: _kCardMargin),
                child: SizedBox(
                  width: _kCardWidth,
                  child: MoodMetricCard(
                    mood:  mood,
                    onTap: () => showLogVitalsSheet(
                      context,
                      focus: LogVitalsFocus.mood,
                    ),
                  ),
                ),
              ),

              // 5 ─ Symptoms
              Padding(
                padding: const EdgeInsets.only(right: _kCardMargin),
                child: SizedBox(
                  width: _kCardWidth,
                  child: SymptomsMetricCard(
                    symptoms: symptoms,
                    onTap:    () => showLogVitalsSheet(
                      context,
                      focus: LogVitalsFocus.symptoms,
                    ),
                  ),
                ),
              ),

              // Trailing spacer so the last card is not flush with the edge.
              const SizedBox(width: 6),
            ],
          ),
        ),
      ],
    );
  }
}

// ─── Hero card: Log Today ─────────────────────────────────────────────────────

/// Full-gradient hero card with a sonar pulse animation.
/// Carousel-exclusive — not extracted to the shared file because the pulse
/// animation controller is owned by [_DailyHealthCarouselState].
class _LogTodayCard extends StatelessWidget {
  final AnimationController pulseCtrl;
  const _LogTodayCard({required this.pulseCtrl});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => showLogVitalsSheet(context, switchToChat: true),
      child: Container(
        width:  _kHeroWidth,
        margin: const EdgeInsets.only(right: _kCardMargin),
        decoration: BoxDecoration(
          gradient:     _kGradLog,
          borderRadius: BorderRadius.circular(_kHeroRadius),
          boxShadow: [
            BoxShadow(
              color:      const Color(0xFF3D9970).withValues(alpha: 0.40),
              blurRadius: 20,
              offset:     const Offset(0, 7),
            ),
          ],
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(_kHeroRadius),
          child: Stack(
            children: [
              // ── Sonar pulse rings ────────────────────────────────────────
              Positioned.fill(
                child: AnimatedBuilder(
                  animation: pulseCtrl,
                  builder: (_, __) => CustomPaint(
                    painter: _PulseRingPainter(
                      progress: pulseCtrl.value,
                      color:    Colors.white,
                    ),
                  ),
                ),
              ),

              // ── Decorative bubble — top-right ────────────────────────────
              Positioned(
                top:   -22,
                right: -22,
                child: Container(
                  width:  88,
                  height: 88,
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.09),
                    shape: BoxShape.circle,
                  ),
                ),
              ),

              // ── Content ──────────────────────────────────────────────────
              Padding(
                padding: const EdgeInsets.all(18),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width:  50,
                      height: 50,
                      decoration: BoxDecoration(
                        color:  Colors.white.withValues(alpha: 0.20),
                        shape:  BoxShape.circle,
                        border: Border.all(
                          color: Colors.white.withValues(alpha: 0.35),
                          width: 1.5,
                        ),
                      ),
                      child: const Icon(
                        Icons.add_rounded,
                        color: Colors.white,
                        size:  28,
                      ),
                    ),

                    const Spacer(),

                    const Text(
                      'Log Today',
                      style: TextStyle(
                        fontSize:      18,
                        fontWeight:    FontWeight.w700,
                        color:         Colors.white,
                        letterSpacing: -0.4,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Mood · Vitals · Symptoms',
                      style: TextStyle(
                        fontSize: 11.5,
                        color:    Colors.white.withValues(alpha: 0.80),
                        height:   1.3,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ─── Sonar pulse painter ──────────────────────────────────────────────────────

/// Two staggered translucent rings that expand from the card centre,
/// evoking a heartbeat / sonar pulse to draw attention to the Log Today card.
class _PulseRingPainter extends CustomPainter {
  final double progress;
  final Color  color;

  const _PulseRingPainter({required this.progress, required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    const minRadius = 30.0;
    const maxRadius = 95.0;

    final center = Offset(size.width / 2, size.height / 2);

    for (int i = 0; i < 2; i++) {
      final p = (progress + i * 0.5) % 1.0;

      // Ease-out: decelerates as the ring reaches the card edge.
      final eased  = 1 - math.pow(1 - p, 2.0);
      final radius = minRadius + (maxRadius - minRadius) * eased;
      final opacity = (1.0 - p) * 0.22;

      canvas.drawCircle(
        center,
        radius,
        Paint()
          ..color       = color.withValues(alpha: opacity)
          ..style       = PaintingStyle.stroke
          ..strokeWidth = 2.0,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _PulseRingPainter old) =>
      old.progress != progress;
}
