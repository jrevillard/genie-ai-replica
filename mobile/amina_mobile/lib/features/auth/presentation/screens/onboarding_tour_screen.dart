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

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/navigation_menu.dart';

// ═══════════════════════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════════════════════

enum LiteracyLevel { simple, detailed }

class OnboardingTourState {
  final int            pageIndex;
  final Set<String>    selectedGoals;
  final LiteracyLevel? literacyLevel;

  const OnboardingTourState({
    this.pageIndex     = 0,
    this.selectedGoals = const {},
    this.literacyLevel,
  });

  OnboardingTourState copyWith({
    int?             pageIndex,
    Set<String>?     selectedGoals,
    LiteracyLevel?   literacyLevel,
  }) =>
      OnboardingTourState(
        pageIndex:     pageIndex     ?? this.pageIndex,
        selectedGoals: selectedGoals ?? this.selectedGoals,
        literacyLevel: literacyLevel ?? this.literacyLevel,
      );
}

class OnboardingTourNotifier extends StateNotifier<OnboardingTourState> {
  OnboardingTourNotifier() : super(const OnboardingTourState());

  void goToPage(int index) => state = state.copyWith(pageIndex: index);

  void toggleGoal(String goal) {
    final updated = Set<String>.from(state.selectedGoals);
    if (updated.contains(goal)) {
      updated.remove(goal);
    } else {
      updated.add(goal);
    }
    state = state.copyWith(selectedGoals: updated);
  }

  void setLiteracy(LiteracyLevel level) =>
      state = state.copyWith(literacyLevel: level);
}

final onboardingTourProvider =
    StateNotifierProvider<OnboardingTourNotifier, OnboardingTourState>(
  (_) => OnboardingTourNotifier(),
);

// ═══════════════════════════════════════════════════════════════════════════════
// Design tokens (dark-only premium aesthetic)
// ═══════════════════════════════════════════════════════════════════════════════

const _kBg          = Color(0xFF0F1117);
const _kCard        = Color(0xFF181C26);
const _kCardBorder  = Color(0xFF252A38);
const _kSage        = Color(0xFF3D9970);
const _kSageGlow    = Color(0x263D9970);
const _kOnSurface   = Color(0xFFE8EAF0);
const _kMuted       = Color(0xFF8B91A8);
const _kOverlay     = Color(0xFF1E2233);

// Goal palette
const _kGoalMed     = Color(0xFF6366F1); // indigo
const _kGoalSym     = Color(0xFF10B981); // emerald
const _kGoalChat    = Color(0xFFF59E0B); // amber
const _kGoalFamily  = Color(0xFF8B5CF6); // violet

// ═══════════════════════════════════════════════════════════════════════════════
// Screen
// ═══════════════════════════════════════════════════════════════════════════════

class OnboardingTourScreen extends ConsumerStatefulWidget {
  const OnboardingTourScreen({super.key});

  @override
  ConsumerState<OnboardingTourScreen> createState() =>
      _OnboardingTourScreenState();
}

