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

﻿import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../chats/presentation/providers/chat_messages_provider.dart';
import '../providers/vitals_provider.dart';
import '../../../../core/theme/app_theme.dart';

// ─── Static data ─────────────────────────────────────────────────────────────

/// (emoji, label, chat-friendly sentence fragment)
const _kMoods = [
  ('😊', 'Great',  "I'm feeling great today!"),
  ('🙂', 'Good',   "I'm feeling good today."),
  ('😐', 'Okay',   "I'm feeling okay — nothing great, nothing bad."),
  ('😔', 'Low',    "I'm not feeling my best today."),
  ('😣', 'Unwell', "I'm feeling unwell today."),
];

const _kSymptoms = [
  'Dizzy',
  'Headache',
  'Fatigue',
  'Nausea',
  'Fever',
  'Thirsty',
  'Blurry Vision',
  'Chest Pain',
  'Shortness of Breath',
];

// ─── Focus mode ───────────────────────────────────────────────────────────────

/// Controls which fields are visible when the sheet opens.
enum LogVitalsFocus { all, glucose, bloodPressure, mood, symptoms }

// ─── Sheet widget ─────────────────────────────────────────────────────────────

/// Comprehensive health logging bottom sheet.
///
/// Combines mood selection, blood glucose, blood pressure, symptom chips, and
/// a free-text notes field into a single scrollable modal.
///
/// Pass [switchToChat] = true when opening from TodayHub so that saving
/// automatically flips the hub into chat mode to show Amina's response.
/// Pass [focus] = [LogVitalsFocus.glucose] to show only the glucose field.
class LogVitalsSheet extends ConsumerStatefulWidget {
  final bool           switchToChat;
  final LogVitalsFocus focus;
  const LogVitalsSheet({
    super.key,
    this.switchToChat = false,
    this.focus        = LogVitalsFocus.all,
  });

  @override
  ConsumerState<LogVitalsSheet> createState() => _LogVitalsSheetState();
}

class _LogVitalsSheetState extends ConsumerState<LogVitalsSheet> {
  String? _mood;
  final _glucoseCtrl = TextEditingController();
  final _bpCtrl      = TextEditingController();
  final _notesCtrl   = TextEditingController();
  final Set<String> _symptoms = {};

  @override
  void dispose() {
    _glucoseCtrl.dispose();
    _bpCtrl.dispose();
    _notesCtrl.dispose();
    super.dispose();
  }

  bool get _hasAnyData =>
      _mood != null ||
      _glucoseCtrl.text.trim().isNotEmpty ||
      _bpCtrl.text.trim().isNotEmpty ||
      _symptoms.isNotEmpty ||
      _notesCtrl.text.trim().isNotEmpty;

  // ── Save ───────────────────────────────────────────────────────────────────

