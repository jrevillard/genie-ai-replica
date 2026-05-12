import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/theme/app_theme.dart';
import '../../data/models/daily_health_record.dart';
import '../providers/health_calendar_provider.dart';
import 'health_log_sheet.dart';

// ── Data-track colours — semantic identity, fixed across both modes ────────────
//
// These colour dots identify health metrics (Glucose / BP / Mood / Activity)
// in the calendar legend and status dots. They are chart-legend colours —
// never adapt to theme, same rule as care_plan_sheet.dart category colours.

const _kCyan  = Color(0xFF06B6D4); // Glucose   — cyan
const _kRed   = Color(0xFFEF4444); // BP        — red   (alert signal)
const _kVio   = Color(0xFF8B5CF6); // Mood      — violet
const _kGreen = Color(0xFF22C55E); // Activity  — green

// ── Helpers ───────────────────────────────────────────────────────────────────

const _kMonths = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

bool _sameDay(DateTime a, DateTime b) =>
    a.year == b.year && a.month == b.month && a.day == b.day;

DateTime _startOfWeek(DateTime d) =>
    DateTime(d.year, d.month, d.day - (d.weekday - 1));

int _daysInMonth(DateTime m) => DateTime(m.year, m.month + 1, 0).day;

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC WIDGET
// ═══════════════════════════════════════════════════════════════════════════════

class HealthTrackerCalendar extends ConsumerWidget {
  /// When [showCard] is true (default) the widget renders inside its own
  /// card container. Pass false to embed it inside another card.
  final bool showCard;
  const HealthTrackerCalendar({super.key, this.showCard = true});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state    = ref.watch(healthCalendarProvider);
    final notifier = ref.read(healthCalendarProvider.notifier);
    // ── Single theme read — propagated to every child ──────────────────
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;

    void onDayTap(DateTime date) {
      final existing = notifier.recordFor(date);
      showHealthLogSheet(context, date, existing);
    }

    final content = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _CalendarHeader(state: state, notifier: notifier, cs: cs, amina: amina),
        _WeekdayLabels(cs: cs),

        // Smooth height + fade transition between week and month view.
        AnimatedSize(
          duration: const Duration(milliseconds: 340),
          curve:    Curves.easeInOut,
          child: AnimatedSwitcher(
            duration:       const Duration(milliseconds: 240),
            switchInCurve:  Curves.easeOut,
            switchOutCurve: Curves.easeIn,
            child: state.isMonthExpanded
                ? _MonthGrid(
                    key:      const ValueKey('month'),
                    state:    state,
                    cs:       cs,
                    onDayTap: onDayTap,
                  )
                : _WeekStrip(
                    key:      const ValueKey('week'),
                    state:    state,
                    cs:       cs,
                    onDayTap: onDayTap,
                  ),
          ),
        ),

