import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/theme/app_theme.dart';
import '../../data/models/gamification_model.dart';
import '../providers/gamification_provider.dart';

// ── Village brand colours — semantic identity, fixed across both modes ─────────
//
// The header gradient represents the "community / nature" brand of the Village
// feature — same principle as category colours in care_plan_sheet.dart.
// _kOnVillageHeader is always near-white because the gradient is always a dark
// forest-green surface (a semantic necessity, not a theme-adaptive choice).

const _kVillageGradStart = Color(0xFF2B7A56); // forest sage  — brand identity
const _kVillageGradEnd   = Color(0xFF1A4E38); // deep forest  — brand identity
const _kOnVillageHeader  = Color(0xFFF5F5F5); // near-white   — text on dark green

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC WIDGET
// ═══════════════════════════════════════════════════════════════════════════════

/// Warm, community-oriented village standing card.
///
/// Intentionally avoids harsh competitive language — ranks are framed as
/// "contribution standing" rather than a points leaderboard.
///
/// Layout:
///   • Sage-gradient header: village name + membership count + rank pill
///   • Card body: XP progress bar + top-5 neighbor list
///   • Footer: encouraging tagline
class VillageStandingCard extends ConsumerWidget {
  const VillageStandingCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final stats = ref.watch(gamificationProvider);
    final tier  = stats.tier;
    // ── Single theme read — propagated to every child ──────────────────
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;

    return Container(
      decoration: BoxDecoration(
        color:        cs.surface,
        borderRadius: BorderRadius.circular(24),
        border:       Border.all(color: amina.cardBorder),
        boxShadow: [
          BoxShadow(
            color:      cs.shadow.withValues(alpha: 0.05),
            blurRadius: 20,
            offset:     const Offset(0, 6),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [

          // ── Gradient header — village brand ────────────────────────────
          _VillageHeader(stats: stats, tier: tier),

          // ── XP progress bar ────────────────────────────────────────────
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 16, 18, 0),
            child: _XpProgressBar(stats: stats, tier: tier, cs: cs, amina: amina),
          ),

          // ── Top-neighbors section label ────────────────────────────────
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 18, 18, 10),
            child: Row(
              children: [
                Icon(Icons.people_rounded, size: 16, color: cs.onSurfaceVariant),
                const SizedBox(width: 6),
                Text(
                  "This Week's Top Neighbors",
                  style: TextStyle(
                    fontSize:      13,
                    fontWeight:    FontWeight.w700,
                    color:         cs.onSurfaceVariant,
                    letterSpacing: 0.1,
                    fontFamily:    'Inter',
                  ),
                ),
              ],
            ),
          ),

          // ── Neighbor list ──────────────────────────────────────────────
          ...stats.topNeighbors.asMap().entries.map((e) => _NeighborTile(
                rank:     e.key + 1,
                neighbor: e.value,
                cs:       cs,
                amina:    amina,
              )),

          // ── Footer tagline ─────────────────────────────────────────────
          Container(
            width:   double.infinity,
            padding: const EdgeInsets.symmetric(vertical: 14),
            // primaryContainer: sage-light in light, deep sage in dark
            color: cs.primaryContainer,
            child: Text(
              '🌱  You\'re doing great for your community!',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize:   13,
                fontWeight: FontWeight.w600,
                color:      cs.primary,
                fontFamily: 'Inter',
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// VILLAGE HEADER
//
// Uses fixed brand constants throughout — the dark-green gradient is the
// community identity of the Village feature, always rendered the same way.
// All text on the gradient uses _kOnVillageHeader (near-white) for contrast.
// ═══════════════════════════════════════════════════════════════════════════════

class _VillageHeader extends StatelessWidget {
  final UserGameStats    stats;
  final ContributionTier tier;
  const _VillageHeader({required this.stats, required this.tier});

  static const _grad = LinearGradient(
    begin:  Alignment.topLeft,
    end:    Alignment.bottomRight,
    colors: [_kVillageGradStart, _kVillageGradEnd],
  );

  @override
  Widget build(BuildContext context) {
    final rankLabel = _rankLabel(stats.userRank);

    return Container(
      width:   double.infinity,
      padding: const EdgeInsets.fromLTRB(18, 20, 18, 20),
      decoration: const BoxDecoration(gradient: _grad),
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          // Decorative bubble — tinted with header text colour
          Positioned(
            top:   -20,
            right: -20,
            child: Container(
              width:  80,
              height: 80,
              decoration: BoxDecoration(
                color: _kOnVillageHeader.withValues(alpha: 0.07),
                shape: BoxShape.circle,
              ),
            ),
          ),

          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Village name + member count + rank pill
              Row(
                children: [
                  const Text('🏘️', style: TextStyle(fontSize: 22)),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          stats.villageName,
                          style: const TextStyle(
                            fontSize:      18,
                            fontWeight:    FontWeight.w800,
                            color:         _kOnVillageHeader,
                            letterSpacing: -0.3,
                            fontFamily:    'Inter',
                          ),
                        ),
                        Text(
                          '${stats.totalVillageMembers} health champions',
                          style: TextStyle(
                            fontSize:   12.5,
                            color:      _kOnVillageHeader.withValues(alpha: 0.72),
                            fontFamily: 'Inter',
                          ),
                        ),
                      ],
                    ),
                  ),

                  // Rank pill
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 12, vertical: 6),
                    decoration: BoxDecoration(
                      color:        _kOnVillageHeader.withValues(alpha: 0.18),
                      borderRadius: BorderRadius.circular(20),
                      border:       Border.all(
                          color: _kOnVillageHeader.withValues(alpha: 0.30)),
                    ),
                    child: Text(
                      rankLabel,
                      style: const TextStyle(
                        fontSize:   13,
                        fontWeight: FontWeight.w800,
                        color:      _kOnVillageHeader,
                        fontFamily: 'Inter',
                      ),
                    ),
                  ),
                ],
              ),

