import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/components/amina_header.dart';
import '../widgets/daily_habit_overview.dart';
import '../widgets/health_trends_chart.dart';
import '../widgets/village_rank_card.dart';

// ── Hero / podium brand constants — fixed semantic identity ────────────────────
//
// The dark navy-to-forest gradient is the brand surface for both the XP hero
// banner and the village podium — same principle as _kVillageGradStart/End in
// village_standing_card.dart.  _kOnHero is near-white text on the always-dark
// branded surface.  Medal colours are data-identity award constants.

const _kOnHero = Color(0xFFF5F5F5); // near-white — text on colored surfaces
const _kGold          = Color(0xFFD4A017); // gold medal  — award identity
const _kSilver        = Color(0xFFCBD5E1); // silver medal — award identity
const _kBronze        = Color(0xFFCD7F32); // bronze medal — award identity

// ── Badge-count pill — amber award identity ───────────────────────────────────
const _kAmberPill = Color(0xFFFEF3C7);
const _kAmberText = Color(0xFFB45309);

// ═══════════════════════════════════════════════════════════════════════════════
// MODELS
// ═══════════════════════════════════════════════════════════════════════════════

class VillageNeighbor {
  final String name;
  final String avatar;
  final int    weeklyScore;
  final int    streak;
  final bool   isCurrentUser;

  const VillageNeighbor({
    required this.name,
    required this.avatar,
    required this.weeklyScore,
    required this.streak,
    this.isCurrentUser = false,
  });
}

class HealthBadge {
  final String emoji;
  final String title;
  final String description;
  final bool   isEarned;
  final Color  color;
  final int?   progressValue;
  final int?   progressGoal;

  const HealthBadge({
    required this.emoji,
    required this.title,
    required this.description,
    required this.isEarned,
    required this.color,
    this.progressValue,
    this.progressGoal,
  });

  double? get progressRatio {
    if (progressValue == null || progressGoal == null) return null;
    return (progressValue! / progressGoal!).clamp(0.0, 1.0);
  }
}

class ProgressData {
  final int                   userRank;
  final int                   totalUsers;
  final int                   weeklyScore;
  final int                   weeklyGoal;
  final int                   currentStreak;
  final List<VillageNeighbor> leaderboard;
  final List<HealthBadge>     badges;