class _OnboardingTourScreenState extends ConsumerState<OnboardingTourScreen>
    with TickerProviderStateMixin {
  static const _totalPages = 5;

  late final PageController        _pageCtrl;
  late final AnimationController   _progressCtrl;
  late final Animation<double>     _progressAnim;

  @override
  void initState() {
    super.initState();
    _pageCtrl     = PageController();
    _progressCtrl = AnimationController(
      vsync:    this,
      duration: const Duration(milliseconds: 380),
    );
    _progressAnim = CurvedAnimation(
      parent: _progressCtrl,
      curve:  Curves.easeInOut,
    );
    // page 0 → progress value 1/_totalPages
    _progressCtrl.value = 1 / _totalPages;
  }

  @override
  void dispose() {
    _pageCtrl.dispose();
    _progressCtrl.dispose();
    super.dispose();
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  void _advance() {
    final current = ref.read(onboardingTourProvider).pageIndex;
    if (current >= _totalPages - 1) return;
    final next = current + 1;
    ref.read(onboardingTourProvider.notifier).goToPage(next);
    _pageCtrl.animateToPage(
      next,
      duration: const Duration(milliseconds: 420),
      curve:    Curves.easeInOutCubic,
    );
    _progressCtrl.animateTo(
      (next + 1) / _totalPages,
      duration: const Duration(milliseconds: 420),
      curve:    Curves.easeInOut,
    );
  }

  void _back() {
    final current = ref.read(onboardingTourProvider).pageIndex;
    if (current == 0) return;
    final prev = current - 1;
    ref.read(onboardingTourProvider.notifier).goToPage(prev);
    _pageCtrl.animateToPage(
      prev,
      duration: const Duration(milliseconds: 380),
      curve:    Curves.easeInOutCubic,
    );
    _progressCtrl.animateTo(
      (prev + 1) / _totalPages,
      duration: const Duration(milliseconds: 380),
      curve:    Curves.easeInOut,
    );
  }

  void _finish() {
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const MainNavigation()),
      (_) => false,
    );
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final tourState = ref.watch(onboardingTourProvider);

    return Scaffold(
      backgroundColor: _kBg,
      body: SafeArea(
        child: Column(
          children: [
            // ── Progress bar + back ──────────────────────────────────────
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
              child: Row(
                children: [
                  // Back button
                  AnimatedOpacity(
                    duration: const Duration(milliseconds: 200),
                    opacity:  tourState.pageIndex > 0 ? 1.0 : 0.0,
                    child: GestureDetector(
                      onTap: tourState.pageIndex > 0 ? _back : null,
                      behavior: HitTestBehavior.opaque,
                      child: Container(
                        width:  40,
                        height: 40,
                        decoration: BoxDecoration(
                          color:        _kCard,
                          borderRadius: BorderRadius.circular(12),
                          border:       Border.all(color: _kCardBorder),
                        ),
                        child: const Icon(
                          Icons.arrow_back_ios_new_rounded,
                          color: _kOnSurface,
                          size:  18,
                        ),
                      ),
                    ),
                  ),

                  const SizedBox(width: 14),

                  // Progress bar
                  Expanded(
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(8),
                      child: SizedBox(
                        height: 5,
                        child: AnimatedBuilder(
                          animation: _progressAnim,
                          builder: (_, child) => LinearProgressIndicator(
                            value:            _progressAnim.value,
                            backgroundColor:  _kCardBorder,
                            valueColor:
                                const AlwaysStoppedAnimation<Color>(_kSage),
                          ),
                        ),
                      ),
                    ),
                  ),

                  const SizedBox(width: 14),

                  // Step counter
                  SizedBox(
                    width: 40,
                    child: Text(
                      '${tourState.pageIndex + 1}/$_totalPages',
                      textAlign: TextAlign.right,
                      style: const TextStyle(
                        fontSize:   12,
                        color:      _kMuted,
                        fontFamily: 'Inter',
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 8),

            // ── Pages ────────────────────────────────────────────────────
            Expanded(
              child: PageView(
                controller:   _pageCtrl,
                physics:      const NeverScrollableScrollPhysics(),
                onPageChanged: (i) =>
                    ref.read(onboardingTourProvider.notifier).goToPage(i),
                children: [
                  _WelcomePage(onNext: _advance),
                  _GoalAlignmentPage(onNext: _advance),
                  _LiteracyCalibrationPage(onNext: _advance),
                  _FeatureTourPage(onNext: _advance),
                  _TourCompletePage(onFinish: _finish),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Page 1 — Welcome & Introduction
// ═══════════════════════════════════════════════════════════════════════════════

class _WelcomePage extends StatelessWidget {
  final VoidCallback onNext;
  const _WelcomePage({required this.onNext});

  @override
  Widget build(BuildContext context) => SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(28, 24, 28, 32),
        child: Column(
          children: [
            // Pulsing Amina avatar
            const _PulsingGlowAvatar(),

            const SizedBox(height: 32),

            // Heading
            const Text(
              'Hello! I\'m Amina 🌿',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize:      30,
                fontWeight:    FontWeight.w800,
                color:         _kOnSurface,
                letterSpacing: -0.8,
                fontFamily:    'Inter',
                height:        1.15,
              ),
            ),

            const SizedBox(height: 14),

            // Warm text bubble
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color:        _kCard,
                borderRadius: const BorderRadius.only(
                  topLeft:     Radius.circular(4),
                  topRight:    Radius.circular(24),
                  bottomLeft:  Radius.circular(24),
                  bottomRight: Radius.circular(24),
                ),
                border: Border.all(color: _kSage.withValues(alpha: 0.30)),
                boxShadow: [
                  BoxShadow(
                    color:      _kSageGlow,
                    blurRadius: 30,
                    offset:     const Offset(0, 8),
                  ),
                ],
              ),
              child: const Text(
                'I\'m your personal health companion — here to help you track medications, understand your body, and keep your loved ones in the loop. 💚\n\nLet me show you around in just a few steps.',
                style: TextStyle(
                  fontSize:   17,
                  color:      _kOnSurface,
                  fontFamily: 'Inter',
                  height:     1.60,
                ),
              ),
            ),

            const SizedBox(height: 28),

            // Feature highlights row
            const Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                _MiniHighlight(icon: '💊', label: 'Medications'),
                _MiniHighlight(icon: '🩺', label: 'Vitals'),
                _MiniHighlight(icon: '💬', label: 'AI Chat'),
                _MiniHighlight(icon: '👨‍👩‍👧', label: 'Family'),
              ],
            ),

            const SizedBox(height: 36),

            _GlowButton(
              label:     'Get started',
              onPressed: onNext,
            ),

            const SizedBox(height: 16),
            const Text(
              'Takes about 2 minutes · No account needed yet',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize:   13,
                color:      _kMuted,
                fontFamily: 'Inter',
              ),
            ),
          ],
        ),
      );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Page 2 — Goal Alignment
// ═══════════════════════════════════════════════════════════════════════════════

class _GoalAlignmentPage extends ConsumerWidget {
  final VoidCallback onNext;
  const _GoalAlignmentPage({required this.onNext});

  static const _goals = [
    (
      id:    'medications',
      emoji: '💊',
      title: 'Medications',
      desc:  'Track doses and set reminders',
      color: _kGoalMed,
    ),
    (
      id:    'symptoms',
      emoji: '🩺',
      title: 'Symptoms & Vitals',
      desc:  'Log how you feel each day',
      color: _kGoalSym,
    ),
    (
      id:    'chat',
      emoji: '💬',
      title: 'Health Conversations',
      desc:  'Ask Amina anything',
      color: _kGoalChat,
    ),
    (
      id:    'family',
      emoji: '👨‍👩‍👧',
      title: 'Family Updates',
      desc:  'Keep caregivers informed',
      color: _kGoalFamily,
    ),
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final selected = ref.watch(onboardingTourProvider).selectedGoals;
    final notifier = ref.read(onboardingTourProvider.notifier);
    final canContinue = selected.isNotEmpty;

    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(24, 16, 24, 32),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'What matters\nmost to you?',
            style: TextStyle(
              fontSize:      30,
              fontWeight:    FontWeight.w800,
              color:         _kOnSurface,
              letterSpacing: -0.8,
              fontFamily:    'Inter',
              height:        1.2,
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            'Pick everything that applies — Amina will personalise your experience.',
            style: TextStyle(
              fontSize:   16,
              color:      _kMuted,
              fontFamily: 'Inter',
              height:     1.5,
            ),
          ),

          const SizedBox(height: 28),

          ...List.generate(_goals.length, (i) {
            final goal = _goals[i];
            final isOn = selected.contains(goal.id);
            return Padding(
              padding: const EdgeInsets.only(bottom: 14),
              child: _GoalCard(
                emoji:     goal.emoji,
                title:     goal.title,
                desc:      goal.desc,
                color:     goal.color,
                selected:  isOn,
                onTap:     () => notifier.toggleGoal(goal.id),
              ),
            );
          }),

          const SizedBox(height: 8),

          _GlowButton(
            label:     'Continue',
            onPressed: canContinue ? onNext : null,
          ),
        ],
      ),
    );
  }
}

class _GoalCard extends StatelessWidget {
  final String       emoji;
  final String       title;
  final String       desc;
  final Color        color;
  final bool         selected;
  final VoidCallback onTap;

  const _GoalCard({
    required this.emoji,
    required this.title,
    required this.desc,
    required this.color,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) => GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: AnimatedContainer(
          duration:  const Duration(milliseconds: 220),
          padding:   const EdgeInsets.all(18),
          constraints: const BoxConstraints(minHeight: 72),
          decoration: BoxDecoration(
            color:        selected
                ? color.withValues(alpha: 0.12)
                : _kCard,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(
              color: selected
                  ? color.withValues(alpha: 0.55)
                  : _kCardBorder,
              width: selected ? 1.8 : 1.3,
            ),
            boxShadow: selected
                ? [
                    BoxShadow(
                      color:      color.withValues(alpha: 0.18),
                      blurRadius: 18,
                      offset:     const Offset(0, 4),
                    ),
                  ]
                : null,
          ),
          child: Row(
            children: [
              // Emoji circle
              Container(
                width:  52,
                height: 52,
                decoration: BoxDecoration(
                  color: selected
                      ? color.withValues(alpha: 0.20)
                      : _kOverlay,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Center(
                  child: Text(emoji,
                      style: const TextStyle(fontSize: 24)),
                ),
              ),

              const SizedBox(width: 16),

              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: TextStyle(
                        fontSize:   18,
                        fontWeight: FontWeight.w700,
                        color:      selected ? color : _kOnSurface,
                        fontFamily: 'Inter',
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      desc,
                      style: const TextStyle(
                        fontSize:   14,
                        color:      _kMuted,
                        fontFamily: 'Inter',
                      ),
                    ),
                  ],
                ),
              ),

              // Check mark
              AnimatedContainer(
                duration:     const Duration(milliseconds: 220),
                width:        26,
                height:       26,
                decoration: BoxDecoration(
                  color: selected ? color : Colors.transparent,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                    color: selected ? color : _kCardBorder,
                    width: 1.8,
                  ),
                ),
                child: selected
                    ? const Icon(Icons.check_rounded,
                        color: Colors.white, size: 16)
                    : null,
              ),
            ],
          ),
        ),
      );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Page 3 — Literacy Calibration