              const SizedBox(height: 14),

              // Tier label + XP chip
              Row(
                children: [
                  Text(tier.emoji, style: const TextStyle(fontSize: 18)),
                  const SizedBox(width: 7),
                  Text(
                    tier.label,
                    style: const TextStyle(
                      fontSize:      15,
                      fontWeight:    FontWeight.w700,
                      color:         _kOnVillageHeader,
                      letterSpacing: -0.1,
                      fontFamily:    'Inter',
                    ),
                  ),
                  const Spacer(),
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color:        _kOnVillageHeader.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      '${stats.userXP} XP',
                      style: const TextStyle(
                        fontSize:   12,
                        fontWeight: FontWeight.w700,
                        color:      _kOnVillageHeader,
                        fontFamily: 'Inter',
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    );
  }

  static String _rankLabel(int rank) {
    if (rank == 1) return '🥇 #1';
    if (rank == 2) return '🥈 #2';
    if (rank == 3) return '🥉 #3';
    return '#$rank';
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// XP PROGRESS BAR
// ═══════════════════════════════════════════════════════════════════════════════

class _XpProgressBar extends StatelessWidget {
  final UserGameStats    stats;
  final ContributionTier tier;
  final ColorScheme      cs;
  final AminaColors      amina;
  const _XpProgressBar({
    required this.stats,
    required this.tier,
    required this.cs,
    required this.amina,
  });

  @override
  Widget build(BuildContext context) {
    final progress  = tier.progressFor(stats.userXP);
    final xpToNext  = tier.xpToNext(stats.userXP);
    final isMaxTier = tier == ContributionTier.champion;
    final nextLabel = tier.nextLabel;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Label row
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              isMaxTier
                  ? 'Maximum tier reached! 🎉'
                  : '$xpToNext XP to $nextLabel',
              style: TextStyle(
                fontSize:   12.5,
                fontWeight: FontWeight.w600,
                color:      cs.onSurfaceVariant,
                fontFamily: 'Inter',
              ),
            ),
            Text(
              '${(progress * 100).round()}%',
              style: TextStyle(
                fontSize:   12.5,
                fontWeight: FontWeight.w700,
                color:      cs.primary,
                fontFamily: 'Inter',
              ),
            ),
          ],
        ),

        const SizedBox(height: 8),

        // Bar — track uses cardBorder, fill uses village brand gradient
        ClipRRect(
          borderRadius: BorderRadius.circular(6),
          child: Stack(
            children: [
              Container(height: 8, color: amina.cardBorder),
              TweenAnimationBuilder<double>(
                tween:    Tween(begin: 0, end: progress),
                duration: const Duration(milliseconds: 900),
                curve:    Curves.easeOutCubic,
                builder: (_, value, __) => FractionallySizedBox(
                  widthFactor: value,
                  child: Container(
                    height: 8,
                    // Village brand gradient — consistent with the header.
                    decoration: const BoxDecoration(
                      gradient: LinearGradient(
                        colors: [_kVillageGradStart, _kVillageGradEnd],
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// NEIGHBOR TILE
// ═══════════════════════════════════════════════════════════════════════════════

class _NeighborTile extends StatelessWidget {
  final int             rank;
  final VillageNeighbor neighbor;
  final ColorScheme     cs;
  final AminaColors     amina;
  const _NeighborTile({
    required this.rank,
    required this.neighbor,
    required this.cs,
    required this.amina,
  });

  @override
  Widget build(BuildContext context) {
    final isUser = neighbor.isCurrentUser;

    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      margin:   const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
      padding:  const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
      decoration: BoxDecoration(
        // Current-user row gets a sage highlight; others are transparent.
        color:        isUser ? cs.primaryContainer : Colors.transparent,
        borderRadius: BorderRadius.circular(14),
        border:       isUser
            ? Border.all(color: cs.primary.withValues(alpha: 0.30))
            : null,
      ),
      child: Row(
        children: [
          // Medal / rank number
          SizedBox(
            width: 28,
            child: Text(
              _medal(rank),
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 16),
            ),
          ),

          const SizedBox(width: 10),

          // Avatar circle
          Container(
            width:  36,
            height: 36,
            decoration: BoxDecoration(
              // User: sage tint; others: neutral input fill
              color: isUser
                  ? cs.primary.withValues(alpha: 0.18)
                  : amina.inputFill,
              shape: BoxShape.circle,
            ),
            child: Center(
              child: Text(
                isUser ? '👤' : neighbor.name[0].toUpperCase(),
                style: TextStyle(
                  fontSize:   isUser ? 18 : 14,
                  fontWeight: FontWeight.w700,
                  color:      isUser ? cs.primary : cs.onSurfaceVariant,
                  fontFamily: 'Inter',
                ),
              ),
            ),
          ),

          const SizedBox(width: 10),

          // Name
          Expanded(
            child: Text(
              isUser ? 'You' : neighbor.name,
              style: TextStyle(
                fontSize:   14.5,
                fontWeight: isUser ? FontWeight.w700 : FontWeight.w500,
                color:      isUser ? cs.primary : cs.onSurface,
                fontFamily: 'Inter',
              ),
            ),
          ),

          // XP value
          Text(
            '${neighbor.xp} XP',
            style: TextStyle(
              fontSize:   13,
              fontWeight: isUser ? FontWeight.w700 : FontWeight.w500,
              color:      isUser ? cs.primary : cs.onSurfaceVariant,
              fontFamily: 'Inter',
            ),
          ),

          if (isUser) ...[
            const SizedBox(width: 6),
            Icon(Icons.star_rounded, color: cs.primary, size: 16),
          ],
        ],
      ),
    );
  }

  static String _medal(int rank) {
    if (rank == 1) return '🥇';
    if (rank == 2) return '🥈';
    if (rank == 3) return '🥉';
    return '$rank.';
  }
}
