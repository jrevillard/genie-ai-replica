import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../data/models/daily_health_record.dart';
import '../providers/health_calendar_provider.dart';

// ── Entry point ───────────────────────────────────────────────────────────────

void showHealthLogSheet(
  BuildContext context,
  DateTime date,
  DailyHealthRecord? existing,
) {
  showModalBottomSheet<void>(
    context:            context,
    isScrollControlled: true,
    backgroundColor:    Colors.transparent,
    barrierColor:       Colors.black.withValues(alpha: 0.55),
    builder:            (_) => _HealthLogSheet(date: date, existing: existing),
  );
}

// ── Tokens ────────────────────────────────────────────────────────────────────

const _kSheet    = Color(0xFF13151F);
const _kCard     = Color(0xFF1C1F2E);
const _kBorder   = Color(0xFF252839);
const _kText     = Color(0xFFF1F5F9);
const _kMuted    = Color(0xFF64748B);
const _kSage     = Color(0xFF3D9970);
const _kSageLight= Color(0xFF1A2E22);
const _kCyan     = Color(0xFF06B6D4);
const _kRed      = Color(0xFFEF4444);
const _kVio      = Color(0xFF8B5CF6);

// ── Month names ───────────────────────────────────────────────────────────────

const _kMonths = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const _kDays   = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

// ═══════════════════════════════════════════════════════════════════════════════
// Log sheet
// ═══════════════════════════════════════════════════════════════════════════════

class _HealthLogSheet extends ConsumerStatefulWidget {
  final DateTime           date;
  final DailyHealthRecord? existing;

  const _HealthLogSheet({required this.date, this.existing});

  @override
  ConsumerState<_HealthLogSheet> createState() => _HealthLogSheetState();
}

class _HealthLogSheetState extends ConsumerState<_HealthLogSheet> {
  late final TextEditingController _glucoseCtrl;
  late final TextEditingController _sysCtrl;
  late final TextEditingController _diaCtrl;

  MoodLevel? _mood;
  int?       _exerciseMin;   // null = not set
  bool       _foodLogged = false;

  @override
  void initState() {
    super.initState();
    final r = widget.existing;
    _glucoseCtrl = TextEditingController(
        text: r?.glucose != null ? r!.glucose!.toStringAsFixed(0) : '');
    _sysCtrl = TextEditingController(
        text: r?.bp?.systolic.toString() ?? '');
    _diaCtrl = TextEditingController(
        text: r?.bp?.diastolic.toString() ?? '');
    _mood        = r?.mood;
    _exerciseMin = r?.exerciseMinutes;
    _foodLogged  = r?.foodLogged ?? false;
  }

  @override
  void dispose() {
    _glucoseCtrl.dispose();
    _sysCtrl.dispose();
    _diaCtrl.dispose();
    super.dispose();
  }

  // ── Save ─────────────────────────────────────────────────────────────────