// ═══════════════════════════════════════════════════════════════════════════════

class _LiteracyCalibrationPage extends ConsumerWidget {
  final VoidCallback onNext;
  const _LiteracyCalibrationPage({required this.onNext});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final level   = ref.watch(onboardingTourProvider).literacyLevel;
    final notifier = ref.read(onboardingTourProvider.notifier);

    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(24, 16, 24, 32),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'How do you like\nhealth information?',
            style: TextStyle(
              fontSize:      30,
              fontWeight:    FontWeight.w800,
              color:         _kOnSurface,
              letterSpacing: -0.8,
              fontFamily:    'Inter',
              height:        1.2,
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            'Amina adapts its language to what feels natural for you.',
            style: TextStyle(
              fontSize:   16,
              color:      _kMuted,
              fontFamily: 'Inter',
              height:     1.5,
            ),
          ),

          const SizedBox(height: 32),

          _LiteracyOption(
            emoji:    '🌸',
            title:    'Keep it simple',
            desc:     'Plain language, everyday words, clear explanations — no jargon.',
            selected: level == LiteracyLevel.simple,
            onTap:    () => notifier.setLiteracy(LiteracyLevel.simple),
          ),

          const SizedBox(height: 16),

          _LiteracyOption(
            emoji:    '🔬',
            title:    'Give me the details',
            desc:     'Medical terms, clinical values, full context — I can handle it.',
            selected: level == LiteracyLevel.detailed,
            onTap:    () => notifier.setLiteracy(LiteracyLevel.detailed),
          ),

