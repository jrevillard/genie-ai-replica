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
import '../../../../core/theme/app_theme.dart';
import '../../domain/entities/village_scoreboard.dart';
import '../providers/village_scoreboard_provider.dart';

// ── Pillar identity — semantic data colours, fixed across themes ──────────────

const _kPillarIcons = <String, IconData>{
  'screening': Icons.favorite_rounded,
  'adherence': Icons.medication_rounded,
  'diet':      Icons.eco_rounded,
  'youth':     Icons.groups_rounded,
  'emergency': Icons.emergency_rounded,
};

const _kPillarAccents = <String, Color>{
  'screening': Color(0xFF60A5FA),
  'adherence': Color(0xFFA78BFA),
  'diet':      Color(0xFF34D399),
  'youth':     Color(0xFFFB923C),
  'emergency': Color(0xFFF87171),
};

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC WIDGET
// ═══════════════════════════════════════════════════════════════════════════════

class VillageRankCard extends ConsumerWidget {
  const VillageRankCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    final async = ref.watch(villageScoreboardProvider);

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      decoration: BoxDecoration(
        color:        cs.surface,
        borderRadius: BorderRadius.circular(24),
        border:       Border.all(color: amina.cardBorder),
        boxShadow: [
          BoxShadow(
            color:      amina.sageGlow,
            blurRadius: 24,
            offset:     const Offset(0, 8),
          ),
        ],
      ),
      child: async.when(
        loading: () => const _LoadingBody(),
        error:   (_, _) => _ErrorBody(
            onRetry: () => ref.invalidate(villageScoreboardProvider)),
        data:    (d) => _CardBody(scoreboard: d),
      ),
    );
  }
}

// ── Loading ───────────────────────────────────────────────────────────────────

class _LoadingBody extends StatelessWidget {
  const _LoadingBody();

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 48),
      child:   Center(child: CircularProgressIndicator(
          color: cs.primary, strokeWidth: 2)),
    );
  }
}

// ── Error ─────────────────────────────────────────────────────────────────────