  void _save() {
    final glucoseVal = double.tryParse(_glucoseCtrl.text.trim());
    final sysVal     = int.tryParse(_sysCtrl.text.trim());
    final diaVal     = int.tryParse(_diaCtrl.text.trim());

    final record = DailyHealthRecord(
      date:            widget.date,
      glucose:         glucoseVal,
      bp:              (sysVal != null && diaVal != null)
                           ? BloodPressure(systolic: sysVal, diastolic: diaVal)
                           : null,
      mood:            _mood,
      foodLogged:      _foodLogged,
      exerciseMinutes: _exerciseMin,
    );

    ref.read(healthCalendarProvider.notifier).logRecord(record);

    if (mounted) Navigator.of(context).pop();
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final mq = MediaQuery.of(context);
    final weekdayName = _kDays[(widget.date.weekday - 1).clamp(0, 6)];
    final monthName   = _kMonths[widget.date.month - 1];
    final dateLabel   = '$weekdayName, ${widget.date.day} $monthName';

    return DraggableScrollableSheet(
      initialChildSize: 0.88,
      minChildSize:     0.55,
      maxChildSize:     0.96,
      snap:             true,
      snapSizes:  const [0.55, 0.88, 0.96],
      builder: (ctx, scroll) => Container(
        decoration: const BoxDecoration(
          color:        _kSheet,
          borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        ),
        child: Column(
          children: [
            // ── Drag handle ───────────────────────────────────────────────
            Padding(
              padding: const EdgeInsets.only(top: 14, bottom: 8),
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: _kBorder,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),

            // ── Header ────────────────────────────────────────────────────
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 4, 20, 16),
              child: Row(
                children: [
                  Container(
                    width: 44, height: 44,
                    decoration: BoxDecoration(
                      color: _kSageLight,
                      shape: BoxShape.circle,
                      border: Border.all(
                          color: _kSage.withValues(alpha: 0.40)),
                    ),
                    child: const Center(
                      child: Text('📋', style: TextStyle(fontSize: 22)),
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Log Health Data',
                          style: TextStyle(
                            color:      _kText,
                            fontSize:   17,
                            fontWeight: FontWeight.w700,
                            fontFamily: 'Inter',
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          dateLabel,
                          style: const TextStyle(
                            color:      _kMuted,
                            fontSize:   13,
                            fontFamily: 'Inter',
                          ),
                        ),
                      ],
                    ),
                  ),
                  GestureDetector(
                    onTap: () => Navigator.of(context).pop(),
                    child: Container(
                      width: 36, height: 36,
                      decoration: BoxDecoration(
                        color:  _kCard,
                        shape:  BoxShape.circle,
                        border: Border.all(color: _kBorder),
                      ),
                      child: const Icon(Icons.close_rounded,
                          color: _kMuted, size: 18),
                    ),
                  ),
                ],
              ),
            ),

            const Divider(height: 1, color: _kBorder),

            // ── Scrollable body ───────────────────────────────────────────
            Expanded(
              child: ListView(
                controller:  scroll,
                padding: EdgeInsets.fromLTRB(
                    20, 20, 20, mq.viewInsets.bottom + 110),
                children: [
                  _GlucoseSection(controller: _glucoseCtrl),
                  const SizedBox(height: 16),
                  _BpSection(sysCtrl: _sysCtrl, diaCtrl: _diaCtrl),
                  const SizedBox(height: 16),
                  _MoodSection(
                    selected:   _mood,
                    onSelected: (m) => setState(() => _mood = m),
                  ),
                  const SizedBox(height: 16),
                  _ExerciseSection(
                    selected:   _exerciseMin,
                    onSelected: (v) => setState(() => _exerciseMin = v),
                  ),
                  const SizedBox(height: 16),
                  _FoodSection(
                    logged:     _foodLogged,
                    onChanged:  (v) => setState(() => _foodLogged = v),
                  ),
                ],
              ),
            ),

            // ── Save button (pinned) ──────────────────────────────────────
            Container(
              padding: EdgeInsets.fromLTRB(
                  20, 12, 20, mq.padding.bottom + 12),
              decoration: const BoxDecoration(
                color: _kSheet,
                border: Border(top: BorderSide(color: _kBorder)),
              ),
              child: SizedBox(
                width:  double.infinity,
                height: 54,
                child: ElevatedButton(
                  onPressed: _save,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: _kSage,
                    foregroundColor: Colors.white,
                    elevation:       0,
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(18)),
                  ),
                  child: const Text(
                    'Save Log',
                    style: TextStyle(
                      fontSize:      17,
                      fontWeight:    FontWeight.w700,
                      fontFamily:    'Inter',
                      letterSpacing: 0.2,
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Shared section wrapper ────────────────────────────────────────────────────

class _SectionCard extends StatelessWidget {
  final String   title;
  final IconData icon;
  final Color    iconColor;
  final Color    iconBg;
  final Widget   child;

  const _SectionCard({
    required this.title,
    required this.icon,
    required this.iconColor,
    required this.iconBg,
    required this.child,
  });

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          color:        _kCard,
          borderRadius: BorderRadius.circular(20),
          border:       Border.all(color: _kBorder),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 34, height: 34,
                  decoration: BoxDecoration(
                    color: iconBg, shape: BoxShape.circle),
                  child: Icon(icon, color: iconColor, size: 17),
                ),
                const SizedBox(width: 10),
                Text(
                  title,
                  style: const TextStyle(
                    color:      _kText,
                    fontSize:   15,
                    fontWeight: FontWeight.w600,
                    fontFamily: 'Inter',
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            child,
          ],
        ),
      );
}

// ── Input helper ──────────────────────────────────────────────────────────────

class _DarkField extends StatelessWidget {
  final TextEditingController controller;
  final String hint;
  final String suffix;
  final TextInputType keyboardType;

  const _DarkField({
    required this.controller,
    required this.hint,
    this.suffix = '',
    this.keyboardType = TextInputType.number,
  });

  @override
  Widget build(BuildContext context) => SizedBox(
        height: 52,
        child: TextField(
          controller:   controller,
          keyboardType: keyboardType,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          style: const TextStyle(
            color: _kText, fontSize: 17,
            fontWeight: FontWeight.w600, fontFamily: 'Inter',
          ),
          textAlign: TextAlign.center,
          decoration: InputDecoration(
            hintText:         hint,
            hintStyle:        const TextStyle(color: _kMuted, fontSize: 15),
            suffixText:       suffix,
            suffixStyle:      const TextStyle(color: _kMuted, fontSize: 13),
            filled:           true,
            fillColor:        const Color(0xFF0F1117),
            border:           OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: const BorderSide(color: _kBorder),
            ),
            enabledBorder:    OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: const BorderSide(color: _kBorder),
            ),
            focusedBorder:    OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: const BorderSide(color: _kCyan, width: 1.5),
            ),
            contentPadding: const EdgeInsets.symmetric(
                horizontal: 14, vertical: 0),
          ),
        ),
      );
}

// ── Glucose ───────────────────────────────────────────────────────────────────

class _GlucoseSection extends StatelessWidget {
  final TextEditingController controller;
  const _GlucoseSection({required this.controller});