          const SizedBox(height: 14),

          // Example snippet
          AnimatedSwitcher(
            duration: const Duration(milliseconds: 280),
            child: level == null
                ? const SizedBox(height: 80, key: ValueKey('none'))
                : Container(
                    key:     ValueKey(level),
                    padding: const EdgeInsets.all(18),
                    decoration: BoxDecoration(
                      color:        _kCard,
                      borderRadius: BorderRadius.circular(18),
                      border:       Border.all(color: _kCardBorder),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          '✨  Example response from Amina:',
                          style: TextStyle(
                            fontSize:   12,
                            color:      _kMuted,
                            fontFamily: 'Inter',
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 10),
                        Text(
                          level == LiteracyLevel.simple
                              ? '"Your blood sugar is a bit high today — 185 mg/dL. Try a short walk after meals and drink some water. I\'ll remind you to check again in 2 hours. 💧"'
                              : '"Postprandial glucose reading: 185 mg/dL (above target range of <140 mg/dL). Recommend 20-min aerobic activity to enhance insulin sensitivity. Scheduled re-check in 2 h."',
                          style: const TextStyle(
                            fontSize:   15,
                            color:      _kOnSurface,
                            fontFamily: 'Inter',
                            height:     1.55,
                            fontStyle:  FontStyle.italic,
                          ),
                        ),
                      ],
                    ),
                  ),
          ),

          const SizedBox(height: 28),

          _GlowButton(
            label:     'Continue',
            onPressed: level != null ? onNext : null,
          ),

          const SizedBox(height: 12),
          const Center(
            child: Text(
              'You can change this any time in Settings.',
              style: TextStyle(
                fontSize:   13,
                color:      _kMuted,
                fontFamily: 'Inter',
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _LiteracyOption extends StatelessWidget {
  final String       emoji;
  final String       title;
  final String       desc;
  final bool         selected;
  final VoidCallback onTap;

  const _LiteracyOption({
    required this.emoji,
    required this.title,
    required this.desc,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) => GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: AnimatedContainer(
          duration:    const Duration(milliseconds: 220),
          padding:     const EdgeInsets.all(20),
          constraints: const BoxConstraints(minHeight: 80),
          decoration: BoxDecoration(
            color:        selected
                ? _kSage.withValues(alpha: 0.10)
                : _kCard,
            borderRadius: BorderRadius.circular(22),
            border: Border.all(
              color: selected
                  ? _kSage.withValues(alpha: 0.55)
                  : _kCardBorder,
              width: selected ? 1.8 : 1.3,
            ),
            boxShadow: selected
                ? [
                    BoxShadow(
                      color:      _kSage.withValues(alpha: 0.18),
                      blurRadius: 20,
                      offset:     const Offset(0, 4),
                    ),
                  ]
                : null,
          ),
          child: Row(
            children: [
              Text(emoji, style: const TextStyle(fontSize: 30)),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: TextStyle(
                        fontSize:   18,
                        fontWeight: FontWeight.w700,
                        color:      selected ? _kSage : _kOnSurface,
                        fontFamily: 'Inter',
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      desc,
                      style: const TextStyle(
                        fontSize:   14,
                        color:      _kMuted,
                        fontFamily: 'Inter',
                        height:     1.45,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              AnimatedContainer(
                duration:     const Duration(milliseconds: 220),
                width:        26,
                height:       26,
                decoration: BoxDecoration(
                  color: selected ? _kSage : Colors.transparent,
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: selected ? _kSage : _kCardBorder,
                    width: 1.8,
                  ),
                ),
                child: selected
                    ? const Icon(Icons.check_rounded,
                        color: Colors.white, size: 15)
                    : null,
              ),
            ],
          ),
        ),
      );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Page 4 — Interactive Feature Tour
// ═══════════════════════════════════════════════════════════════════════════════

class _FeatureTourPage extends StatelessWidget {
  final VoidCallback onNext;
  const _FeatureTourPage({required this.onNext});

  @override
  Widget build(BuildContext context) => SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(24, 16, 24, 32),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Here\'s what\'s\nwaiting for you',
              style: TextStyle(
                fontSize:      30,
                fontWeight:    FontWeight.w800,
                color:         _kOnSurface,
                letterSpacing: -0.8,
                fontFamily:    'Inter',
                height:        1.2,
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'A quick look at your three most powerful tools.',
              style: TextStyle(
                fontSize:   16,
                color:      _kMuted,
                fontFamily: 'Inter',
              ),
            ),

            const SizedBox(height: 28),

            // Medication Alert preview
            _FeatureCard(
              emoji:    '💊',
              title:    'Medication Alerts',
              subtitle: 'Never miss a dose',
              accentColor: _kGoalMed,
              preview: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _MiniMedRow(
                      name: 'Metformin 500mg',
                      time: '8:00 AM',
                      taken: true),
                  const SizedBox(height: 8),
                  _MiniMedRow(
                      name: 'Lisinopril 10mg',
                      time: '8:00 PM',
                      taken: false),
                ],
              ),
            ),

            const SizedBox(height: 16),

            // Symptom Logging preview
            _FeatureCard(
              emoji:    '🩺',
              title:    'Symptom Logging',
              subtitle: 'Track how you feel',
              accentColor: _kGoalSym,
              preview: Wrap(
                spacing:    8,
                runSpacing: 8,
                children: const [
                  _MiniSymptomChip(label: '😌  Feeling good'),
                  _MiniSymptomChip(label: '🤕  Headache'),
                  _MiniSymptomChip(label: '😴  Fatigue'),
                ],
              ),
            ),

            const SizedBox(height: 16),

            // Caregiver SOS preview
            _FeatureCard(
              emoji:    '🆘',
              title:    'Caregiver SOS',
              subtitle: 'Family stays informed',
              accentColor: _kGoalFamily,
              preview: Container(
                padding: const EdgeInsets.symmetric(
                    horizontal: 14, vertical: 10),
                decoration: BoxDecoration(
                  color:        _kGoalFamily.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(14),
                  border:       Border.all(
                      color: _kGoalFamily.withValues(alpha: 0.30)),
                ),
                child: const Row(
                  children: [
                    Icon(Icons.family_restroom_rounded,
                        color: _kGoalFamily, size: 18),
                    SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'Maria R. — Last seen 2 min ago · Glucose 142 mg/dL',
                        style: TextStyle(
                          fontSize:   13,
                          color:      _kOnSurface,
                          fontFamily: 'Inter',
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),

            const SizedBox(height: 32),

            _GlowButton(
              label:     'Looks great!',
              onPressed: onNext,
            ),
          ],
        ),
      );
}

class _FeatureCard extends StatelessWidget {
  final String  emoji;
  final String  title;
  final String  subtitle;
  final Color   accentColor;
  final Widget  preview;

  const _FeatureCard({
    required this.emoji,
    required this.title,
    required this.subtitle,
    required this.accentColor,
    required this.preview,
  });

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color:        _kCard,
          borderRadius: BorderRadius.circular(24),
          border:       Border.all(color: _kCardBorder),
          boxShadow: [
            BoxShadow(
              color:      accentColor.withValues(alpha: 0.08),
              blurRadius: 22,
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
                  width:  44,
                  height: 44,
                  decoration: BoxDecoration(
                    color:        accentColor.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Center(
                    child: Text(emoji,
                        style: const TextStyle(fontSize: 22)),
                  ),
                ),
                const SizedBox(width: 14),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: TextStyle(
                        fontSize:   17,
                        fontWeight: FontWeight.w700,
                        color:      accentColor,
                        fontFamily: 'Inter',
                      ),
                    ),
                    Text(
                      subtitle,
                      style: const TextStyle(
                        fontSize:   13,
                        color:      _kMuted,
                        fontFamily: 'Inter',
                      ),
                    ),
                  ],
                ),
              ],
            ),

            const SizedBox(height: 16),
            const Divider(color: _kCardBorder, height: 1),
            const SizedBox(height: 14),

            preview,
          ],
        ),
      );
}