  void _save() {
    FocusScope.of(context).unfocus();

    if (!_hasAnyData) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('Please log at least one item before saving.'),
          behavior: SnackBarBehavior.floating,
          margin: const EdgeInsets.all(16),
          shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12)),
        ),
      );
      return;
    }

    // Validate glucose if entered: must be a positive number.
    final glucoseRaw = _glucoseCtrl.text.trim();
    if (glucoseRaw.isNotEmpty) {
      final glucoseVal = double.tryParse(glucoseRaw);
      if (glucoseVal == null || glucoseVal <= 0 || glucoseVal > 800) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: const Text('Glucose must be between 1 and 800 mg/dL.'),
            backgroundColor: Colors.redAccent,
            behavior: SnackBarBehavior.floating,
            margin: const EdgeInsets.all(16),
            shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12)),
          ),
        );
        return;
      }
    }

    // Validate blood pressure format and values if entered.
    final bpRaw = _bpCtrl.text.trim();
    if (bpRaw.isNotEmpty) {
      final parts = bpRaw.split('/');
      final sys = parts.length == 2 ? double.tryParse(parts[0].trim()) : null;
      final dia = parts.length == 2 ? double.tryParse(parts[1].trim()) : null;
      if (sys == null || dia == null || sys <= 0 || dia <= 0) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: const Text(
                'Blood pressure must be "120/80" with two positive values.'),
            backgroundColor: Colors.redAccent,
            behavior: SnackBarBehavior.floating,
            margin: const EdgeInsets.all(16),
            shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12)),
          ),
        );
        return;
      }
    }

    final entry = VitalsEntry(
      id:            DateTime.now().millisecondsSinceEpoch.toString(),
      timestamp:     DateTime.now(),
      mood:          _mood ?? '',
      glucose:       glucoseRaw,
      bloodPressure: bpRaw,
      symptoms:      _symptoms.toList(),
      notes:         _notesCtrl.text.trim(),
    );

    ref.read(vitalsProvider.notifier).add(entry);

    Navigator.of(context).pop();

    // Build a natural-language message so Amina can respond in context.
    ref
        .read(chatSessionsProvider.notifier)
        .sendMessage(_buildChatMessage(entry));

    if (widget.switchToChat) {
      ref.read(isChatActiveProvider.notifier).state = true;
    }

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: const Row(children: [
          Icon(Icons.check_circle_outline_rounded,
              color: Colors.white, size: 18),
          SizedBox(width: 8),
          Text('Health log saved!'),
        ]),
        backgroundColor: Theme.of(context).colorScheme.primary,
        behavior: SnackBarBehavior.floating,
        margin: const EdgeInsets.all(16),
        shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12)),
        duration: const Duration(seconds: 3),
      ),
    );
  }

  String _buildChatMessage(VitalsEntry e) {
    final sb = StringBuffer("I've just logged today's health check-in.");
    if (e.mood.isNotEmpty)
      sb.write(' I am feeling ${e.mood.toLowerCase()} today.');
    if (e.glucose.isNotEmpty)
      sb.write(' My blood glucose is ${e.glucose} mg/dL.');
    if (e.bloodPressure.isNotEmpty)
      sb.write(' My blood pressure reading is ${e.bloodPressure}.');
    if (e.symptoms.isNotEmpty)
      sb.write(' I am experiencing: ${e.symptoms.join(", ")}.');
    if (e.notes.isNotEmpty)
      sb.write(' Additional note: ${e.notes}.');
    return sb.toString();
  }

  // ── Build ──────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final keyboard = MediaQuery.of(context).viewInsets.bottom;
    final cs       = Theme.of(context).colorScheme;
    final amina    = Theme.of(context).extension<AminaColors>()!;

    return SafeArea(
      top: false,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Drag handle
          Center(
            child: Container(
              margin: const EdgeInsets.only(top: 12, bottom: 4),
              width: 36,
              height: 4,
              decoration: BoxDecoration(
                color: amina.cardBorder,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),

          ConstrainedBox(
            constraints: BoxConstraints(
              maxHeight: MediaQuery.of(context).size.height * 0.88,
            ),
            child: SingleChildScrollView(
              keyboardDismissBehavior:
                  ScrollViewKeyboardDismissBehavior.onDrag,
              padding: EdgeInsets.only(bottom: keyboard),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // ── Header ──────────────────────────────────────────────
                    _SheetHeader(focus: widget.focus),
                    const SizedBox(height: 22),

                    if (widget.focus == LogVitalsFocus.glucose) ...[
                      // ── Glucose-only mode ──────────────────────────────────
                      const _SectionLabel('Blood Glucose Reading'),
                      const SizedBox(height: 4),
                      Text(
                        'Enter your current glucose level in mg/dL',
                        style: TextStyle(
                            fontSize: 12,
                            color: cs.onSurfaceVariant.withValues(alpha: 0.75)),
                      ),
                      const SizedBox(height: 16),
                      _VitalsField(
                        controller: _glucoseCtrl,
                        label:     'Blood Glucose',
                        hint:      'mg/dL',
                        icon:      Icons.show_chart_rounded,
                        iconColor: const Color(0xFF3B82F6),
                        iconBg:    const Color(0xFFEFF6FF),
                        inputType: TextInputType.number,
                        inputFormatters: [
                          FilteringTextInputFormatter.digitsOnly
                        ],
                        autofocus: true,
                      ),
                      const SizedBox(height: 16),
                      // Quick reference guide
                      Container(
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color:        const Color(0xFFEFF6FF),
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(
                              color: const Color(0xFF3B82F6)
                                  .withValues(alpha: 0.20)),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'Reference ranges (fasting)',
                              style: TextStyle(
                                fontSize:   12,
                                fontWeight: FontWeight.w700,
                                color:      Color(0xFF1E40AF),
                              ),
                            ),
                            const SizedBox(height: 8),
                            _RangeRow('Normal',   '< 100 mg/dL',  const Color(0xFF16A34A)),
                            _RangeRow('Pre-diabetic', '100–125 mg/dL', const Color(0xFFF59E0B)),
                            _RangeRow('High',     '≥ 126 mg/dL',  const Color(0xFFDC2626)),
                          ],
                        ),
                      ),
                    ] else if (widget.focus == LogVitalsFocus.mood) ...[
                      // ── Mood-only mode ─────────────────────────────────────
                      const _SectionLabel('How are you feeling today?'),
                      const SizedBox(height: 4),
                      Text(
                        'Tap an emoji that best matches your mood right now',
                        style: TextStyle(
                            fontSize: 12,
                            color: cs.onSurfaceVariant.withValues(alpha: 0.75)),
                      ),
                      const SizedBox(height: 24),
                      _MoodRow(
                        selected: _mood,
                        onSelect: (m) => setState(() => _mood = m),
                      ),
                      const SizedBox(height: 20),
                      if (_mood != null)
                        AnimatedContainer(
                          duration: const Duration(milliseconds: 220),
                          padding: const EdgeInsets.all(14),
                          decoration: BoxDecoration(
                            color:        cs.primaryContainer,
                            borderRadius: BorderRadius.circular(14),
                            border: Border.all(
                                color: cs.primary.withValues(alpha: 0.25)),
                          ),
                          child: Row(
                            children: [
                              Text(
                                _kMoods
                                    .firstWhere((m) => m.$2 == _mood)
                                    .$1,
                                style: const TextStyle(fontSize: 26),
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Text(
                                  _kMoods
                                      .firstWhere((m) => m.$2 == _mood)
                                      .$3,
                                  style: TextStyle(
                                    fontSize:   14,
                                    color:      cs.onSurface,
                                    fontWeight: FontWeight.w500,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                    ] else if (widget.focus == LogVitalsFocus.symptoms) ...[
                      // ── Symptoms-only mode ─────────────────────────────────
                      const _SectionLabel('Log Symptoms'),
                      const SizedBox(height: 4),
                      Text(
                        'Select everything you\'re experiencing right now',
                        style: TextStyle(
                            fontSize: 12,
                            color: cs.onSurfaceVariant.withValues(alpha: 0.75)),
                      ),
                      const SizedBox(height: 16),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: _kSymptoms
                            .map((s) => _SymptomChip(
                                  label:    s,
                                  selected: _symptoms.contains(s),
                                  onToggle: () => setState(() => _symptoms
                                      .contains(s)
                                      ? _symptoms.remove(s)
                                      : _symptoms.add(s)),
                                ))
                            .toList(),
                      ),
                      if (_symptoms.isNotEmpty) ...[
                        const SizedBox(height: 20),
                        Container(
                          padding: const EdgeInsets.all(14),
                          decoration: BoxDecoration(
                            color:        const Color(0xFFFFF1F2),
                            borderRadius: BorderRadius.circular(14),
                            border: Border.all(
                                color: const Color(0xFFEF4444)
                                    .withValues(alpha: 0.20)),
                          ),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Icon(Icons.info_outline_rounded,
                                  color: Color(0xFFEF4444), size: 16),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Text(
                                  '${_symptoms.length} symptom${_symptoms.length > 1 ? 's' : ''} selected — Amina will analyse these alongside your recent vitals.',
                                  style: const TextStyle(
                                    fontSize:   13,
                                    color:      Color(0xFF991B1B),
                                    height:     1.4,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ] else if (widget.focus == LogVitalsFocus.bloodPressure) ...[
                      // ── Blood-pressure-only mode ───────────────────────────
                      const _SectionLabel('Blood Pressure Reading'),
                      const SizedBox(height: 4),
                      Text(
                        'Enter systolic/diastolic — e.g. 120/80',
                        style: TextStyle(
                            fontSize: 12,
                            color: cs.onSurfaceVariant.withValues(alpha: 0.75)),
                      ),
                      const SizedBox(height: 16),
                      _VitalsField(
                        controller: _bpCtrl,
                        label:     'Blood Pressure',
                        hint:      '120/80 mmHg',
                        icon:      Icons.favorite_rounded,
                        iconColor: const Color(0xFFEF4444),
                        iconBg:    const Color(0xFFFFF1F2),
                        inputType: TextInputType.text,
                        autofocus: true,
                      ),
                      const SizedBox(height: 16),
                      // Quick reference guide
                      Container(
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color:        const Color(0xFFFFF1F2),
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(
                              color: const Color(0xFFEF4444)
                                  .withValues(alpha: 0.20)),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'Reference ranges (systolic)',
                              style: TextStyle(
                                fontSize:   12,
                                fontWeight: FontWeight.w700,
                                color:      Color(0xFF991B1B),
                              ),
                            ),
                            const SizedBox(height: 8),
                            _RangeRow('Normal',    '< 120 mmHg',    const Color(0xFF16A34A)),
                            _RangeRow('Elevated',  '120–129 mmHg',  const Color(0xFFF59E0B)),
                            _RangeRow('High',      '130–179 mmHg',  const Color(0xFFEF4444)),
                            _RangeRow('Crisis',    '≥ 180 mmHg',    const Color(0xFF7F1D1D)),
                          ],
                        ),
                      ),
                    ] else ...[
                      // ── Full form ──────────────────────────────────────────
                      const _SectionLabel('How are you feeling today?'),
                      const SizedBox(height: 14),
                      _MoodRow(
                        selected: _mood,
                        onSelect: (m) => setState(() => _mood = m),
                      ),

                      const _Divider(),

                      const _SectionLabel("Today's Vitals"),
                      const SizedBox(height: 4),
                      Text(
                        'Leave blank if not measured today',
                        style: TextStyle(
                            fontSize: 12,
                            color: cs.onSurfaceVariant.withValues(alpha: 0.75)),
                      ),
                      const SizedBox(height: 14),
                      Row(
                        children: [
                          Expanded(
                            child: _VitalsField(
                              controller: _glucoseCtrl,
                              label:     'Glucose',
                              hint:      'mg/dL',
                              icon:      Icons.show_chart_rounded,
                              iconColor: const Color(0xFF3B82F6),
                              iconBg:    const Color(0xFFEFF6FF),
                              inputType: TextInputType.number,
                              inputFormatters: [
                                FilteringTextInputFormatter.digitsOnly
                              ],
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: _VitalsField(
                              controller: _bpCtrl,
                              label:     'BP (sys/dia)',
                              hint:      '120/80',
                              icon:      Icons.favorite_rounded,
                              iconColor: const Color(0xFFEF4444),
                              iconBg:    const Color(0xFFFFF1F2),
                              inputType: TextInputType.text,
                            ),
                          ),
                        ],
                      ),

                      const _Divider(),

                      const _SectionLabel('Symptoms'),
                      const SizedBox(height: 4),
                      Text(
                        'Select all that apply',
                        style: TextStyle(
                            fontSize: 12,
                            color: cs.onSurfaceVariant.withValues(alpha: 0.75)),
                      ),
                      const SizedBox(height: 14),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: _kSymptoms
                            .map((s) => _SymptomChip(
                                  label:    s,
                                  selected: _symptoms.contains(s),
                                  onToggle: () => setState(() => _symptoms
                                      .contains(s)
                                      ? _symptoms.remove(s)
                                      : _symptoms.add(s)),
                                ))
                            .toList(),
                      ),

                      const _Divider(),

                      const _SectionLabel('Additional Notes'),
                      const SizedBox(height: 4),
                      Text(
                        'Optional — anything else Amina should know',
                        style: TextStyle(
                            fontSize: 12,
                            color: cs.onSurfaceVariant.withValues(alpha: 0.75)),
                      ),
                      const SizedBox(height: 14),
                      TextFormField(
                        controller: _notesCtrl,
                        maxLines: 3,
                        minLines: 2,
                        style: TextStyle(fontSize: 15, color: cs.onSurface),
                        decoration: InputDecoration(
                          hintText:
                              "e.g. I took my medication late this morning…",
                          hintStyle: TextStyle(
                              color: cs.onSurfaceVariant.withValues(alpha: 0.6),
                              fontSize: 14),
                          filled: true,
                          fillColor: amina.inputFill,
                          contentPadding: const EdgeInsets.symmetric(
                              horizontal: 16, vertical: 14),
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(14),
                            borderSide: BorderSide(color: amina.cardBorder),
                          ),
                          enabledBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(14),
                            borderSide: BorderSide(color: amina.cardBorder),
                          ),
                          focusedBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(14),
                            borderSide: BorderSide(color: cs.primary, width: 1.5),
                          ),
                        ),
                      ),
                    ],

                    const SizedBox(height: 30),

                    // ── Save ─────────────────────────────────────────────────
                    SizedBox(
                      width: double.infinity,
                      height: 54,
                      child: ElevatedButton.icon(
                        onPressed: _save,
                        icon: const Icon(
                            Icons.check_circle_outline_rounded,
                            size: 20),
                        label: const Text('Save Health Log',
                            style: TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w600)),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: cs.primary,
                          foregroundColor: Colors.white,
                          elevation: 0,
                          shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(16)),
                        ),
                      ),
                    ),

                    const SizedBox(height: 10),

                    Center(
                      child: TextButton(
                        onPressed: () => Navigator.of(context).pop(),
                        child: Text('Cancel',
                            style: TextStyle(
                                color: cs.onSurfaceVariant, fontSize: 15)),
                      ),
                    ),
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

// ─── Sheet header ─────────────────────────────────────────────────────────────

class _SheetHeader extends StatelessWidget {
  final LogVitalsFocus focus;
  const _SheetHeader({this.focus = LogVitalsFocus.all});

  @override
  Widget build(BuildContext context) {
    final (iconData, iconColor, iconBg, title, subtitle) = switch (focus) {
      LogVitalsFocus.glucose => (
        Icons.show_chart_rounded,
        const Color(0xFF3B82F6),
        const Color(0xFFEFF6FF),
        'Log Blood Glucose',
        'Track your glucose levels over time',
      ),
      LogVitalsFocus.bloodPressure => (
        Icons.favorite_rounded,
        const Color(0xFFEF4444),
        const Color(0xFFFFF1F2),
        'Log Blood Pressure',
        'Enter as systolic/diastolic (e.g. 120/80)',
      ),
      LogVitalsFocus.mood => (
        Icons.emoji_emotions_outlined,
        const Color(0xFF7C3AED),
        const Color(0xFFF5F3FF),
        'Log Your Mood',
        'How are you feeling right now?',
      ),
      LogVitalsFocus.symptoms => (
        Icons.health_and_safety_outlined,
        const Color(0xFFEF4444),
        const Color(0xFFFFF1F2),
        'Log Symptoms',
        'Tell Amina what you\'re experiencing',
      ),
      LogVitalsFocus.all => (
        Icons.monitor_heart_outlined,
        Theme.of(context).colorScheme.primary,
        Theme.of(context).colorScheme.primaryContainer,
        'Daily Health Log',
        'Mood, vitals, and symptoms in one place',
      ),
    };

    final cs = Theme.of(context).colorScheme;
    return Row(
      children: [
        Container(
          width: 44,
          height: 44,
          alignment: Alignment.center,
          decoration: BoxDecoration(color: iconBg, shape: BoxShape.circle),
          child: Icon(iconData, color: iconColor, size: 24),
        ),
        const SizedBox(width: 14),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: TextStyle(
                fontSize:      20,
                fontWeight:    FontWeight.w700,
                color:         cs.onSurface,
                letterSpacing: -0.3,
              ),
            ),
            const SizedBox(height: 2),
            Text(subtitle,
                style: TextStyle(fontSize: 13, color: cs.onSurfaceVariant)),
          ],
        ),
      ],
    );
  }
}