  @override
  Widget build(BuildContext context) => _SectionCard(
        title:     'Blood Glucose',
        icon:      Icons.water_drop_rounded,
        iconColor: _kCyan,
        iconBg:    _kCyan.withValues(alpha: 0.15),
        child: Row(
          children: [
            Expanded(
              child: _DarkField(
                  controller:  controller,
                  hint:        '---',
                  suffix:      'mg/dL'),
            ),
            const SizedBox(width: 12),
            _RangeLabel(
              normal:   '70–100',
              elevated: '101–125',
              high:     '≥ 126',
            ),
          ],
        ),
      );
}

class _RangeLabel extends StatelessWidget {
  final String normal;
  final String elevated;
  final String high;
  const _RangeLabel(
      {required this.normal, required this.elevated, required this.high});

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _dot(Colors.greenAccent.shade400, 'Normal  $normal'),
          const SizedBox(height: 4),
          _dot(const Color(0xFFFBBF24), 'Pre  $elevated'),
          const SizedBox(height: 4),
          _dot(_kRed, 'High  $high'),
        ],
      );

  Widget _dot(Color c, String t) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 7, height: 7,
            decoration: BoxDecoration(color: c, shape: BoxShape.circle),
          ),
          const SizedBox(width: 5),
          Text(t,
              style: const TextStyle(
                  color: _kMuted, fontSize: 10.5, fontFamily: 'Inter')),
        ],
      );
}

// ── Blood pressure ────────────────────────────────────────────────────────────

class _BpSection extends StatelessWidget {
  final TextEditingController sysCtrl;
  final TextEditingController diaCtrl;
  const _BpSection({required this.sysCtrl, required this.diaCtrl});

  @override
  Widget build(BuildContext context) => _SectionCard(
        title:     'Blood Pressure',
        icon:      Icons.favorite_rounded,
        iconColor: _kRed,
        iconBg:    _kRed.withValues(alpha: 0.15),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  _DarkField(
                    controller: sysCtrl,
                    hint: '---',
                    suffix: 'mmHg',
                  ),
                  const SizedBox(height: 5),
                  const Text('Systolic',
                      style: TextStyle(
                          color: _kMuted, fontSize: 11, fontFamily: 'Inter')),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Text('/',
                  style: TextStyle(
                    color: _kMuted.withValues(alpha: 0.5),
                    fontSize: 28,
                    fontWeight: FontWeight.w300,
                  )),
            ),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  _DarkField(
                    controller: diaCtrl,
                    hint: '---',
                    suffix: 'mmHg',
                  ),
                  const SizedBox(height: 5),
                  const Text('Diastolic',
                      style: TextStyle(
                          color: _kMuted, fontSize: 11, fontFamily: 'Inter')),
                ],
              ),
            ),
          ],
        ),
      );
}

// ── Mood selector ─────────────────────────────────────────────────────────────

class _MoodSection extends StatelessWidget {
  final MoodLevel?               selected;
  final ValueChanged<MoodLevel?> onSelected;
  const _MoodSection({this.selected, required this.onSelected});

  @override
  Widget build(BuildContext context) => _SectionCard(
        title:     'Mood',
        icon:      Icons.sentiment_satisfied_rounded,
        iconColor: _kVio,
        iconBg:    _kVio.withValues(alpha: 0.15),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceAround,
          children: MoodLevel.values.map((m) {
            final active = selected == m;
            return GestureDetector(
              onTap: () => onSelected(active ? null : m),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 180),
                width:  56,
                height: 64,
                decoration: BoxDecoration(
                  color: active
                      ? _kVio.withValues(alpha: 0.22)
                      : Colors.transparent,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(
                    color: active
                        ? _kVio.withValues(alpha: 0.70)
                        : _kBorder,
                    width: active ? 1.5 : 1,
                  ),
                  boxShadow: active
                      ? [
                          BoxShadow(
                            color:      _kVio.withValues(alpha: 0.25),
                            blurRadius: 12,
                            offset:     Offset.zero,
                          )
                        ]
                      : null,
                ),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    AnimatedScale(
                      scale:    active ? 1.18 : 1.0,
                      duration: const Duration(milliseconds: 180),
                      child: Text(
                        m.emoji,
                        style: const TextStyle(fontSize: 26),
                      ),
                    ),
                    const SizedBox(height: 5),
                    Text(
                      m.label,
                      style: TextStyle(
                        color:      active ? _kText : _kMuted,
                        fontSize:   9,
                        fontWeight: FontWeight.w600,
                        fontFamily: 'Inter',
                      ),
                    ),
                  ],
                ),
              ),
            );
          }).toList(),
        ),
      );
}