class _MiniMedRow extends StatelessWidget {
  final String name;
  final String time;
  final bool   taken;
  const _MiniMedRow({
    required this.name,
    required this.time,
    required this.taken,
  });

  @override
  Widget build(BuildContext context) => Row(
        children: [
          Container(
            width:  30,
            height: 30,
            decoration: BoxDecoration(
              color:        taken
                  ? _kSage.withValues(alpha: 0.15)
                  : _kOverlay,
              borderRadius: BorderRadius.circular(9),
              border: Border.all(
                color: taken
                    ? _kSage.withValues(alpha: 0.40)
                    : _kCardBorder,
              ),
            ),
            child: Icon(
              taken ? Icons.check_rounded : Icons.schedule_rounded,
              color: taken ? _kSage : _kMuted,
              size:  15,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              name,
              style: TextStyle(
                fontSize:   14,
                fontFamily: 'Inter',
                color:      taken ? _kMuted : _kOnSurface,
                decoration: taken ? TextDecoration.lineThrough : null,
                decorationColor: _kMuted,
              ),
            ),
          ),
          Text(
            time,
            style: const TextStyle(
              fontSize:   12,
              color:      _kMuted,
              fontFamily: 'Inter',
            ),
          ),
        ],
      );
}

class _MiniSymptomChip extends StatelessWidget {
  final String label;
  const _MiniSymptomChip({required this.label});

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
        decoration: BoxDecoration(
          color:        _kGoalSym.withValues(alpha: 0.10),
          borderRadius: BorderRadius.circular(20),
          border:       Border.all(color: _kGoalSym.withValues(alpha: 0.30)),
        ),
        child: Text(
          label,
          style: const TextStyle(
            fontSize:   13,
            color:      _kOnSurface,
            fontFamily: 'Inter',
          ),
        ),
      );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Page 5 — Tour Complete