// ─── Mood row ─────────────────────────────────────────────────────────────────

class _MoodRow extends StatelessWidget {
  final String? selected;
  final ValueChanged<String> onSelect;
  const _MoodRow({required this.selected, required this.onSelect});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceAround,
      children: _kMoods
          .map((m) => _MoodButton(
                emoji:    m.$1,
                label:    m.$2,
                isActive: selected == m.$2,
                onTap:    () => onSelect(m.$2),
              ))
          .toList(),
    );
  }
}

class _MoodButton extends StatelessWidget {
  final String emoji;
  final String label;
  final bool isActive;
  final VoidCallback onTap;
  const _MoodButton({
    required this.emoji,
    required this.label,
    required this.isActive,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    return Column(
      children: [
        AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          decoration: BoxDecoration(
            color: isActive ? cs.primary : amina.inputFill,
            shape: BoxShape.circle,
            border: Border.all(
              color: isActive ? cs.primary : amina.cardBorder,
              width: 2,
            ),
          ),
          child: Material(
            color: Colors.transparent,
            shape: const CircleBorder(),
            child: InkWell(
              onTap: onTap,
              customBorder: const CircleBorder(),
              child: SizedBox(
                width: 52,
                height: 52,
                child: Center(
                  child: Text(emoji,
                      style: const TextStyle(fontSize: 24)),
                ),
              ),
            ),
          ),
        ),
        const SizedBox(height: 6),
        Text(
          label,
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: isActive ? cs.primary : cs.onSurfaceVariant,
          ),
        ),
      ],
    );
  }
}

