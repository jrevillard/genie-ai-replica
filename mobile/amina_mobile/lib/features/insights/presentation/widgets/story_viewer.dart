import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../data/models/health_story.dart';
import '../providers/stories_provider.dart';

// ─── Constants ────────────────────────────────────────────────────────────────

/// How long each slide is shown before auto-advancing.
/// Poll slides pause the timer until the user votes.
const _kSlideDuration = Duration(seconds: 6);

// ─── StoryViewerScreen ────────────────────────────────────────────────────────

/// Full-screen, Instagram-style story viewer.
///
/// **Navigation:**
///   • Tap the left 33 % → previous slide / story.
///   • Tap the right 67 % → next slide / story.
///   • Long-press anywhere → pause auto-advance.
///   • The ✕ button in the top-right → close (marks story as seen).
///
/// **Poll slides** pause the progress bar.  After the user votes, the slide
/// auto-advances after a 1.4 s grace period so they can see their answer.
///
/// **Accessibility:** All tap targets ≥ 40 × 40 px.  Body text is 16.5 sp
/// and titles are 26 sp, meeting WCAG AA contrast on the gradient backgrounds.
class StoryViewerScreen extends ConsumerStatefulWidget {
  final List<HealthStory> stories;
  final int               initialIndex;

  const StoryViewerScreen({
    super.key,
    required this.stories,
    required this.initialIndex,
  });

  @override
  ConsumerState<StoryViewerScreen> createState() => _StoryViewerState();
}