  const ProgressData({
    required this.userRank,
    required this.totalUsers,
    required this.weeklyScore,
    required this.weeklyGoal,
    required this.currentStreak,
    required this.leaderboard,
    required this.badges,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK DATA
// ═══════════════════════════════════════════════════════════════════════════════

const _kMock = ProgressData(
  userRank:      2,
  totalUsers:    48,
  weeklyScore:   340,
  weeklyGoal:    500,
  currentStreak: 5,
  leaderboard: [
    VillageNeighbor(name: 'Fatou D.',   avatar: '🌸', weeklyScore: 480, streak: 12),
    VillageNeighbor(name: 'You',        avatar: '⭐', weeklyScore: 340, streak: 5, isCurrentUser: true),
    VillageNeighbor(name: 'Aminata K.', avatar: '🌿', weeklyScore: 310, streak: 8),
    VillageNeighbor(name: 'Ibrahim S.', avatar: '🌊', weeklyScore: 290, streak: 3),
    VillageNeighbor(name: 'Mariam B.',  avatar: '🌻', weeklyScore: 210, streak: 6),
    VillageNeighbor(name: 'Ousmane T.', avatar: '🦁', weeklyScore: 180, streak: 2),
  ],
  badges: [
    HealthBadge(
      emoji: '💧', title: 'Hydration Hero',
      description: 'Log water intake 7 days in a row',
      isEarned: true, color: Color(0xFF60A5FA),
    ),
    HealthBadge(
      emoji: '🔥', title: '7-Day Streak',
      description: 'Check in every day for a week',
      isEarned: true, color: Color(0xFFFB923C),
    ),
    HealthBadge(
      emoji: '💊', title: 'Med Master',
      description: 'Take all meds on time for 7 days',
      isEarned: true, color: Color(0xFFA78BFA),
    ),
    HealthBadge(
      emoji: '🏃', title: 'Step Champion',
      description: 'Reach 5 000 steps in a day',
      isEarned: false, color: Color(0xFF34D399),
      progressValue: 3200, progressGoal: 5000,
    ),
    HealthBadge(
      emoji: '🥗', title: 'Nutrition Star',
      description: 'Log 5 healthy meals',
      isEarned: false, color: Color(0xFF3D9970),
      progressValue: 3, progressGoal: 5,
    ),
    HealthBadge(
      emoji: '😴', title: 'Sleep Expert',
      description: 'Log 8 h sleep for 5 nights',
      isEarned: false, color: Color(0xFF818CF8),
      progressValue: 2, progressGoal: 5,
    ),
    HealthBadge(
      emoji: '❤️', title: 'Heart Hero',
      description: 'Keep BP in range for 14 days',
      isEarned: false, color: Color(0xFFF87171),
      progressValue: 6, progressGoal: 14,
    ),
    HealthBadge(
      emoji: '🧘', title: 'Mindful Master',
      description: 'Complete 10 mindful check-ins',
      isEarned: false, color: Color(0xFFFBBF24),
      progressValue: 4, progressGoal: 10,
    ),
    HealthBadge(
      emoji: '📋', title: 'Log Legend',
      description: 'Fill in your daily report 30 days',
      isEarned: false, color: Color(0xFF38BDF8),
      progressValue: 12, progressGoal: 30,
    ),
  ],
);

// ═══════════════════════════════════════════════════════════════════════════════
// PROVIDER
//
// FutureProvider + await Future.delayed(Duration.zero) is the crash fix for
// IndexedStack: frame 1 sees AsyncLoading → empty Scaffold (no compositing),
// frame 2+ sees AsyncData → full UI after layout is already complete.
// ═══════════════════════════════════════════════════════════════════════════════

final progressDataProvider = FutureProvider<ProgressData>((ref) async {
  await Future<void>.delayed(Duration.zero);
  return _kMock;
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT SCREEN
// ═══════════════════════════════════════════════════════════════════════════════

class ProgressScreen extends ConsumerStatefulWidget {
  const ProgressScreen({super.key});

  @override
  ConsumerState<ProgressScreen> createState() => _ProgressScreenState();
}

class _ProgressScreenState extends ConsumerState<ProgressScreen> {
  final _scroll    = ScrollController();
  bool  _collapsed = false;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_onScroll);
  }

  void _onScroll() {
    final c = _scroll.offset > 130;
    if (c != _collapsed) setState(() => _collapsed = c);
  }

  @override
  void dispose() {
    _scroll
      ..removeListener(_onScroll)
      ..dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // ── Single theme read — propagated to every child ──────────────────
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    final async = ref.watch(progressDataProvider);

    return async.when(
      loading: () => Scaffold(
        backgroundColor: amina.scaffoldBg,
        body: const SizedBox.shrink(),
      ),
      error: (err, _) => Scaffold(
        backgroundColor: amina.scaffoldBg,
        appBar: const AminaHeader(title: 'My Progress'),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.wifi_off_rounded, size: 64,
                    color: cs.onSurfaceVariant),
                const SizedBox(height: 20),
                Text(
                  'Could not load your progress.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize:   18,
                    fontWeight: FontWeight.w700,
                    color:      cs.onSurface,
                    fontFamily: 'Inter',
                  ),
                ),
                const SizedBox(height: 28),
                ElevatedButton.icon(
                  onPressed: () => ref.invalidate(progressDataProvider),
                  icon:  const Icon(Icons.refresh_rounded),
                  label: const Text('Retry',
                      style: TextStyle(fontSize: 16, fontFamily: 'Inter')),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: cs.primary,
                    foregroundColor: cs.onPrimary,
                    minimumSize: const Size(160, 52),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(16)),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
      data: (data) => Scaffold(
        backgroundColor: amina.scaffoldBg,
        appBar: const AminaHeader(title: 'My Progress'),
        body: ListView(
          controller: _scroll,
          padding: const EdgeInsets.only(bottom: 110),
          children: [
            // ── Section 1 + 2: Trends chart fused with calendar ──────────
            const SizedBox(height: 20),
            HealthTrendsChart(collapsed: _collapsed),

            // ── Section 3: Daily habits — live Riverpod state ─────────────
            const SizedBox(height: 24),
            const DailyHabitOverview(),

            // ── Section 4: Village rank & community pillars ───────────────
            const SizedBox(height: 24),
            const VillageRankCard(),

            // ── Section 6: Village standing leaderboard ───────────────────
            const SizedBox(height: 24),
            _VillageLeaderboard(neighbors: data.leaderboard),

            // ── Section 7: Badge gallery ───────────────────────────────────
            const SizedBox(height: 28),
            _BadgeGallery(badges: data.badges),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// VILLAGE LEADERBOARD
// ═══════════════════════════════════════════════════════════════════════════════

class _VillageLeaderboard extends StatelessWidget {
  final List<VillageNeighbor> neighbors;
  const _VillageLeaderboard({required this.neighbors});

  @override
  Widget build(BuildContext context) {
    if (neighbors.isEmpty) return const SizedBox.shrink();

    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    final sorted = [...neighbors]
      ..sort((a, b) => b.weeklyScore.compareTo(a.weeklyScore));

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [

          // ── Section heading ──────────────────────────────────────────────
          Row(
            children: [
              Text(
                'Village Standing',
                style: TextStyle(
                  fontSize:   22,
                  fontWeight: FontWeight.w800,
                  color:      cs.onSurface,
                  fontFamily: 'Inter',
                ),
              ),
              const SizedBox(width: 10),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color:        cs.primaryContainer,
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  'This Week',
                  style: TextStyle(
                    fontSize:   12,
                    fontWeight: FontWeight.w700,
                    color:      cs.primary,
                    fontFamily: 'Inter',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'Earn XP through daily check-ins and healthy habits.',
            style: TextStyle(
              fontSize:   14,
              color:      cs.onSurfaceVariant,
              height:     1.4,
              fontFamily: 'Inter',
            ),
          ),
          const SizedBox(height: 16),

          // ── Card ─────────────────────────────────────────────────────────
          Container(
            decoration: BoxDecoration(
              color:        cs.surface,
              borderRadius: BorderRadius.circular(28),
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
              children: [
                _Podium(
                  first:  sorted.isNotEmpty ? sorted[0] : null,
                  second: sorted.length > 1 ? sorted[1] : null,
                  third:  sorted.length > 2 ? sorted[2] : null,
                  cs:     cs,
                ),
                if (sorted.length > 3) ...[
                  Divider(height: 1, color: amina.cardBorder),
                  ...sorted.skip(3).toList().asMap().entries.map((e) =>
                    _LeaderRow(
                      rank:     e.key + 4,
                      neighbor: e.value,
                      isLast:   e.key == sorted.length - 4,
                      cs:       cs,
                      amina:    amina,
                    ),
                  ),
                ],

                // Footer
                Container(
                  width:   double.infinity,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  color:   cs.primaryContainer,
                  child: Text(
                    '🌍  Stay consistent — your village is watching!',
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
          ),
        ],
      ),
    );
  }
}

// ── Podium ────────────────────────────────────────────────────────────────────

class _Podium extends StatelessWidget {
  final VillageNeighbor? first;
  final VillageNeighbor? second;
  final VillageNeighbor? third;
  final ColorScheme      cs;
  const _Podium({this.first, this.second, this.third, required this.cs});

  @override
  Widget build(BuildContext context) => Container(
    decoration: BoxDecoration(
      gradient: LinearGradient(
        colors: [cs.primaryContainer, cs.tertiaryContainer],
        begin:  Alignment.centerLeft,
        end:    Alignment.centerRight,
      ),
    ),
    padding: const EdgeInsets.fromLTRB(16, 24, 16, 28),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Expanded(
          child: second != null
              ? _PodiumSlot(neighbor: second!, rank: 2, height: 72,
                  medalColor: _kSilver, cs: cs)
              : const SizedBox(),
        ),
        Expanded(
          child: first != null
              ? _PodiumSlot(neighbor: first!, rank: 1, height: 96,
                  medalColor: _kGold, isFirst: true, cs: cs)
              : const SizedBox(),
        ),
        Expanded(
          child: third != null
              ? _PodiumSlot(neighbor: third!, rank: 3, height: 56,
                  medalColor: _kBronze, cs: cs)
              : const SizedBox(),
        ),
      ],
    ),
  );
}

// ── Podium slot ───────────────────────────────────────────────────────────────

class _PodiumSlot extends StatelessWidget {
  final VillageNeighbor neighbor;
  final int         rank;
  final double      height;
  final Color       medalColor;
  final bool        isFirst;
  final ColorScheme cs;
  const _PodiumSlot({
    required this.neighbor,
    required this.rank,
    required this.height,
    required this.medalColor,
    required this.cs,
    this.isFirst = false,
  });

  @override
  Widget build(BuildContext context) {
    final isUser = neighbor.isCurrentUser;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (isFirst)
          const Text('👑', style: TextStyle(fontSize: 22))
        else
          const SizedBox(height: 28),
        const SizedBox(height: 6),

        Container(
          width:  isFirst ? 66 : 54,
          height: isFirst ? 66 : 54,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: isUser
                ? cs.primary.withValues(alpha: 0.23)
                : _kOnHero.withValues(alpha: 0.12),
            border: Border.all(
              color: isUser ? cs.primary : medalColor.withValues(alpha: 0.60),
              width: isFirst ? 2.5 : 2.0,
            ),
          ),
          child: Center(
            child: Text(
              neighbor.avatar,
              style: TextStyle(fontSize: isFirst ? 28 : 22),
            ),
          ),
        ),
        const SizedBox(height: 8),

        Text(
          neighbor.name,
          textAlign: TextAlign.center,
          maxLines:  1,
          overflow:  TextOverflow.ellipsis,
          style: TextStyle(
            fontSize:   isFirst ? 14 : 12,
            fontWeight: FontWeight.w700,
            color:      isUser ? cs.primary : cs.onSurface,
            fontFamily: 'Inter',
          ),
        ),
        const SizedBox(height: 3),

        Text(
          '${neighbor.weeklyScore} XP',
          style: TextStyle(
            fontSize:   isFirst ? 13 : 11,
            fontWeight: FontWeight.w600,
            color:      cs.onSurfaceVariant,
            fontFamily: 'Inter',
          ),
        ),
        const SizedBox(height: 10),

        Container(
          width:  double.infinity,
          height: height,
          decoration: BoxDecoration(
            color:        medalColor.withValues(alpha: isFirst ? 0.25 : 0.15),
            borderRadius: const BorderRadius.vertical(top: Radius.circular(12)),
            border:       Border.all(
                color: medalColor.withValues(alpha: 0.35), width: 1.5),
          ),
          alignment: Alignment.center,
          child: Text(
            '#$rank',
            style: TextStyle(
              fontSize:   isFirst ? 22 : 18,
              fontWeight: FontWeight.w900,
              color:      medalColor,
              fontFamily: 'Inter',
            ),
          ),
        ),
      ],
    );
  }
}

// ── Leader row (rank 4+) ──────────────────────────────────────────────────────

class _LeaderRow extends StatelessWidget {
  final int             rank;
  final VillageNeighbor neighbor;
  final bool            isLast;
  final ColorScheme     cs;
  final AminaColors     amina;
  const _LeaderRow({
    required this.rank,
    required this.neighbor,
    required this.isLast,
    required this.cs,
    required this.amina,
  });

  @override
  Widget build(BuildContext context) {
    final isUser = neighbor.isCurrentUser;
    return Container(
      color: isUser ? cs.primaryContainer : Colors.transparent,
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
            child: Row(
              children: [
                SizedBox(
                  width: 28,
                  child: Text(
                    '$rank',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize:   15,
                      fontWeight: FontWeight.w700,
                      color:      isUser ? cs.primary : cs.onSurfaceVariant,
                      fontFamily: 'Inter',
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Container(
                  width:  48,
                  height: 48,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: isUser
                        ? cs.primary.withValues(alpha: 0.15)
                        : amina.inputFill,
                  ),
                  child: Center(
                    child: Text(neighbor.avatar,
                        style: const TextStyle(fontSize: 22)),
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        neighbor.name,
                        style: TextStyle(
                          fontSize:   16,
                          fontWeight: FontWeight.w700,
                          color:      isUser ? cs.primary : cs.onSurface,
                          fontFamily: 'Inter',
                        ),
                      ),
                      const SizedBox(height: 2),
                      Row(
                        children: [
                          const Text('🔥', style: TextStyle(fontSize: 11)),
                          const SizedBox(width: 3),
                          Text(
                            '${neighbor.streak} day streak',
                            style: TextStyle(
                              fontSize:   12,
                              color:      cs.onSurfaceVariant,
                              fontWeight: FontWeight.w500,
                              fontFamily: 'Inter',
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      '${neighbor.weeklyScore}',
                      style: TextStyle(
                        fontSize:   18,
                        fontWeight: FontWeight.w800,
                        color:      isUser ? cs.primary : cs.onSurface,
                        fontFamily: 'Inter',
                      ),
                    ),
                    Text(
                      'XP',
                      style: TextStyle(
                        fontSize:   11,
                        color:      cs.onSurfaceVariant,
                        fontWeight: FontWeight.w600,
                        fontFamily: 'Inter',
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          if (!isLast)
            Divider(height: 1, indent: 90, color: amina.cardBorder),
        ],
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BADGE GALLERY
// ═══════════════════════════════════════════════════════════════════════════════

class _BadgeGallery extends StatelessWidget {
  final List<HealthBadge> badges;
  const _BadgeGallery({required this.badges});

  @override
  Widget build(BuildContext context) {
    if (badges.isEmpty) return const SizedBox.shrink();

    final cs          = Theme.of(context).colorScheme;
    final earnedCount = badges.where((b) => b.isEarned).length;
    final ordered     = [
      ...badges.where((b) =>  b.isEarned),
      ...badges.where((b) => !b.isEarned),
    ];

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                'Health Medals',
                style: TextStyle(
                  fontSize:   22,
                  fontWeight: FontWeight.w800,
                  color:      cs.onSurface,
                  fontFamily: 'Inter',
                ),
              ),
              const SizedBox(width: 10),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color:        _kAmberPill,   // amber award identity — fixed
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  '$earnedCount / ${badges.length}',
                  style: const TextStyle(
                    fontSize:   12,
                    fontWeight: FontWeight.w700,
                    color:      _kAmberText,
                    fontFamily: 'Inter',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            earnedCount == badges.length
                ? 'You\'ve collected every medal! 🏆'
                : 'Tap a locked medal to see how to earn it.',
            style: TextStyle(
              fontSize:   14,
              color:      cs.onSurfaceVariant,
              height:     1.4,
              fontFamily: 'Inter',
            ),
          ),
          const SizedBox(height: 16),

          GridView.builder(
            shrinkWrap:   true,
            physics:      const NeverScrollableScrollPhysics(),
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount:   3,
              crossAxisSpacing: 12,
              mainAxisSpacing:  12,
              mainAxisExtent:   175,
            ),
            itemCount:    ordered.length,
            itemBuilder:  (_, i) => _MedalChip(badge: ordered[i]),
          ),
        ],
      ),
    );
  }
}

// ── Medal chip — compositing-safe: no ColorFiltered, no Opacity(<1) ───────────

class _MedalChip extends StatefulWidget {
  final HealthBadge badge;
  const _MedalChip({required this.badge});

  @override
  State<_MedalChip> createState() => _MedalChipState();
}

class _MedalChipState extends State<_MedalChip>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulse;

  @override
  void initState() {
    super.initState();
    _pulse = AnimationController(
      vsync:    this,
      duration: const Duration(milliseconds: 1800),
    );
    if (widget.badge.isEarned) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _pulse.repeat(reverse: true);
      });
    }
  }

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  void _showLockedHint() {
    final b = widget.badge;
    showModalBottomSheet(
      context:          context,
      backgroundColor:  Colors.transparent,
      isScrollControlled: true,
      builder: (sheetCtx) {
        final cs    = Theme.of(sheetCtx).colorScheme;
        final amina = Theme.of(sheetCtx).extension<AminaColors>()!;
        return Container(
          decoration: BoxDecoration(
            color:        cs.surface,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
          ),
          padding: EdgeInsets.fromLTRB(
              28, 20, 28, 24 + MediaQuery.of(sheetCtx).padding.bottom),
          child: SingleChildScrollView(
            child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Handle
              Container(
                width:  40,
                height: 4,
                decoration: BoxDecoration(
                  color:        amina.cardBorder,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(height: 24),
              Container(
                width:  72,
                height: 72,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: b.color.withValues(alpha: 0.12),
                ),
                child: Center(
                  child: Text(b.emoji,
                      style: const TextStyle(fontSize: 34)),
                ),
              ),
              const SizedBox(height: 16),
              Text(
                b.title,
                style: TextStyle(
                  fontSize:   20,
                  fontWeight: FontWeight.w800,
                  color:      cs.onSurface,
                  fontFamily: 'Inter',
                ),
              ),
              const SizedBox(height: 8),
              Text(
                b.description,
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize:   15,
                  color:      cs.onSurfaceVariant,
                  height:     1.5,
                  fontFamily: 'Inter',
                ),
              ),
              if (b.progressRatio != null) ...[
                const SizedBox(height: 20),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('Progress',
                      style: TextStyle(
                        fontSize:   13,
                        fontWeight: FontWeight.w600,
                        color:      cs.onSurfaceVariant,
                        fontFamily: 'Inter',
                      ),
                    ),
                    Text(
                      '${b.progressValue} / ${b.progressGoal}',
                      style: TextStyle(
                        fontSize:   13,
                        fontWeight: FontWeight.w700,
                        color:      b.color,
                        fontFamily: 'Inter',
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: LinearProgressIndicator(
                    value:           b.progressRatio,
                    minHeight:       10,
                    backgroundColor: b.color.withValues(alpha: 0.12),
                    valueColor:      AlwaysStoppedAnimation(b.color),
                  ),
                ),
              ],
              const SizedBox(height: 28),
              SizedBox(
                width: double.infinity, height: 52,
                child: ElevatedButton(
                  onPressed: () => Navigator.pop(sheetCtx),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: b.color,
                    foregroundColor: _kOnHero,   // near-white on any badge color
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(16)),
                    elevation: 0,
                  ),
                  child: const Text(
                    'Got it — I\'ll keep going! 💪',
                    style: TextStyle(
                      fontSize:   15,
                      fontWeight: FontWeight.w700,
                      fontFamily: 'Inter',
                    ),
                  ),
                ),
              ),
            ],
          ),
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final b        = widget.badge;
    final isEarned = b.isEarned;
    final cs       = Theme.of(context).colorScheme;
    final amina    = Theme.of(context).extension<AminaColors>()!;

    return GestureDetector(
      onTap: isEarned ? null : _showLockedHint,
      child: AnimatedBuilder(
        animation: _pulse,
        builder: (_, child) => Container(
          decoration: BoxDecoration(
            color:        cs.surface,
            borderRadius: BorderRadius.circular(22),
            border: Border.all(
              color: isEarned
                  ? b.color.withValues(alpha: 0.40)
                  : amina.cardBorder,
              width: isEarned ? 1.5 : 1.0,
            ),
            boxShadow: isEarned
                ? [
                    BoxShadow(
                      color:        b.color.withValues(
                          alpha: 0.10 + _pulse.value * 0.20),
                      blurRadius:   14 + _pulse.value * 10,
                      spreadRadius: _pulse.value * 3,
                    ),
                  ]
                : [
                    BoxShadow(
                      color:      cs.shadow.withValues(alpha: 0.04),
                      blurRadius: 8,
                      offset:     const Offset(0, 2),
                    ),
                  ],
          ),
          child: child,
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 8),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Stack(
                alignment: Alignment.center,
                children: [
                  Container(
                    width:  60,
                    height: 60,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: isEarned
                          ? b.color.withValues(alpha: 0.13)
                          : amina.inputFill,
                    ),
                    child: Center(
                      child: isEarned
                          ? Text(b.emoji,
                              style: const TextStyle(fontSize: 28))
                          : Icon(Icons.lock_rounded,
                              size: 26, color: cs.onSurfaceVariant),
                    ),
                  ),
                  Positioned(
                    bottom: 0, right: 0,
                    child: Container(
                      width:  22,
                      height: 22,
                      decoration: BoxDecoration(
                        shape:  BoxShape.circle,
                        color:  isEarned ? b.color : cs.onSurfaceVariant,
                        border: Border.all(color: cs.surface, width: 2),
                      ),
                      child: Icon(
                        isEarned
                            ? Icons.check_rounded
                            : Icons.lock_outline_rounded,
                        size:  11,
                        color: _kOnHero,   // near-white on colored / muted circle
                      ),
                    ),
                  ),
                ],
              ),

              const SizedBox(height: 10),

              Text(
                b.title,
                textAlign: TextAlign.center,
                maxLines:  2,
                overflow:  TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize:   12,
                  fontWeight: FontWeight.w700,
                  height:     1.25,
                  color:      isEarned ? cs.onSurface : cs.onSurfaceVariant,
                  fontFamily: 'Inter',
                ),
              ),

              const SizedBox(height: 6),

              if (!isEarned && b.progressRatio != null) ...[
                ClipRRect(
                  borderRadius: BorderRadius.circular(4),
                  child: LinearProgressIndicator(
                    value:           b.progressRatio,
                    minHeight:       5,
                    backgroundColor: b.color.withValues(alpha: 0.12),
                    valueColor:      AlwaysStoppedAnimation(
                        b.color.withValues(alpha: 0.70)),
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  '${b.progressValue}/${b.progressGoal}',
                  style: TextStyle(
                    fontSize:   10,
                    fontWeight: FontWeight.w600,
                    color:      b.color.withValues(alpha: 0.80),
                    fontFamily: 'Inter',
                  ),
                ),
              ],

              if (isEarned)
                Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color:        b.color.withValues(alpha: 0.10),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    'Earned ✓',
                    style: TextStyle(
                      fontSize:   10,
                      fontWeight: FontWeight.w700,
                      color:      b.color,
                      fontFamily: 'Inter',
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
