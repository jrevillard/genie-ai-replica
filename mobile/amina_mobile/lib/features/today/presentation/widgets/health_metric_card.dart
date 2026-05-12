import 'package:flutter/material.dart';

// ─── Public gradient constants ────────────────────────────────────────────────
//
// Exported so both DailyHealthCarousel (TodayHub) and the Health Snapshot
// section (MeScreen) can reference the same palette without duplication.

const kHealthGradBlue = LinearGradient(
  begin: Alignment.topLeft,
  end:   Alignment.bottomRight,
  colors: [Color(0xFF60A5FA), Color(0xFF2563EB)],
);

const kHealthGradRose = LinearGradient(
  begin: Alignment.topLeft,
  end:   Alignment.bottomRight,
  colors: [Color(0xFFF472B6), Color(0xFFDB2777)],
);

/// Used for both "alert" states (high glucose, elevated BP) and as the
/// standalone amber gradient — warm but not alarming.
const kHealthGradAmber = LinearGradient(
  begin: Alignment.topLeft,
  end:   Alignment.bottomRight,
  colors: [Color(0xFFFBBF24), Color(0xFFD97706)],
);

const kHealthGradViolet = LinearGradient(
  begin: Alignment.topLeft,
  end:   Alignment.bottomRight,
  colors: [Color(0xFFA78BFA), Color(0xFF6D28D9)],
);

const kHealthGradEmerald = LinearGradient(
  begin: Alignment.topLeft,
  end:   Alignment.bottomRight,
  colors: [Color(0xFF34D399), Color(0xFF059669)],
);

// ─── Mood emoji lookup ────────────────────────────────────────────────────────

const kHealthMoodEmojis = {
  'Great':  '😊',
  'Good':   '🙂',
  'Okay':   '😐',
  'Low':    '😔',
  'Unwell': '😣',
};

// ─── Shared border radius ─────────────────────────────────────────────────────

const _kRadius = 22.0;

// ─── HealthMetricCard ─────────────────────────────────────────────────────────

/// Gradient card for a single health metric (e.g. Blood Glucose, Blood Pressure).
///
/// **Sizing is the parent's responsibility** — the card fills whatever
/// constraint it receives, making it usable in both a fixed-width horizontal
/// carousel and a flexible 2-column grid without any parameter changes.
///
/// Supply [isAlert] = true to swap the visual emphasis (alert badge appears
/// in the top-right corner).  The caller is responsible for choosing the
/// correct [gradient] (e.g. [kHealthGradAmber] when the reading is abnormal).
///
/// Set [compact] = true (MeScreen grid) to use smaller font sizes and tighter
/// vertical gaps so the content fits inside a shorter card without overflow.
/// The carousel leaves this at the default `false`.
class HealthMetricCard extends StatelessWidget {
  final IconData       icon;
  final String         label;
  final String         value;
  final String         statusText;
  final LinearGradient gradient;
  final bool           isAlert;
  final bool           compact;
  final VoidCallback   onTap;

