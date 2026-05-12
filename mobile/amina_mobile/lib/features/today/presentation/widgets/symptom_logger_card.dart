import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../chats/presentation/providers/chat_messages_provider.dart';

import '../../../../core/theme/app_theme.dart';

// ─── Data ─────────────────────────────────────────────────────────────────────

class _Feeling {
  final String emoji;
  final String label;
  final String chatMessage;
  const _Feeling(this.emoji, this.label, this.chatMessage);
}

class _Symptom {
  final String emoji;
  final String label;
  const _Symptom(this.emoji, this.label);
}

const _feelings = [
  _Feeling('😊', 'Great',
      "I'm feeling great today! Everything seems good."),
  _Feeling('🙂', 'Good',
      "I'm feeling good today, no major issues to report."),
  _Feeling('😐', 'Okay',
      "I'm feeling okay today — nothing too good or bad."),
  _Feeling('😔', 'Low',
      "I'm not feeling my best today. I'd like to log how I feel."),
  _Feeling('😣', 'Unwell',
      "I'm feeling unwell today and want to report a symptom."),
];

const _symptoms = [
  _Symptom('💫', 'Dizzy'),
  _Symptom('🤕', 'Headache'),
  _Symptom('😴', 'Fatigue'),
  _Symptom('🤢', 'Nausea'),
  _Symptom('🌡️', 'Fever'),
];

// ─── Card ─────────────────────────────────────────────────────────────────────

/// "How are you feeling today?" card on the TodayHub dashboard.
///
/// Tapping a mood emoji sets [isChatActiveProvider] to true and sends a
/// pre-filled message so Amina can immediately respond in context.
/// Tapping a quick-symptom chip does the same with a specific symptom message.
class SymptomLoggerCard extends ConsumerWidget {
  const SymptomLoggerCard({super.key});

  void _logFeeling(WidgetRef ref, _Feeling f) {
    unawaited(ref.read(chatSessionsProvider.notifier).sendMessage(f.chatMessage));
  }

  void _logSymptom(WidgetRef ref, _Symptom s) {
    unawaited(ref.read(chatSessionsProvider.notifier).sendMessage(
      "I'm experiencing ${s.label.toLowerCase()}. I'd like to log this symptom.",
    ));
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: cs.surface,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: amina.cardBorder),
        boxShadow: const [
          BoxShadow(
            color: Color(0x07000000),
            blurRadius: 20,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // ── Header ───────────────────────────────────────────────────────
          Row(
            children: [
              Container(
                width: 40,
                height: 40,
                alignment: Alignment.center,
                decoration: const BoxDecoration(
                  color: Color(0xFFFFF1F2),
                  shape: BoxShape.circle,
                ),
                child: const Text('🩺', style: TextStyle(fontSize: 20)),
              ),
              const SizedBox(width: 12),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'How are you feeling today?',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      color: cs.onSurface,
                      letterSpacing: -0.2,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'Tap a mood — Amina will check in with you',
                    style: TextStyle(fontSize: 13, color: cs.onSurfaceVariant),
                  ),
                ],
              ),
            ],
          ),

          const SizedBox(height: 18),

          // ── Mood row ──────────────────────────────────────────────────────
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: _feelings
                .map((f) => _FeelingButton(
                      feeling: f,
                      onTap: () => _logFeeling(ref, f),
                    ))
                .toList(),
          ),

          Padding(
            padding: const EdgeInsets.symmetric(vertical: 16),
            child: Divider(height: 1, color: amina.cardBorder),
          ),

          // ── Quick symptom chips ───────────────────────────────────────────
          Text(
            'QUICK SYMPTOM LOG',
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w700,
              color: cs.onSurfaceVariant,
              letterSpacing: 0.8,
            ),
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: _symptoms
                .map((s) => _SymptomChip(
                      symptom: s,
                      onTap: () => _logSymptom(ref, s),
                    ))
                .toList(),
          ),
        ],
      ),
    );
  }
}

// ─── Feeling button ───────────────────────────────────────────────────────────

class _FeelingButton extends StatelessWidget {
  final _Feeling feeling;
  final VoidCallback onTap;
  const _FeelingButton({required this.feeling, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    return Column(
      children: [
        // Large circle — 52 × 52 gives seniors a comfortable tap target.
        Material(
          color: amina.inputFill,
          shape: CircleBorder(
            side: BorderSide(color: amina.cardBorder),
          ),
          child: InkWell(
            onTap: onTap,
            customBorder: const CircleBorder(),
            splashColor: const Color(0xFFF78B8B).withValues(alpha: 0.15),
            child: SizedBox(
              width: 52,
              height: 52,
              child: Center(
                child: Text(
                  feeling.emoji,
                  style: const TextStyle(fontSize: 24),
                ),
              ),
            ),
          ),
        ),
        const SizedBox(height: 6),
        Text(
          feeling.label,
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w500,
            color: cs.onSurfaceVariant,
          ),
        ),
      ],
    );
  }
}

// ─── Symptom chip ─────────────────────────────────────────────────────────────

class _SymptomChip extends StatelessWidget {
  final _Symptom symptom;
  final VoidCallback onTap;
  const _SymptomChip({required this.symptom, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFFFFF1F2),
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        splashColor: const Color(0xFFF78B8B).withValues(alpha: 0.2),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(symptom.emoji, style: const TextStyle(fontSize: 16)),
              const SizedBox(width: 6),
              Text(
                symptom.label,
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w500,
                  color: Color(0xFFB91C1C),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