// ─── Vitals field ─────────────────────────────────────────────────────────────

class _VitalsField extends StatelessWidget {
  final TextEditingController controller;
  final String label;
  final String hint;
  final IconData icon;
  final Color iconColor;
  final Color iconBg;
  final TextInputType inputType;
  final List<TextInputFormatter>? inputFormatters;
  final bool autofocus;

  const _VitalsField({
    required this.controller,
    required this.label,
    required this.hint,
    required this.icon,
    required this.iconColor,
    required this.iconBg,
    required this.inputType,
    this.inputFormatters,
    this.autofocus = false,
  });

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Label row with icon
        Row(
          children: [
            Container(
              width: 28,
              height: 28,
              decoration: BoxDecoration(color: iconBg, shape: BoxShape.circle),
              child: Icon(icon, color: iconColor, size: 15),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                label,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: cs.onSurface,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        TextField(
          controller:      controller,
          keyboardType:    inputType,
          inputFormatters: inputFormatters,
          autofocus:       autofocus,
          style: TextStyle(fontSize: 17, color: cs.onSurface),
          decoration: InputDecoration(
            hintText: hint,
            hintStyle: TextStyle(
                color: cs.onSurfaceVariant.withValues(alpha: 0.5), fontSize: 15),
            filled: true,
            fillColor: amina.inputFill,
            contentPadding: const EdgeInsets.symmetric(
                horizontal: 14, vertical: 14),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: BorderSide(color: amina.cardBorder),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: BorderSide(color: amina.cardBorder),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide:
                  BorderSide(color: iconColor, width: 1.5),
            ),
          ),
        ),
      ],
    );
  }
}