// ── Exercise selector ─────────────────────────────────────────────────────────
// Six pill chips — tap to pick duration; tap again to deselect.

const _kExerciseOptions = [
  (minutes:  0, label: 'Rest',   emoji: '🛌'),
  (minutes: 15, label: '15 min', emoji: '🚶'),
  (minutes: 30, label: '30 min', emoji: '🏃'),
  (minutes: 45, label: '45 min', emoji: '⚡'),
  (minutes: 60, label: '1 hr',   emoji: '💪'),
  (minutes: 90, label: '90+ m',  emoji: '🏋️'),
];

class _ExerciseSection extends StatelessWidget {
  final int?               selected;   // exerciseMinutes, null = not set
  final ValueChanged<int?> onSelected;
  const _ExerciseSection({this.selected, required this.onSelected});

  @override
  Widget build(BuildContext context) => _SectionCard(
        title:     'Exercise',
        icon:      Icons.directions_run_rounded,
        iconColor: _kSage,
        iconBg:    _kSageLight,
        child: Wrap(
          spacing: 8,
          runSpacing: 8,
          children: _kExerciseOptions.map((opt) {
            final active = selected == opt.minutes;
            return GestureDetector(
              onTap: () => onSelected(active ? null : opt.minutes),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 180),
                height: 48,
                padding: const EdgeInsets.symmetric(horizontal: 14),
                decoration: BoxDecoration(
                  color: active
                      ? _kSage.withValues(alpha: 0.20)
                      : const Color(0xFF0F1117),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(
                    color: active
                        ? _kSage.withValues(alpha: 0.75)
                        : _kBorder,
                    width: active ? 1.5 : 1,
                  ),
                  boxShadow: active
                      ? [
                          BoxShadow(
                            color:      _kSage.withValues(alpha: 0.20),
                            blurRadius: 10,
                            offset:     Offset.zero,
                          )
                        ]
                      : null,
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(opt.emoji, style: const TextStyle(fontSize: 17)),
                    const SizedBox(width: 7),
                    Text(
                      opt.label,
                      style: TextStyle(
                        color: active ? _kText : _kMuted,
                        fontSize:      13,
                        fontWeight:    FontWeight.w600,
                        fontFamily:    'Inter',
                      ),
                    ),
                  ],
                ),
              ),
            );
          }).toList(),
        ),
      );
}

// ── Food toggle ───────────────────────────────────────────────────────────────

class _FoodSection extends StatelessWidget {
  final bool             logged;
  final ValueChanged<bool> onChanged;
  const _FoodSection({required this.logged, required this.onChanged});

  @override
  Widget build(BuildContext context) => _SectionCard(
        title:     'Meals',
        icon:      Icons.restaurant_rounded,
        iconColor: _kSage,
        iconBg:    _kSageLight,
        child: GestureDetector(
          onTap: () => onChanged(!logged),
          child: AnimatedContainer(
            duration:     const Duration(milliseconds: 200),
            height:       52,
            decoration:   BoxDecoration(
              color: logged
                  ? _kSage.withValues(alpha: 0.18)
                  : const Color(0xFF0F1117),
              borderRadius: BorderRadius.circular(14),
              border:       Border.all(
                color: logged
                    ? _kSage.withValues(alpha: 0.70)
                    : _kBorder,
                width: logged ? 1.5 : 1,
              ),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                AnimatedSwitcher(
                  duration: const Duration(milliseconds: 200),
                  child: Icon(
                    logged
                        ? Icons.check_circle_rounded
                        : Icons.radio_button_unchecked_rounded,
                    key:   ValueKey(logged),
                    color: logged ? _kSage : _kMuted,
                    size:  22,
                  ),
                ),
                const SizedBox(width: 10),
                Text(
                  logged ? 'Meals logged for today ✓' : 'Tap to mark meals as logged',
                  style: TextStyle(
                    color:      logged ? _kText : _kMuted,
                    fontSize:   15,
                    fontWeight: FontWeight.w600,
                    fontFamily: 'Inter',
                  ),
                ),
              ],
            ),
          ),
        ),
      );
}
