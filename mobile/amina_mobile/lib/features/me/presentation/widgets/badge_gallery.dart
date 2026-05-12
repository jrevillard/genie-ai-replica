import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../data/models/gamification_model.dart';
import '../providers/gamification_provider.dart';
import '../../../../core/theme/app_theme.dart';

// ─── Confetti palette ─────────────────────────────────────────────────────────

const _kConfettiColors = [
  Color(0xFF3D9970), Color(0xFFFBBF24), Color(0xFFF472B6),
  Color(0xFF60A5FA), Color(0xFFA78BFA), Color(0xFFFB923C),
];

// ─── BadgeGallery ─────────────────────────────────────────────────────────────

/// Displays all earned and locked badges in a 3-column grid.
///
/// Earned badges show full color.  The most recently earned badge (≤ 48 h)
/// receives a gentle pulsing glow.  Locked badges are greyed out with a
/// lock overlay.
///
/// Tapping an **earned** badge opens [_BadgeDetailDialog] — a celebratory
/// full-screen pop-up with a spring-scale animation and confetti.
/// Tapping a **locked** badge shows [_LockedBadgeSheet] explaining how to
/// unlock it, so the interaction always feels instructive, not punishing.
class BadgeGallery extends ConsumerWidget {
  const BadgeGallery({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cs          = Theme.of(context).colorScheme;
    final stats       = ref.watch(gamificationProvider);
    final earnedCount = stats.earnedBadges.length;
    final totalCount  = stats.badges.length;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // ── Header row ─────────────────────────────────────────────────
        Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(
              'My Badges',
              style: TextStyle(
                fontSize:   18,
                fontWeight: FontWeight.bold,
                color:      cs.onSurface,
              ),
            ),
            const SizedBox(width: 10),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 2),
              decoration: BoxDecoration(
                color:        cs.primaryContainer,
                borderRadius: BorderRadius.circular(20),
              ),
              child: Text(
                '$earnedCount / $totalCount',
                style: TextStyle(
                  fontSize:   12,
                  fontWeight: FontWeight.w700,
                  color:      cs.primary,
                ),
              ),
            ),
          ],
        ),

        const SizedBox(height: 4),
        Text(
          earnedCount == totalCount
              ? 'You\'ve collected every badge — legendary! 🏆'
              : 'Tap a locked badge to see how to earn it.',
          style: TextStyle(
            fontSize: 13,
            color:    cs.onSurfaceVariant.withValues(alpha: 0.85),
          ),
        ),

        const SizedBox(height: 14),

        // ── Badge grid ─────────────────────────────────────────────────
        GridView.count(
          shrinkWrap:       true,
          physics:          const NeverScrollableScrollPhysics(),
          crossAxisCount:   3,
          crossAxisSpacing: 12,
          mainAxisSpacing:  12,
          childAspectRatio: 0.82,
          children: [
            ...stats.earnedBadges.map((b) => _BadgeCard(
              badge:    b,
              isEarned: true,
              isRecent: b.id == stats.recentlyEarnedBadgeId,
              onTap:    () => _showBadgeDetail(context, b),
            )),
            ...stats.lockedBadges.map((b) => _BadgeCard(
              badge:    b,
              isEarned: false,
              isRecent: false,
              onTap:    () => _showLockedSheet(context, b),
            )),
          ],
        ),
      ],
    );
  }

  // ── Dialog / sheet launchers ────────────────────────────────────────────────

  void _showBadgeDetail(BuildContext context, AppBadge badge) {
    showGeneralDialog<void>(
      context:            context,
      barrierColor:       Colors.black.withValues(alpha: 0.75),
      barrierDismissible: true,
      barrierLabel:       'Close',
      pageBuilder: (ctx, _, __) => _BadgeDetailDialog(badge: badge),
      transitionBuilder: (ctx, anim, _, child) => FadeTransition(
        opacity: anim,
        child:   child,
      ),
      transitionDuration: const Duration(milliseconds: 220),
    );
  }

  void _showLockedSheet(BuildContext context, AppBadge badge) {
    showModalBottomSheet<void>(
      context:            context,
      backgroundColor:    Colors.transparent,
      isScrollControlled: true,
      builder: (_) => _LockedBadgeSheet(badge: badge),
    );
  }
}

// ─── Badge card ───────────────────────────────────────────────────────────────

class _BadgeCard extends StatefulWidget {
  final AppBadge     badge;
  final bool         isEarned;
  final bool         isRecent;
  final VoidCallback onTap;

  const _BadgeCard({
    required this.badge,
    required this.isEarned,
    required this.isRecent,
    required this.onTap,
  });

  @override
  State<_BadgeCard> createState() => _BadgeCardState();
}