// ─── Symptom chip ─────────────────────────────────────────────────────────────

class _SymptomChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onToggle;
  const _SymptomChip({
    required this.label,
    required this.selected,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 180),
      decoration: BoxDecoration(
        color: selected ? const Color(0xFFFFF1F2) : Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: selected
              ? const Color(0xFFEF4444).withValues(alpha: 0.6)
              : Theme.of(context).extension<AminaColors>()!.cardBorder,
          width: selected ? 1.5 : 1,
        ),
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(20),
        child: InkWell(
          onTap: onToggle,
          borderRadius: BorderRadius.circular(20),
          child: Padding(
            padding: const EdgeInsets.symmetric(
                horizontal: 14, vertical: 10),
            child: Text(
              label,
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w500,
                color: selected
                    ? const Color(0xFFB91C1C)
                    : Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

// ─── Range row (glucose reference guide) ─────────────────────────────────────

class _RangeRow extends StatelessWidget {
  final String label;
  final String range;
  final Color  color;
  const _RangeRow(this.label, this.range, this.color);

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 4),
        child: Row(
          children: [
            Container(
              width: 8, height: 8,
              decoration: BoxDecoration(color: color, shape: BoxShape.circle),
            ),
            const SizedBox(width: 8),
            Text(
              label,
              style: TextStyle(
                fontSize:   12,
                fontWeight: FontWeight.w600,
                color:      color,
              ),
            ),
            const Spacer(),
            Text(
              range,
              style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurfaceVariant),
            ),
          ],
        ),
      );
}

// ─── Shared layout helpers ────────────────────────────────────────────────────

class _SectionLabel extends StatelessWidget {
  final String text;
  const _SectionLabel(this.text);

  @override
  Widget build(BuildContext context) => Text(
        text,
        style: TextStyle(
          fontSize: 15,
          fontWeight: FontWeight.w700,
          color: Theme.of(context).colorScheme.onSurface,
        ),
      );
}

class _Divider extends StatelessWidget {
  const _Divider();

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 20),
        child: Divider(height: 1, color: Theme.of(context).extension<AminaColors>()!.cardBorder),
      );
}

// ─── Convenience function ─────────────────────────────────────────────────────

/// Open the unified health logging sheet.
///
/// Set [switchToChat] to true when called from TodayHub so the hub
/// flips to chat mode after saving, letting the user see Amina's response.
/// Set [focus] to [LogVitalsFocus.glucose] to show only the glucose field.
void showLogVitalsSheet(
  BuildContext context, {
  bool           switchToChat = false,
  LogVitalsFocus focus        = LogVitalsFocus.all,
}) {
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: Theme.of(context).colorScheme.surface,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
    ),
    builder: (_) => LogVitalsSheet(switchToChat: switchToChat, focus: focus),
  );
}