  const HealthMetricCard({
    super.key,
    required this.icon,
    required this.label,
    required this.value,
    required this.statusText,
    required this.gradient,
    required this.onTap,
    this.isAlert = false,
    this.compact = false,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          gradient:     gradient,
          borderRadius: BorderRadius.circular(_kRadius),
          boxShadow: [
            BoxShadow(
              color:      gradient.colors.last.withValues(alpha: 0.30),
              blurRadius: 14,
              offset:     const Offset(0, 5),
            ),
          ],
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(_kRadius),
          child: Stack(
            children: [
              // ── Decorative bubble — bottom-right ─────────────────────────
              Positioned(
                bottom: -22,
                right:  -22,
                child: Container(
                  width:  80,
                  height: 80,
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.10),
                    shape: BoxShape.circle,
                  ),
                ),
              ),

              // ── Content ──────────────────────────────────────────────────
              Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Icon circle + optional alert badge
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          width:  42,
                          height: 42,
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.22),
                            shape: BoxShape.circle,
                          ),
                          child: Icon(icon, color: Colors.white, size: 21),
                        ),
                        if (isAlert) ...[
                          const Spacer(),
                          Container(
                            margin:  const EdgeInsets.only(top: 3),
                            padding: const EdgeInsets.symmetric(
                                horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(
                              color: Colors.white.withValues(alpha: 0.28),
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: const Text(
                              '!',
                              style: TextStyle(
                                color:      Colors.white,
                                fontSize:   12,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),

                    const Spacer(),

                    // Metric label (small, upper context line)
                    Text(
                      label,
                      style: TextStyle(
                        fontSize:      compact ? 9.5 : 11,
                        color:         Colors.white.withValues(alpha: 0.82),
                        letterSpacing: 0.2,
                      ),
                    ),
                    SizedBox(height: compact ? 2 : 3),
                    // Primary value (large, bold)
                    Text(
                      value,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize:      compact ? 14 : 17,
                        fontWeight:    FontWeight.w700,
                        color:         Colors.white,
                        letterSpacing: -0.3,
                      ),
                    ),
                    SizedBox(height: compact ? 2 : 3),
                    // Status line (e.g. "Within range", "Elevated — rest")
                    Text(
                      statusText,
                      style: TextStyle(
                        fontSize: compact ? 9.5 : 11.5,
                        color:    Colors.white.withValues(alpha: 0.78),
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

// ─── MoodMetricCard ───────────────────────────────────────────────────────────

/// Gradient card that displays the user's last logged mood.
///
/// Shows a neutral "😶 Not logged" state when no mood has been recorded.
/// Tapping always opens the health log sheet to update the entry.
class MoodMetricCard extends StatelessWidget {
  final String       mood;
  final VoidCallback onTap;
  final bool         compact;

  const MoodMetricCard({
    super.key,
    required this.mood,
    required this.onTap,
    this.compact = false,
  });

  @override
  Widget build(BuildContext context) {
    final hasLog = mood.isNotEmpty;
    final emoji  = kHealthMoodEmojis[mood] ?? '😶';

    return GestureDetector(
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          gradient:     kHealthGradViolet,
          borderRadius: BorderRadius.circular(_kRadius),
          boxShadow: [
            BoxShadow(
              color:      const Color(0xFF6D28D9).withValues(alpha: 0.28),
              blurRadius: 14,
              offset:     const Offset(0, 5),
            ),
          ],
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(_kRadius),
          child: Stack(
            children: [
              Positioned(
                bottom: -22,
                right:  -22,
                child: Container(
                  width:  80,
                  height: 80,
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.10),
                    shape: BoxShape.circle,
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Emoji in frosted circle
                    Container(
                      width:  42,
                      height: 42,
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.22),
                        shape: BoxShape.circle,
                      ),
                      child: Center(
                        child: Text(
                          emoji,
                          style: const TextStyle(fontSize: 20),
                        ),
                      ),
                    ),

                    const Spacer(),

                    Text(
                      'Mood',
                      style: TextStyle(
                        fontSize:      compact ? 9.5 : 11,
                        color:         Colors.white.withValues(alpha: 0.82),
                        letterSpacing: 0.2,
                      ),
                    ),
                    SizedBox(height: compact ? 2 : 3),
                    Text(
                      hasLog ? mood : 'Not logged',
                      style: TextStyle(
                        fontSize:      compact ? 14 : 17,
                        fontWeight:    FontWeight.w700,
                        color:         Colors.white,
                        letterSpacing: -0.3,
                      ),
                    ),
                    SizedBox(height: compact ? 2 : 3),
                    Text(
                      hasLog ? 'Tap to update' : 'How do you feel?',
                      style: TextStyle(
                        fontSize: compact ? 9.5 : 11.5,
                        color:    Colors.white.withValues(alpha: 0.78),
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

// ─── SymptomsMetricCard ───────────────────────────────────────────────────────

/// Gradient card that displays the count of logged symptoms.
///
/// When symptoms are present, the first symptom is shown as a one-line
/// teaser below the count.  Tapping opens the health log sheet.
class SymptomsMetricCard extends StatelessWidget {
  final List<String> symptoms;
  final VoidCallback onTap;
  final bool         compact;

  const SymptomsMetricCard({
    super.key,
    required this.symptoms,
    required this.onTap,
    this.compact = false,
  });

  @override
  Widget build(BuildContext context) {
    final count  = symptoms.length;
    final hasLog = count > 0;

    return GestureDetector(
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          gradient:     kHealthGradEmerald,
          borderRadius: BorderRadius.circular(_kRadius),
          boxShadow: [
            BoxShadow(
              color:      const Color(0xFF059669).withValues(alpha: 0.28),
              blurRadius: 14,
              offset:     const Offset(0, 5),
            ),
          ],
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(_kRadius),
          child: Stack(
            children: [
              Positioned(
                bottom: -22,
                right:  -22,
                child: Container(
                  width:  80,
                  height: 80,
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.10),
                    shape: BoxShape.circle,
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width:  42,
                      height: 42,
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.22),
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(
                        Icons.health_and_safety_outlined,
                        color: Colors.white,
                        size:  21,
                      ),
                    ),

                    const Spacer(),

                    Text(
                      'Symptoms',
                      style: TextStyle(
                        fontSize:      compact ? 9.5 : 11,
                        color:         Colors.white.withValues(alpha: 0.82),
                        letterSpacing: 0.2,
                      ),
                    ),
                    SizedBox(height: compact ? 2 : 3),
                    Text(
                      hasLog ? '$count logged' : 'None logged',
                      style: TextStyle(
                        fontSize:      compact ? 14 : 17,
                        fontWeight:    FontWeight.w700,
                        color:         Colors.white,
                        letterSpacing: -0.3,
                      ),
                    ),
                    SizedBox(height: compact ? 2 : 3),
                    Text(
                      hasLog ? symptoms.first : 'Feeling well?',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: compact ? 9.5 : 11.5,
                        color:    Colors.white.withValues(alpha: 0.78),
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