// ═══════════════════════════════════════════════════════════════════════════════

class _TourCompletePage extends ConsumerWidget {
  final VoidCallback onFinish;
  const _TourCompletePage({required this.onFinish});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(onboardingTourProvider);

    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(28, 24, 28, 40),
      child: Column(
        children: [
          // Celebration avatar
          Container(
            width:  96,
            height: 96,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: const RadialGradient(
                colors: [Color(0xFF3D9970), Color(0xFF1E6B4A)],
              ),
              boxShadow: [
                BoxShadow(
                  color:      _kSage.withValues(alpha: 0.45),
                  blurRadius: 40,
                  spreadRadius: 4,
                ),
              ],
            ),
            child: const Center(
              child: Text('🎉', style: TextStyle(fontSize: 44)),
            ),
          ),

          const SizedBox(height: 28),

          const Text(
            'You\'re all set!',
            style: TextStyle(
              fontSize:      32,
              fontWeight:    FontWeight.w800,
              color:         _kOnSurface,
              letterSpacing: -0.8,
              fontFamily:    'Inter',
            ),
          ),

          const SizedBox(height: 12),

          const Text(
            'Amina is personalised and ready.\nYour health journey starts now. 🌿',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize:   17,
              color:      _kMuted,
              fontFamily: 'Inter',
              height:     1.55,
            ),
          ),