class _ErrorBody extends StatelessWidget {
  final VoidCallback onRetry;
  const _ErrorBody({required this.onRetry});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 28),
      child: Row(
        children: [
          Icon(Icons.wifi_off_rounded, color: cs.onSurfaceVariant, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Text('Could not load village data.',
                style: TextStyle(color: cs.onSurfaceVariant, fontSize: 14,
                    fontFamily: 'Inter')),
          ),
          TextButton(
            onPressed: onRetry,
            child: Text('Retry',
                style: TextStyle(color: cs.primary, fontWeight: FontWeight.w700,
                    fontFamily: 'Inter')),
          ),
        ],
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CARD BODY
// ═══════════════════════════════════════════════════════════════════════════════

class _CardBody extends StatelessWidget {
  final VillageScoreboard scoreboard;
  const _CardBody({required this.scoreboard});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [

          // ── Header: location pill · trend pill ──────────────────────────
          Row(
            children: [
              _LocationPill(region: scoreboard.region),
              const Spacer(),
              _TrendPill(
                trend: scoreboard.trend,
                delta: scoreboard.deltaFromLastMonth,
              ),
            ],
          ),

          const SizedBox(height: 14),

          // ── Village name + score (same row) ──────────────────────────────
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(
                scoreboard.village,
                style: TextStyle(
                  fontSize:   28,
                  fontWeight: FontWeight.w800,
                  color:      cs.onSurface,
                  height:     1.1,
                  fontFamily: 'Inter',
                ),
              ),
              const SizedBox(width: 12),
              Text(
                '${scoreboard.score}',
                style: TextStyle(
                  fontSize:   22,
                  fontWeight: FontWeight.w800,
                  color:      cs.onSurface,
                  fontFamily: 'Inter',
                ),
              ),
              Text(
                '/${scoreboard.maxScore}',
                style: TextStyle(
                  fontSize:   14,
                  color:      cs.onSurfaceVariant,
                  fontFamily: 'Inter',
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'Rank #${scoreboard.regionalRank} of '
            '${scoreboard.regionalTotal} in region',
            style: TextStyle(
              fontSize:   13,
              color:      cs.onSurfaceVariant,
              fontFamily: 'Inter',
            ),
          ),

          const SizedBox(height: 18),

          // ── Pillar rows ───────────────────────────────────────────────────
          ...scoreboard.pillars.map((p) => Padding(
            padding: const EdgeInsets.only(bottom: 14),
            child:   _PillarRow(pillar: p),
          )),

          // ── Leading village ──────────────────────────────────────────────
          if (scoreboard.leadingVillageName != null) ...[
            const SizedBox(height: 6),
            Row(
              children: [
                const Text('🏆', style: TextStyle(fontSize: 13)),
                const SizedBox(width: 6),
                Text(
                  'Leading: ${scoreboard.leadingVillageName} '
                  'at ${scoreboard.leadingVillageScore}',
                  style: TextStyle(
                    fontSize:   13,
                    color:      cs.onSurfaceVariant,
                    fontFamily: 'Inter',
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

// ── Pills ─────────────────────────────────────────────────────────────────────

class _LocationPill extends StatelessWidget {
  final String region;
  const _LocationPill({required this.region});

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color:        amina.inputFill,
        borderRadius: BorderRadius.circular(20),
        border:       Border.all(color: amina.cardBorder),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.location_on_rounded, size: 13, color: cs.onSurfaceVariant),
          const SizedBox(width: 4),
          Text(
            'Village · $region',
            style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600,
                color: cs.onSurfaceVariant, fontFamily: 'Inter'),
          ),
        ],
      ),
    );
  }
}

class _TrendPill extends StatelessWidget {
  final String trend;
  final int    delta;
  const _TrendPill({required this.trend, required this.delta});

  @override
  Widget build(BuildContext context) {
    final cs     = Theme.of(context).colorScheme;
    final isUp   = trend == 'up';
    final isDown = trend == 'down';
    final color  = isUp
        ? const Color(0xFF34D399)
        : isDown ? const Color(0xFFF87171) : cs.onSurfaceVariant;
    final icon   = isUp
        ? Icons.trending_up_rounded
        : isDown ? Icons.trending_down_rounded : Icons.trending_flat_rounded;
    final sign   = delta > 0 ? '+' : '';
    final label  = delta != 0 ? '$sign$delta this month' : 'No change';

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color:        color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(20),
        border:       Border.all(color: color.withValues(alpha: 0.30)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: color),
          const SizedBox(width: 4),
          Text(label, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700,
              color: color, fontFamily: 'Inter')),
        ],
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PILLAR ROW — icon · name + bar · score + "X left"
// ═══════════════════════════════════════════════════════════════════════════════

class _PillarRow extends StatelessWidget {
  final VillagePillar pillar;
  const _PillarRow({required this.pillar});

  @override
  Widget build(BuildContext context) {
    final icon   = _kPillarIcons[pillar.id]   ?? Icons.analytics_outlined;
    final accent = _kPillarAccents[pillar.id] ?? const Color(0xFF94A3B8);
    final left   = pillar.max - pillar.score;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [

        // Icon circle
        Container(
          width:  46,
          height: 46,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: accent.withValues(alpha: 0.18),
          ),
          child: Icon(icon, color: accent, size: 22),
        ),
        const SizedBox(width: 14),

        // Name + progress bar
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                pillar.name,
                style: TextStyle(
                  fontSize:   15,
                  fontWeight: FontWeight.w600,
                  color:      Theme.of(context).colorScheme.onSurface,
                  fontFamily: 'Inter',
                ),
              ),
              const SizedBox(height: 8),
              ClipRRect(
                borderRadius: BorderRadius.circular(4),
                child: LinearProgressIndicator(
                  value:           pillar.pct,
                  minHeight:       6,
                  backgroundColor: accent.withValues(alpha: 0.18),
                  valueColor:      AlwaysStoppedAnimation(accent),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(width: 14),

        // Score + remaining
        Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(
              '${pillar.score}/${pillar.max}',
              style: TextStyle(
                fontSize:   16,
                fontWeight: FontWeight.w800,
                color:      Theme.of(context).colorScheme.onSurface,
                fontFamily: 'Inter',
              ),
            ),
            Text(
              '$left left',
              style: TextStyle(
                fontSize:   11,
                color:      Theme.of(context).colorScheme.onSurfaceVariant,
                fontFamily: 'Inter',
              ),
            ),
          ],
        ),
      ],
    );
  }
}