class _BadgeCardState extends State<_BadgeCard>
    with SingleTickerProviderStateMixin {

  late final AnimationController _glowCtrl;

  @override
  void initState() {
    super.initState();
    _glowCtrl = AnimationController(
      vsync:    this,
      duration: const Duration(milliseconds: 1600),
    );
    if (widget.isRecent) {
      _glowCtrl.repeat(reverse: true);
    }
  }

  @override
  void dispose() {
    _glowCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    final b        = widget.badge;
    final isEarned = widget.isEarned;

    return GestureDetector(
      onTap: widget.onTap,
      child: AnimatedBuilder(
        animation: _glowCtrl,
        builder: (_, child) {
          final glowAlpha  =
              widget.isRecent ? (0.18 + _glowCtrl.value * 0.32) : 0.0;
          final glowSpread =
              widget.isRecent ? _glowCtrl.value * 6.0 : 0.0;
          final glowBlur   =
              widget.isRecent ? (10 + _glowCtrl.value * 16.0) : 0.0;

          return Container(
            decoration: BoxDecoration(
              color:        cs.surface,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(
                color: isEarned
                    ? b.primaryColor.withValues(alpha: 0.20)
                    : amina.cardBorder,
              ),
              boxShadow: [
                if (isEarned && !widget.isRecent)
                  BoxShadow(
                    color:      b.primaryColor.withValues(alpha: 0.10),
                    blurRadius: 10,
                    offset:     const Offset(0, 3),
                  ),
                if (widget.isRecent)
                  BoxShadow(
                    color:        b.primaryColor.withValues(alpha: glowAlpha),
                    blurRadius:   glowBlur,
                    spreadRadius: glowSpread,
                  ),
              ],
            ),
            child: child,
          );
        },
        child: _buildCardContent(b, isEarned, cs, amina),
      ),
    );
  }

  Widget _buildCardContent(
      AppBadge b, bool isEarned, ColorScheme cs, AminaColors amina) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 10),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          // Badge icon circle
          Stack(
            alignment: Alignment.center,
            children: [
              Container(
                width:  58,
                height: 58,
                decoration: BoxDecoration(
                  color: isEarned ? b.bgColor : amina.inputFill,
                  shape: BoxShape.circle,
                ),
                child: Center(
                  child: Text(
                    b.emoji,
                    style: const TextStyle(fontSize: 26),
                  ),
                ),
              ),

              // Lock overlay for locked badges
              if (!isEarned)
                Positioned.fill(
                  child: Container(
                    decoration: BoxDecoration(
                      color: cs.surface.withValues(alpha: 0.60),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.lock_rounded,
                      size:  18,
                      color: Color(0xFF9CA3AF),
                    ),
                  ),
                ),

              // "New" star for recently earned
              if (widget.isRecent)
                Positioned(
                  top:   0,
                  right: 0,
                  child: Container(
                    width:  18,
                    height: 18,
                    decoration: BoxDecoration(
                      color: b.primaryColor,
                      shape: BoxShape.circle,
                      border: Border.all(color: Colors.white, width: 1.5),
                    ),
                    child: const Icon(
                      Icons.star_rounded,
                      size:  11,
                      color: Colors.white,
                    ),
                  ),
                ),
            ],
          ),

          const SizedBox(height: 8),

          // Badge name
          Text(
            b.name,
            textAlign: TextAlign.center,
            maxLines:  2,
            overflow:  TextOverflow.ellipsis,
            style: TextStyle(
              fontSize:   11.5,
              fontWeight: FontWeight.w700,
              color:      isEarned ? cs.onSurface : const Color(0xFF9CA3AF),
              height:     1.25,
            ),
          ),

          const SizedBox(height: 3),

          // Status label
          Text(
            isEarned ? 'Earned ✓' : 'Locked',
            style: TextStyle(
              fontSize:   10,
              fontWeight: FontWeight.w600,
              color:      isEarned
                  ? b.primaryColor
                  : const Color(0xFFD1D5DB),
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Badge detail dialog (earned badges) ──────────────────────────────────────

class _BadgeDetailDialog extends StatefulWidget {
  final AppBadge badge;
  const _BadgeDetailDialog({required this.badge});

  @override
  State<_BadgeDetailDialog> createState() => _BadgeDetailDialogState();
}

class _BadgeDetailDialogState extends State<_BadgeDetailDialog>
    with TickerProviderStateMixin {

  late final AnimationController _scaleCtrl;
  late final AnimationController _confettiCtrl;
  late final Animation<double>   _scaleAnim;
  late final List<_Particle>     _particles;

  @override
  void initState() {
    super.initState();
    _particles = _generateParticles(math.Random(widget.badge.id.hashCode));

    _scaleCtrl = AnimationController(
      vsync:    this,
      duration: const Duration(milliseconds: 550),
    );
    _scaleAnim = TweenSequence<double>([
      TweenSequenceItem(
          tween: Tween(begin: 0.0, end: 1.15), weight: 65),
      TweenSequenceItem(
          tween: Tween(begin: 1.15, end: 1.0), weight: 35),
    ]).animate(CurvedAnimation(
        parent: _scaleCtrl, curve: Curves.easeOut));

    _confettiCtrl = AnimationController(
      vsync:    this,
      duration: const Duration(milliseconds: 2200),
    );

    _scaleCtrl.forward();
    _confettiCtrl.forward();
  }

  @override
  void dispose() {
    _scaleCtrl.dispose();
    _confettiCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final b  = widget.badge;

    return Material(
      color: Colors.transparent,
      child: Stack(
        fit: StackFit.expand,
        children: [

          // ── Confetti layer ─────────────────────────────────────────────
          AnimatedBuilder(
            animation: _confettiCtrl,
            builder: (_, __) => CustomPaint(
              painter: _ConfettiPainter(
                progress:  _confettiCtrl.value,
                particles: _particles,
              ),
            ),
          ),

          // ── Badge card ─────────────────────────────────────────────────
          Center(
            child: ScaleTransition(
              scale: _scaleAnim,
              child: Container(
                margin:  const EdgeInsets.symmetric(horizontal: 28),
                padding: const EdgeInsets.all(28),
                decoration: BoxDecoration(
                  color:        cs.surface,
                  borderRadius: BorderRadius.circular(28),
                  boxShadow: [
                    BoxShadow(
                      color:      b.primaryColor.withValues(alpha: 0.22),
                      blurRadius: 40,
                      offset:     const Offset(0, 14),
                    ),
                  ],
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [

                    // Badge icon
                    Container(
                      width:  100,
                      height: 100,
                      decoration: BoxDecoration(
                        color: b.bgColor,
                        shape: BoxShape.circle,
                        boxShadow: [
                          BoxShadow(
                            color:        b.primaryColor.withValues(alpha: 0.28),
                            blurRadius:   22,
                            spreadRadius: 4,
                            offset:       const Offset(0, 4),
                          ),
                        ],
                      ),
                      child: Center(
                        child: Text(
                          b.emoji,
                          style: const TextStyle(fontSize: 46),
                        ),
                      ),
                    ),

                    const SizedBox(height: 8),

                    // "Achievement Unlocked" label
                    Text(
                      'Achievement Unlocked!',
                      style: TextStyle(
                        fontSize:      11.5,
                        fontWeight:    FontWeight.w700,
                        color:         b.primaryColor,
                        letterSpacing: 1.1,
                      ),
                    ),

                    const SizedBox(height: 10),

                    // Badge name
                    Text(
                      b.name,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize:      24,
                        fontWeight:    FontWeight.w800,
                        color:         cs.onSurface,
                        letterSpacing: -0.5,
                      ),
                    ),

                    const SizedBox(height: 10),

                    // Description
                    Text(
                      b.description,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 15,
                        color:    cs.onSurfaceVariant,
                        height:   1.45,
                      ),
                    ),

                    // Earned date
                    if (b.earnedAt != null) ...[
                      const SizedBox(height: 8),
                      Text(
                        'Earned ${_formatDate(b.earnedAt!)}',
                        style: TextStyle(
                          fontSize:   12.5,
                          fontWeight: FontWeight.w600,
                          color:      b.primaryColor.withValues(alpha: 0.80),
                        ),
                      ),
                    ],

                    const SizedBox(height: 24),

                    // Close button
                    SizedBox(
                      width: double.infinity,
                      child: ElevatedButton(
                        onPressed: () => Navigator.of(context).pop(),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: b.primaryColor,
                          foregroundColor: Colors.white,
                          elevation:       0,
                          padding: const EdgeInsets.symmetric(vertical: 16),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(16),
                          ),
                        ),
                        child: const Text(
                          'Awesome! 🎉',
                          style: TextStyle(
                            fontSize:   16,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
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

  static String _formatDate(DateTime dt) {
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    final diff = DateTime.now().difference(dt);
    if (diff.inHours < 24) return 'today';
    if (diff.inDays  < 2)  return 'yesterday';
    return '${months[dt.month - 1]} ${dt.day}';
  }
}

// ─── Locked badge bottom sheet ────────────────────────────────────────────────

class _LockedBadgeSheet extends StatelessWidget {
  final AppBadge badge;
  const _LockedBadgeSheet({required this.badge});

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    final b     = badge;

    return Container(
      margin:  const EdgeInsets.fromLTRB(12, 0, 12, 16),
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color:        cs.surface,
        borderRadius: BorderRadius.circular(28),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Drag handle
          Container(
            width:  36,
            height: 4,
            margin: const EdgeInsets.only(bottom: 20),
            decoration: BoxDecoration(
              color:        amina.cardBorder,
              borderRadius: BorderRadius.circular(2),
            ),
          ),

          // Icon (greyed)
          Stack(
            alignment: Alignment.center,
            children: [
              Container(
                width:  80,
                height: 80,
                decoration: BoxDecoration(
                  color: amina.inputFill,
                  shape: BoxShape.circle,
                ),
                child: Center(
                  child: Text(b.emoji,
                      style: const TextStyle(fontSize: 36)),
                ),
              ),
              Positioned.fill(
                child: Container(
                  decoration: BoxDecoration(
                    color: cs.surface.withValues(alpha: 0.55),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(
                    Icons.lock_rounded,
                    color: Color(0xFF9CA3AF),
                    size:  26,
                  ),
                ),
              ),
            ],
          ),

          const SizedBox(height: 14),

          Text(
            b.name,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize:   20,
              fontWeight: FontWeight.w800,
              color:      cs.onSurface,
            ),
          ),

          const SizedBox(height: 8),

          // How to earn container
          Container(
            width:   double.infinity,
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color:        amina.inputFill,
              borderRadius: BorderRadius.circular(14),
              border:       Border.all(color: amina.cardBorder),
            ),
            child: Column(
              children: [
                const Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.emoji_events_rounded,
                        color: Color(0xFFD97706), size: 16),
                    SizedBox(width: 6),
                    Text(
                      'How to earn this badge',
                      style: TextStyle(
                        fontSize:   12.5,
                        fontWeight: FontWeight.w700,
                        color:      Color(0xFFD97706),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  b.howToEarn,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 14,
                    color:    cs.onSurfaceVariant,
                    height:   1.45,
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 20),

          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: () => Navigator.of(context).pop(),
              style: ElevatedButton.styleFrom(
                backgroundColor: cs.primary,
                foregroundColor: Colors.white,
                elevation:       0,
                padding: const EdgeInsets.symmetric(vertical: 15),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
              ),
              child: const Text(
                'Got it — I\'ll work on it! 💪',
                style: TextStyle(
                  fontSize:   15,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Confetti system ──────────────────────────────────────────────────────────

class _Particle {
  final double  startX;
  final Offset  velocity;
  final Color   color;
  final double  radius;
  final double  delay;
  final double  rotSpeed;

  const _Particle({
    required this.startX,
    required this.velocity,
    required this.color,
    required this.radius,
    required this.delay,
    required this.rotSpeed,
  });
}

List<_Particle> _generateParticles(math.Random rng) {
  return List.generate(48, (i) {
    final angle = rng.nextDouble() * 2 * math.pi;
    final speed = rng.nextDouble() * 180 + 80;
    return _Particle(
      startX:   rng.nextDouble(),
      velocity: Offset(
        math.cos(angle) * speed * 0.6,
        math.sin(angle).abs() * speed + 60,
      ),
      color:    _kConfettiColors[rng.nextInt(_kConfettiColors.length)],
      radius:   rng.nextDouble() * 5 + 3,
      delay:    rng.nextDouble() * 0.25,
      rotSpeed: (rng.nextDouble() - 0.5) * 4,
    );
  });
}

class _ConfettiPainter extends CustomPainter {
  final double          progress;
  final List<_Particle> particles;

  const _ConfettiPainter({required this.progress, required this.particles});

  @override
  void paint(Canvas canvas, Size size) {
    for (final p in particles) {
      if (progress < p.delay) continue;
      final t = ((progress - p.delay) / (1 - p.delay)).clamp(0.0, 1.0);

      final x = size.width  * p.startX + p.velocity.dx * t;
      final y = size.height * 0.25     + p.velocity.dy * t;

      final alpha = t < 0.65 ? 1.0 : (1.0 - (t - 0.65) / 0.35);

      final paint = Paint()
        ..color = p.color.withValues(alpha: alpha.clamp(0.0, 1.0));

      canvas.save();
      canvas.translate(x, y);
      canvas.rotate(p.rotSpeed * t * math.pi);

      if (particles.indexOf(p).isEven) {
        canvas.drawRRect(
          RRect.fromRectAndRadius(
            Rect.fromCenter(
              center: Offset.zero,
              width:  p.radius * 2,
              height: p.radius,
            ),
            Radius.circular(p.radius * 0.4),
          ),
          paint,
        );
      } else {
        canvas.drawCircle(Offset.zero, p.radius * 0.8, paint);
      }
      canvas.restore();
    }
  }

  @override
  bool shouldRepaint(covariant _ConfettiPainter old) =>
      old.progress != progress;
}