        _Legend(cs: cs, amina: amina),
      ],
    );

    if (!showCard) return content;

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      decoration: BoxDecoration(
        color:        cs.surface,
        borderRadius: BorderRadius.circular(28),
        border:       Border.all(color: amina.cardBorder),
        // Soft sage ambient glow — not a heavy black shadow.
        boxShadow: [
          BoxShadow(color: amina.sageGlow, blurRadius: 24, offset: Offset.zero),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(28),
        child: content,
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HEADER
// ═══════════════════════════════════════════════════════════════════════════════

class _CalendarHeader extends StatelessWidget {
  final HealthCalendarState    state;
  final HealthCalendarNotifier notifier;
  final ColorScheme            cs;
  final AminaColors            amina;
  const _CalendarHeader({
    required this.state,
    required this.notifier,
    required this.cs,
    required this.amina,
  });

  @override
  Widget build(BuildContext context) {
    final m        = state.focusedMonth;
    final expanded = state.isMonthExpanded;

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 20, 16, 12),
      child: Row(
        children: [
          // Month + year title
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${_kMonths[m.month - 1]} ${m.year}',
                  style: TextStyle(
                    color:         cs.onSurface,
                    fontSize:      20,
                    fontWeight:    FontWeight.w800,
                    fontFamily:    'Inter',
                    letterSpacing: -0.4,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'Tap any day to log your health',
                  style: TextStyle(
                    color:      cs.onSurfaceVariant.withValues(alpha: 0.75),
                    fontSize:   12,
                    fontFamily: 'Inter',
                  ),
                ),
              ],
            ),
          ),

          // ← Prev
          _NavArrow(icon: Icons.chevron_left_rounded,  onTap: notifier.prevMonth, cs: cs, amina: amina),
          const SizedBox(width: 4),
          // → Next
          _NavArrow(icon: Icons.chevron_right_rounded, onTap: notifier.nextMonth, cs: cs, amina: amina),
          const SizedBox(width: 8),

          // Week / Month toggle
          GestureDetector(
            onTap: notifier.toggleExpanded,
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 220),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
              decoration: BoxDecoration(
                color: expanded
                    ? cs.primary.withValues(alpha: 0.14)
                    : amina.inputFill,
                borderRadius: BorderRadius.circular(20),
                border: Border.all(
                  color: expanded
                      ? cs.primary.withValues(alpha: 0.55)
                      : amina.cardBorder,
                ),
              ),
              child: Text(
                expanded ? 'Week' : 'Month',
                style: TextStyle(
                  color:      expanded ? cs.primary : cs.onSurfaceVariant,
                  fontSize:   12,
                  fontWeight: FontWeight.w700,
                  fontFamily: 'Inter',
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _NavArrow extends StatelessWidget {
  final IconData     icon;
  final VoidCallback onTap;
  final ColorScheme  cs;
  final AminaColors  amina;
  const _NavArrow({
    required this.icon,
    required this.onTap,
    required this.cs,
    required this.amina,
  });

  @override
  Widget build(BuildContext context) => GestureDetector(
        onTap: onTap,
        child: Container(
          width:  34,
          height: 34,
          decoration: BoxDecoration(
            color:  amina.inputFill,
            shape:  BoxShape.circle,
            border: Border.all(color: amina.cardBorder),
          ),
          child: Icon(icon, color: cs.onSurfaceVariant, size: 18),
        ),
      );
}

// ── Weekday labels ────────────────────────────────────────────────────────────

class _WeekdayLabels extends StatelessWidget {
  final ColorScheme cs;
  const _WeekdayLabels({required this.cs});

  static const _labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        child: Row(
          children: _labels
              .map((l) => Expanded(
                    child: Center(
                      child: Text(
                        l,
                        style: TextStyle(
                          color:      cs.onSurfaceVariant.withValues(alpha: 0.60),
                          fontSize:   11,
                          fontWeight: FontWeight.w700,
                          fontFamily: 'Inter',
                        ),
                      ),
                    ),
                  ))
              .toList(),
        ),
      );
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEEK STRIP
// ═══════════════════════════════════════════════════════════════════════════════

class _WeekStrip extends StatelessWidget {
  final HealthCalendarState     state;
  final void Function(DateTime) onDayTap;
  final ColorScheme             cs;
  const _WeekStrip({
    super.key,
    required this.state,
    required this.onDayTap,
    required this.cs,
  });

  @override
  Widget build(BuildContext context) {
    final today     = DateTime.now();
    final weekStart = _startOfWeek(today);

    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 4, 8, 8),
      child: Row(
        children: List.generate(7, (i) {
          final date = DateTime(
              weekStart.year, weekStart.month, weekStart.day + i);
          return Expanded(
            child: _DayCell(
              date:    date,
              record:  state.records[DailyHealthRecord.keyFor(date)],
              isToday: _sameDay(date, today),
              dimmed:  false,
              cs:      cs,
              onTap:   () => onDayTap(date),
            ),
          );
        }),
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MONTH GRID
// ═══════════════════════════════════════════════════════════════════════════════

class _MonthGrid extends StatelessWidget {
  final HealthCalendarState     state;
  final void Function(DateTime) onDayTap;
  final ColorScheme             cs;
  const _MonthGrid({
    super.key,
    required this.state,
    required this.onDayTap,
    required this.cs,
  });

  @override
  Widget build(BuildContext context) {
    final today  = DateTime.now();
    final focus  = state.focusedMonth;
    final first  = DateTime(focus.year, focus.month, 1);
    final total  = _daysInMonth(focus);
    final leadingEmpties = (first.weekday - 1) % 7;

    final cells = <Widget>[
      for (var i = 0; i < leadingEmpties; i++) const SizedBox.shrink(),
      for (var day = 1; day <= total; day++)
        _DayCell(
          date:    DateTime(focus.year, focus.month, day),
          record:  state.records[DailyHealthRecord.keyFor(
                       DateTime(focus.year, focus.month, day))],
          isToday: _sameDay(DateTime(focus.year, focus.month, day), today),
          dimmed:  false,
          cs:      cs,
          onTap:   () => onDayTap(DateTime(focus.year, focus.month, day)),
        ),
    ];

    // Pad to complete the last row.
    while (cells.length % 7 != 0) cells.add(const SizedBox.shrink());

    final rows = cells.length ~/ 7;

    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 4, 8, 8),
      child: Column(
        children: List.generate(
          rows,
          (row) => Row(
            children: List.generate(
              7,
              (col) => Expanded(child: cells[row * 7 + col]),
            ),
          ),
        ),
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DAY CELL
// ═══════════════════════════════════════════════════════════════════════════════

class _DayCell extends StatelessWidget {
  final DateTime           date;
  final DailyHealthRecord? record;
  final bool               isToday;
  final bool               dimmed;
  final ColorScheme        cs;
  final VoidCallback        onTap;

  const _DayCell({
    required this.date,
    required this.record,
    required this.isToday,
    required this.dimmed,
    required this.cs,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final isComplete = record?.isComplete ?? false;
    final hasAny     = (record?.loggedCount ?? 0) > 0;

    return GestureDetector(
      onTap:     onTap,
      behavior:  HitTestBehavior.opaque,
      child: SizedBox(
        height: 64,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            // Day number circle
            Container(
              width:  34,
              height: 34,
              decoration: BoxDecoration(
                // Today → filled primary; complete → sage ring; default → nothing.
                color:  isToday ? cs.primary : Colors.transparent,
                shape:  BoxShape.circle,
                border: !isToday && isComplete
                    ? Border.all(
                        color: cs.primary.withValues(alpha: 0.65),
                        width: 1.5)
                    : null,
                boxShadow: isToday
                    ? [
                        BoxShadow(
                          color:      cs.primary.withValues(alpha: 0.40),
                          blurRadius: 12,
                          offset:     Offset.zero,
                        ),
                      ]
                    : isComplete
                    ? [
                        BoxShadow(
                          color:      cs.primary.withValues(alpha: 0.20),
                          blurRadius: 8,
                          offset:     Offset.zero,
                        ),
                      ]
                    : null,
              ),
              child: Center(
                child: Text(
                  '${date.day}',
                  style: TextStyle(
                    // cs.onPrimary gives white in light, dark in dark —
                    // correct contrast on the sage primary circle.
                    color: isToday
                        ? cs.onPrimary
                        : dimmed
                            ? cs.onSurfaceVariant.withValues(alpha: 0.35)
                            : hasAny
                                ? cs.onSurface
                                : cs.onSurfaceVariant,
                    fontSize:   13,
                    fontWeight: isToday || isComplete
                        ? FontWeight.w700
                        : FontWeight.w500,
                    fontFamily: 'Inter',
                  ),
                ),
              ),
            ),

            const SizedBox(height: 5),

            // Status dots — always reserve height so cells stay aligned.
            SizedBox(
              height: 8,
              child: record != null && hasAny
                  ? _StatusDots(record: record!)
                  : null,
            ),
          ],
        ),
      ),
    );
  }
}

// ── Status dots — data-track colours, intentionally fixed ─────────────────────

class _StatusDots extends StatelessWidget {
  final DailyHealthRecord record;
  const _StatusDots({required this.record});

  @override
  Widget build(BuildContext context) => Row(
        mainAxisSize:      MainAxisSize.min,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          _dot(record.hasGlucose,  _kCyan),
          _dot(record.hasBp,       _kRed),
          _dot(record.hasMood,     _kVio),
          _dot(record.hasActivity, _kGreen),
        ],
      );

  Widget _dot(bool active, Color color) => Container(
        width:  5,
        height: 5,
        margin: const EdgeInsets.symmetric(horizontal: 1.5),
        decoration: BoxDecoration(
          color: active ? color : color.withValues(alpha: 0.12),
          shape: BoxShape.circle,
          // Subtle glow on active dots — purely decorative on tiny circles.
          boxShadow: active
              ? [
                  BoxShadow(
                    color:      color.withValues(alpha: 0.55),
                    blurRadius: 4,
                    offset:     Offset.zero,
                  ),
                ]
              : null,
        ),
      );
}

// ═══════════════════════════════════════════════════════════════════════════════
// LEGEND
// ═══════════════════════════════════════════════════════════════════════════════

class _Legend extends StatelessWidget {
  final ColorScheme cs;
  final AminaColors amina;
  const _Legend({required this.cs, required this.amina});

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
        decoration: BoxDecoration(
          border: Border(top: BorderSide(color: amina.divider)),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceAround,
          children: [
            _LegendItem(color: _kCyan,  label: 'Glucose',  cs: cs),
            _LegendItem(color: _kRed,   label: 'BP',       cs: cs),
            _LegendItem(color: _kVio,   label: 'Mood',     cs: cs),
            _LegendItem(color: _kGreen, label: 'Activity', cs: cs),
          ],
        ),
      );
}

class _LegendItem extends StatelessWidget {
  final Color       color;
  final String      label;
  final ColorScheme cs;
  const _LegendItem({
    required this.color,
    required this.label,
    required this.cs,
  });

  @override
  Widget build(BuildContext context) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width:  8,
            height: 8,
            decoration: BoxDecoration(
              color: color,
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color:      color.withValues(alpha: 0.55),
                  blurRadius: 5,
                  offset:     Offset.zero,
                ),
              ],
            ),
          ),
          const SizedBox(width: 6),
          Text(
            label,
            style: TextStyle(
              color:      cs.onSurfaceVariant,
              fontSize:   11,
              fontWeight: FontWeight.w500,
              fontFamily: 'Inter',
            ),
          ),
        ],
      );
}