class _StoryViewerState extends ConsumerState<StoryViewerScreen>
    with SingleTickerProviderStateMixin {

  // ── State ──────────────────────────────────────────────────────────────────

  late int _storyIdx;
  int      _slideIdx = 0;
  late AnimationController _progressCtrl;

  /// Poll answers keyed by "$storyIdx:$slideIdx".
  final Map<String, String> _pollAnswers = {};

  // ── Convenience getters ────────────────────────────────────────────────────

  HealthStory get _story      => widget.stories[_storyIdx];
  StorySlide  get _slide      => _story.slides[_slideIdx];
  int         get _slideCount => _story.slides.length;

  bool get _isPollSlide =>
      _slide.interaction == StoryInteraction.poll && _slide.poll != null;

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  @override
  void initState() {
    super.initState();
    _storyIdx     = widget.initialIndex;
    _progressCtrl = AnimationController(
      vsync:    this,
      duration: _kSlideDuration,
    )..addStatusListener(_onProgressEnd);
    _beginSlide();
  }

  @override
  void dispose() {
    _progressCtrl.dispose();
    super.dispose();
  }

  // ── Slide control ──────────────────────────────────────────────────────────

  void _beginSlide() {
    _progressCtrl.duration = _kSlideDuration;
    if (_isPollSlide) {
      // Pause on poll slides until the user votes.
      _progressCtrl.value = 0;
    } else {
      _progressCtrl.forward(from: 0);
    }
  }

  void _onProgressEnd(AnimationStatus status) {
    if (status == AnimationStatus.completed) _advance();
  }

  /// Move to the next slide, then the next story, then close.
  void _advance() {
    if (!mounted) return;
    if (_slideIdx < _slideCount - 1) {
      setState(() => _slideIdx++);
      _beginSlide();
    } else {
      _markSeenAndContinue();
    }
  }

  /// Move to the previous slide or previous story.
  void _goBack() {
    if (!mounted) return;
    if (_slideIdx > 0) {
      setState(() => _slideIdx--);
      _beginSlide();
    } else if (_storyIdx > 0) {
      setState(() {
        _storyIdx--;
        _slideIdx = widget.stories[_storyIdx].slides.length - 1;
      });
      _beginSlide();
    }
  }

  void _markSeenAndContinue() {
    ref.read(seenStoriesProvider.notifier).markSeen(_story.id);
    if (_storyIdx < widget.stories.length - 1) {
      setState(() {
        _storyIdx++;
        _slideIdx = 0;
      });
      _beginSlide();
    } else {
      Navigator.of(context).pop();
    }
  }

  // ── Pause / resume ─────────────────────────────────────────────────────────

  void _pause()  => _progressCtrl.stop();
  void _resume() { if (!_isPollSlide) _progressCtrl.forward(); }

  // ── Poll interaction ───────────────────────────────────────────────────────

  void _onPollAnswer(String option) {
    final key = '$_storyIdx:$_slideIdx';
    if (_pollAnswers.containsKey(key)) return; // already answered
    setState(() => _pollAnswers[key] = option);
    // Fill the progress bar then advance after a brief grace period.
    _progressCtrl.forward(from: 0);
    Future.delayed(const Duration(milliseconds: 1400), () {
      if (mounted) _advance();
    });
  }

  // ── Close ──────────────────────────────────────────────────────────────────

  void _close() {
    ref.read(seenStoriesProvider.notifier).markSeen(_story.id);
    Navigator.of(context).pop();
  }

  // ── Build ──────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final screenWidth = MediaQuery.of(context).size.width;
    final pollKey     = '$_storyIdx:$_slideIdx';
    final pollAnswer  = _pollAnswers[pollKey];

    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        fit: StackFit.expand,
        children: [

          // ── 1. Animated gradient background ────────────────────────────
          AnimatedSwitcher(
            duration: const Duration(milliseconds: 420),
            child: SizedBox.expand(
              key: ValueKey('bg-$_storyIdx-$_slideIdx'),
              child: DecoratedBox(
                decoration: BoxDecoration(gradient: _slide.gradient),
              ),
            ),
          ),

          // ── 2. Full-screen tap zones (behind UI layer) ─────────────────
          //
          // HitTestBehavior.opaque: always enters the gesture arena.
          // The poll / CTA widgets on top win when the user taps them;
          // blank-area taps fall through and land here.
          GestureDetector(
            behavior:         HitTestBehavior.opaque,
            onLongPressStart: (_) => _pause(),
            onLongPressEnd:   (_) => _resume(),
            onTapUp: (d) {
              if (d.localPosition.dx < screenWidth * 0.33) {
                _goBack();
              } else {
                _advance();
              }
            },
            child: const SizedBox.expand(),
          ),

          // ── 3. Foreground UI ──────────────────────────────────────────
          SafeArea(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // Segmented progress bar
                _ProgressBarRow(
                  slideCount:  _slideCount,
                  currentIdx:  _slideIdx,
                  controller:  _progressCtrl,
                ),
                const SizedBox(height: 12),

                // Publisher header + ✕ close button
                _PublisherHeader(
                  story:   _story,
                  onClose: _close,
                ),
                const SizedBox(height: 4),

                // Main content: emoji, title, body
                Expanded(
                  child: _SlideContent(slide: _slide),
                ),

                // Interactive element — absorbs its own taps
                _InteractiveArea(
                  slide:       _slide,
                  pollAnswer:  pollAnswer,
                  accentColor: _story.accentColor,
                  onAnswer:    _onPollAnswer,
                ),

                // Bottom hint
                Padding(
                  padding: const EdgeInsets.only(bottom: 18, top: 6),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(
                        Icons.touch_app_rounded,
                        color: Colors.white.withValues(alpha: 0.35),
                        size:  13,
                      ),
                      const SizedBox(width: 5),
                      Text(
                        'Tap to advance  ·  Hold to pause',
                        style: TextStyle(
                          fontSize: 11,
                          color:    Colors.white.withValues(alpha: 0.35),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Progress bar row ─────────────────────────────────────────────────────────

class _ProgressBarRow extends StatelessWidget {
  final int                slideCount;
  final int                currentIdx;
  final AnimationController controller;

  const _ProgressBarRow({
    required this.slideCount,
    required this.currentIdx,
    required this.controller,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
      child: Row(
        children: List.generate(slideCount, (i) {
          return Expanded(
            child: Padding(
              padding: EdgeInsets.only(right: i < slideCount - 1 ? 5 : 0),
              child: _ProgressSegment(
                isCurrent:   i == currentIdx,
                isCompleted: i < currentIdx,
                controller:  controller,
              ),
            ),
          );
        }),
      ),
    );
  }
}

// ─── Progress segment ─────────────────────────────────────────────────────────

class _ProgressSegment extends StatelessWidget {
  final bool                isCurrent;
  final bool                isCompleted;
  final AnimationController controller;

  const _ProgressSegment({
    required this.isCurrent,
    required this.isCompleted,
    required this.controller,
  });

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(2),
      child: SizedBox(
        height: 3,
        child: Stack(
          children: [
            // Track (faint white)
            Container(color: Colors.white.withValues(alpha: 0.28)),
            // Fill
            if (isCompleted)
              Container(color: Colors.white)
            else if (isCurrent)
              AnimatedBuilder(
                animation: controller,
                builder: (_, _) => FractionallySizedBox(
                  widthFactor: controller.value,
                  alignment:   Alignment.centerLeft,
                  child:       Container(color: Colors.white),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

// ─── Publisher header ─────────────────────────────────────────────────────────

class _PublisherHeader extends StatelessWidget {
  final HealthStory  story;
  final VoidCallback onClose;

  const _PublisherHeader({required this.story, required this.onClose});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Row(
        children: [
          // Avatar circle
          Container(
            width:  42,
            height: 42,
            decoration: BoxDecoration(
              color:  Colors.white.withValues(alpha: 0.18),
              shape:  BoxShape.circle,
              border: Border.all(
                color: Colors.white.withValues(alpha: 0.40),
                width: 1.5,
              ),
            ),
            child: Center(
              child: Text(
                story.thumbnailEmoji,
                style: const TextStyle(fontSize: 20),
              ),
            ),
          ),
          const SizedBox(width: 10),

          // Publisher name + tag
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  story.publisher,
                  style: const TextStyle(
                    fontSize:   14,
                    fontWeight: FontWeight.w700,
                    color:      Colors.white,
                    letterSpacing: -0.2,
                  ),
                ),
                const SizedBox(height: 1),
                Text(
                  story.publisherTag,
                  style: TextStyle(
                    fontSize: 11.5,
                    color:    Colors.white.withValues(alpha: 0.68),
                  ),
                ),
              ],
            ),
          ),

          // Close button — large target for elderly users
          GestureDetector(
            onTap: onClose,
            child: Container(
              width:  44,
              height: 44,
              decoration: BoxDecoration(
                color:  Colors.white.withValues(alpha: 0.18),
                shape:  BoxShape.circle,
                border: Border.all(
                  color: Colors.white.withValues(alpha: 0.30),
                  width: 1.5,
                ),
              ),
              child: const Icon(
                Icons.close_rounded,
                color: Colors.white,
                size:  22,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Slide content ────────────────────────────────────────────────────────────

class _SlideContent extends StatelessWidget {
  final StorySlide slide;
  const _SlideContent({required this.slide});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(builder: (_, constraints) {
      // Poll/CTA slides leave less height for the content area. The threshold
      // must be above the largest measured CTA Expanded height (358 px on the
      // test device) and below plain-slide Expanded height (~405 px), so 380
      // is the sweet spot: compact for poll/CTA, full-size for plain slides.
      final compact = constraints.maxHeight < 380;
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: 28),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(
              slide.iconEmoji,
              style: TextStyle(fontSize: compact ? 60.0 : 80.0),
            ),
            SizedBox(height: compact ? 14.0 : 28.0),

            Text(
              slide.title,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize:      26,
                fontWeight:    FontWeight.w800,
                color:         Colors.white,
                letterSpacing: -0.5,
                height:        1.25,
              ),
            ),
            SizedBox(height: compact ? 10.0 : 16.0),

            Text(
              slide.body,
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize:      16.5,
                color:         Colors.white.withValues(alpha: 0.88),
                height:        1.62,
                letterSpacing: 0.1,
              ),
            ),
          ],
        ),
      );
    });
  }
}

// ─── Interactive area dispatcher ──────────────────────────────────────────────

class _InteractiveArea extends StatelessWidget {
  final StorySlide            slide;
  final String?               pollAnswer;
  final Color                 accentColor;
  final void Function(String) onAnswer;

  const _InteractiveArea({
    required this.slide,
    required this.pollAnswer,
    required this.accentColor,
    required this.onAnswer,
  });

  @override
  Widget build(BuildContext context) {
    if (slide.interaction == StoryInteraction.poll && slide.poll != null) {
      return _PollWidget(
        poll:           slide.poll!,
        selectedOption: pollAnswer,
        accentColor:    accentColor,
        onAnswer:       onAnswer,
      );
    }
    if (slide.interaction == StoryInteraction.cta && slide.cta != null) {
      return _CtaWidget(
        cta:         slide.cta!,
        accentColor: accentColor,
      );
    }
    return const SizedBox(height: 40);
  }
}

// ─── Poll widget ──────────────────────────────────────────────────────────────

/// Two-option poll card.
///
/// Wraps itself in a [GestureDetector] with an empty `onTap` so that taps
/// on the poll area are absorbed and do NOT trigger story navigation.
class _PollWidget extends StatelessWidget {
  final PollData              poll;
  final String?               selectedOption;
  final Color                 accentColor;
  final void Function(String) onAnswer;

  const _PollWidget({
    required this.poll,
    this.selectedOption,
    required this.accentColor,
    required this.onAnswer,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      // Absorb taps so they don't fall through to the navigation layer.
      onTap: () {},
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Question pill
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 13),
              decoration: BoxDecoration(
                color:        Colors.white.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(16),
                border:       Border.all(
                  color: Colors.white.withValues(alpha: 0.22),
                ),
              ),
              child: Text(
                poll.question,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize:   15.5,
                  fontWeight: FontWeight.w600,
                  color:      Colors.white,
                  height:     1.35,
                ),
              ),
            ),
            const SizedBox(height: 10),

            // Answer buttons
            Row(
              children: poll.options.asMap().entries.map((entry) {
                final i        = entry.key;
                final option   = entry.value;
                final isChosen = selectedOption == option;
                final answered = selectedOption != null;

                return Expanded(
                  child: Padding(
                    padding: EdgeInsets.only(
                      right: i < poll.options.length - 1 ? 10 : 0,
                    ),
                    child: GestureDetector(
                      onTap: answered ? null : () => onAnswer(option),
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 260),
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        decoration: BoxDecoration(
                          color: isChosen
                              ? Colors.white
                              : Colors.white.withValues(alpha: 0.15),
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(
                            color: isChosen
                                ? Colors.transparent
                                : Colors.white.withValues(alpha: 0.28),
                            width: 1.5,
                          ),
                          boxShadow: isChosen
                              ? [
                                  BoxShadow(
                                    color:      Colors.black.withValues(alpha: 0.18),
                                    blurRadius: 14,
                                    offset:     const Offset(0, 5),
                                  ),
                                ]
                              : null,
                        ),
                        child: Text(
                          option,
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize:   14,
                            fontWeight: FontWeight.w700,
                            color:      isChosen ? accentColor : Colors.white,
                          ),
                        ),
                      ),
                    ),
                  ),
                );
              }).toList(),
            ),
          ],
        ),
      ),
    );
  }
}

// ─── CTA widget ───────────────────────────────────────────────────────────────

/// Full-width call-to-action card.
///
/// Absorbs its own taps to prevent triggering story navigation.
class _CtaWidget extends StatelessWidget {
  final CtaData cta;
  final Color   accentColor;

  const _CtaWidget({required this.cta, required this.accentColor});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () {}, // absorb — real navigation wired in a future release
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 18, horizontal: 20),
          decoration: BoxDecoration(
            color:        Colors.white,
            borderRadius: BorderRadius.circular(20),
            boxShadow: [
              BoxShadow(
                color:      Colors.black.withValues(alpha: 0.22),
                blurRadius: 24,
                offset:     const Offset(0, 8),
              ),
            ],
          ),
          child: Column(
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    Icons.open_in_new_rounded,
                    color: accentColor,
                    size:  17,
                  ),
                  const SizedBox(width: 7),
                  Flexible(
                    child: Text(
                      cta.label,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize:      16,
                        fontWeight:    FontWeight.w800,
                        color:         accentColor,
                        letterSpacing: -0.2,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                cta.subtitle,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 12,
                  color:    Color(0xFF6B7280),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