          const SizedBox(height: 30),

          // Summary card
          Container(
            width:   double.infinity,
            padding: const EdgeInsets.all(22),
            decoration: BoxDecoration(
              color:        _kCard,
              borderRadius: BorderRadius.circular(24),
              border:       Border.all(color: _kSage.withValues(alpha: 0.30)),
              boxShadow: [
                BoxShadow(
                  color:      _kSageGlow,
                  blurRadius: 28,
                  offset:     const Offset(0, 6),
                ),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Your Amina profile',
                  style: TextStyle(
                    fontSize:   13,
                    fontWeight: FontWeight.w700,
                    color:      _kSage,
                    fontFamily: 'Inter',
                    letterSpacing: 0.4,
                  ),
                ),
                const SizedBox(height: 14),

                // Goals chosen
                if (state.selectedGoals.isNotEmpty) ...[
                  _SummaryRow(
                    icon:  Icons.check_circle_rounded,
                    label: 'Goals: ${state.selectedGoals.map(_goalLabel).join(', ')}',
                  ),
                  const SizedBox(height: 10),
                ],

                // Literacy level
                if (state.literacyLevel != null)
                  _SummaryRow(
                    icon:  Icons.tune_rounded,
                    label: state.literacyLevel == LiteracyLevel.simple
                        ? 'Language: Simple & clear'
                        : 'Language: Detailed & clinical',
                  ),
              ],
            ),
          ),

          const SizedBox(height: 36),

          _GlowButton(
            label:     'Let\'s Begin  →',
            onPressed: onFinish,
            large:     true,
          ),

          const SizedBox(height: 20),
          const Text(
            '🔒  Your data stays private on your device',
            style: TextStyle(
              fontSize:   13,
              color:      _kMuted,
              fontFamily: 'Inter',
            ),
          ),
        ],
      ),
    );
  }

  static String _goalLabel(String id) => switch (id) {
        'medications' => 'Medications',
        'symptoms'    => 'Symptoms',
        'chat'        => 'Chat',
        'family'      => 'Family',
        _             => id,
      };
}

class _SummaryRow extends StatelessWidget {
  final IconData icon;
  final String   label;
  const _SummaryRow({required this.icon, required this.label});

  @override
  Widget build(BuildContext context) => Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: _kSage, size: 18),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              label,
              style: const TextStyle(
                fontSize:   15,
                color:      _kOnSurface,
                fontFamily: 'Inter',
                height:     1.4,
              ),
            ),
          ),
        ],
      );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Shared widgets
// ═══════════════════════════════════════════════════════════════════════════════

// ── Pulsing AI glow avatar ────────────────────────────────────────────────────

class _PulsingGlowAvatar extends StatefulWidget {
  const _PulsingGlowAvatar();

  @override
  State<_PulsingGlowAvatar> createState() => _PulsingGlowAvatarState();
}

class _PulsingGlowAvatarState extends State<_PulsingGlowAvatar>
    with SingleTickerProviderStateMixin {
  late final AnimationController _ctrl;
  late final Animation<double>   _scale;
  late final Animation<double>   _opacity;

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(
      vsync:    this,
      duration: const Duration(milliseconds: 2000),
    )..repeat(reverse: true);

    _scale = Tween<double>(begin: 0.92, end: 1.08).animate(
      CurvedAnimation(parent: _ctrl, curve: Curves.easeInOut),
    );
    _opacity = Tween<double>(begin: 0.35, end: 0.75).animate(
      CurvedAnimation(parent: _ctrl, curve: Curves.easeInOut),
    );
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => SizedBox(
        width:  140,
        height: 140,
        child: Stack(
          alignment: Alignment.center,
          children: [
            // Outer pulsing ring
            AnimatedBuilder(
              animation: _ctrl,
              builder: (_, child) => Transform.scale(
                scale: _scale.value,
                child: Opacity(
                  opacity: _opacity.value,
                  child: Container(
                    width:  130,
                    height: 130,
                    decoration: BoxDecoration(
                      shape:       BoxShape.circle,
                      border: Border.all(
                        color: _kSage.withValues(alpha: 0.45),
                        width: 2,
                      ),
                      boxShadow: [
                        BoxShadow(
                          color:        _kSage.withValues(alpha: 0.30),
                          blurRadius:   30,
                          spreadRadius: 6,
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),

            // Inner pulsing ring
            AnimatedBuilder(
              animation: _ctrl,
              builder: (_, child) => Transform.scale(
                scale: 1.0 + (_scale.value - 0.92) * 0.5,
                child: Container(
                  width:  104,
                  height: 104,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: _kSage.withValues(alpha: 0.08),
                    border: Border.all(
                      color: _kSage.withValues(alpha: 0.20),
                      width: 1.5,
                    ),
                  ),
                ),
              ),
            ),

            // Avatar
            Container(
              width:  80,
              height: 80,
              decoration: const BoxDecoration(
                shape: BoxShape.circle,
                gradient: RadialGradient(
                  colors: [Color(0xFF4DB885), Color(0xFF2D7354)],
                  center: Alignment(-0.3, -0.3),
                ),
                boxShadow: [
                  BoxShadow(
                    color:      Color(0x553D9970),
                    blurRadius: 24,
                    offset:     Offset(0, 6),
                  ),
                ],
              ),
              child: const Center(
                child: Text('🌿', style: TextStyle(fontSize: 36)),
              ),
            ),
          ],
        ),
      );
}

// ── Mini highlight pill (Welcome page) ───────────────────────────────────────

class _MiniHighlight extends StatelessWidget {
  final String icon;
  final String label;
  const _MiniHighlight({required this.icon, required this.label});

  @override
  Widget build(BuildContext context) => Column(
        children: [
          Container(
            width:  52,
            height: 52,
            decoration: BoxDecoration(
              color:        _kCard,
              borderRadius: BorderRadius.circular(16),
              border:       Border.all(color: _kCardBorder),
            ),
            child: Center(
              child: Text(icon, style: const TextStyle(fontSize: 24)),
            ),
          ),
          const SizedBox(height: 6),
          Text(
            label,
            style: const TextStyle(
              fontSize:   12,
              color:      _kMuted,
              fontFamily: 'Inter',
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      );
}

// ── Glow CTA button ───────────────────────────────────────────────────────────

class _GlowButton extends StatelessWidget {
  final String       label;
  final VoidCallback? onPressed;
  final bool         large;

  const _GlowButton({
    required this.label,
    this.onPressed,
    this.large = false,
  });

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null;
    return SizedBox(
      width:  double.infinity,
      height: large ? 62 : 56,
      child: AnimatedOpacity(
        duration: const Duration(milliseconds: 200),
        opacity:  enabled ? 1.0 : 0.45,
        child: DecoratedBox(
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              colors: [Color(0xFF3D9970), Color(0xFF2D7354)],
              begin:  Alignment.topLeft,
              end:    Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.circular(18),
            boxShadow: enabled
                ? [
                    BoxShadow(
                      color:      _kSage.withValues(alpha: 0.40),
                      blurRadius: 24,
                      offset:     const Offset(0, 8),
                    ),
                  ]
                : null,
          ),
          child: TextButton(
            onPressed: onPressed,
            style: TextButton.styleFrom(
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(18),
              ),
            ),
            child: Text(
              label,
              style: TextStyle(
                fontSize:      large ? 17 : 16,
                fontWeight:    FontWeight.w700,
                fontFamily:    'Inter',
                letterSpacing: 0.1,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

