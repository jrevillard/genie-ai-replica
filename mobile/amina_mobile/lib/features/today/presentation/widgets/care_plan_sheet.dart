import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/theme/app_theme.dart';
import '../providers/care_plan_provider.dart';
import '../providers/daily_plan_provider.dart';

// ─── Track colour — semantic category data, not theme ────────────────────────
//
// These colours identify data sources (Medical / Traditional / AI) and are
// intentionally fixed across both modes, just like a chart legend.

Color _trackColor(PlanTrack t) => const [
      Color(0xFF06B6D4), // cyan    — Medical
      Color(0xFF10B981), // emerald — Traditional
      Color(0xFF8B5CF6), // violet  — AI
    ][t.index];

// ─── Priority badge — semantic signal colours ─────────────────────────────────
//
// Red = danger, Amber = caution. These are universal semantic signals and
// must NOT adapt to theme so their meaning is always unambiguous.

const _kPriorityHigh  = Color(0xFFEF4444); // red
const _kPriorityMid   = Color(0xFFF59E0B); // amber

// ─── Plan-type extension ──────────────────────────────────────────────────────
//
// Semantic colours (category identity) remain hardcoded.
// Only .bgFor() adapts to dark mode so icon-circle backgrounds work correctly
// on both charcoal and white surfaces.

extension _CarePlanTypeX on CarePlanType {
  String get label => switch (this) {
        CarePlanType.medical     => 'Medical',
        CarePlanType.traditional => 'Traditional',
        CarePlanType.ai          => 'AI',
      };

  String get emoji => switch (this) {
        CarePlanType.medical     => '🩺',
        CarePlanType.traditional => '🌿',
        CarePlanType.ai          => '✨',
      };

  IconData get icon => switch (this) {
        CarePlanType.medical     => Icons.medical_services_outlined,
        CarePlanType.traditional => Icons.spa_rounded,
        CarePlanType.ai          => Icons.auto_awesome_rounded,
      };

  /// Semantic category colour — fixed in both themes.
  Color get color => switch (this) {
        CarePlanType.medical     => const Color(0xFF2563EB),
        CarePlanType.traditional => const Color(0xFFD97706),
        CarePlanType.ai          => const Color(0xFF7C3AED),
      };

  /// Light-mode pastel background for this category.
  Color get _lightBg => switch (this) {
        CarePlanType.medical     => const Color(0xFFEFF6FF),
        CarePlanType.traditional => const Color(0xFFFEF3C7),
        CarePlanType.ai          => const Color(0xFFF5F3FF),
      };

  /// Returns the correct background tint for the current brightness.
  ///
  /// Light → soft pastel  |  Dark → colour @18% on charcoal (Oura-style).
  Color bgFor(bool isDark) =>
      isDark ? color.withValues(alpha: 0.18) : _lightBg;

  String get sourceTag => switch (this) {
        CarePlanType.medical     => 'Human Expert',
        CarePlanType.traditional => 'Human Expert',
        CarePlanType.ai          => 'AI Insight',
      };

  IconData get sourceIcon => switch (this) {
        CarePlanType.medical     => Icons.person_rounded,
        CarePlanType.traditional => Icons.people_rounded,
        CarePlanType.ai          => Icons.auto_awesome_rounded,
      };
}

// ─── Entry point ──────────────────────────────────────────────────────────────

void showCarePlanSheet(BuildContext context) {
  showModalBottomSheet<void>(
    context:            context,
    isScrollControlled: true,
    backgroundColor:    Colors.transparent,
    builder:            (_) => const _CarePlanSheet(),
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHEET ROOT
// ═══════════════════════════════════════════════════════════════════════════════

class _CarePlanSheet extends ConsumerStatefulWidget {
  const _CarePlanSheet();

  @override
  ConsumerState<_CarePlanSheet> createState() => _CarePlanSheetState();
}

class _CarePlanSheetState extends ConsumerState<_CarePlanSheet> {
  @override
  Widget build(BuildContext context) {
    // ── Theme reads — the only place colours are resolved ──────────────────
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;

    return DraggableScrollableSheet(
      initialChildSize: 0.88,
      minChildSize:     0.55,
      maxChildSize:     0.96,
      snap:             true,
      snapSizes:        const [0.55, 0.88, 0.96],
      builder: (ctx, scrollCtrl) {
        final planState    = ref.watch(carePlanProvider);
        final planTasks    = ref.watch(dailyPlanProvider);
        final taskNotifier = ref.read(dailyPlanProvider.notifier);

        return Container(
          decoration: BoxDecoration(
            color:        amina.scaffoldBg,           // F8F9FA ↔ 0F1117
            borderRadius: const BorderRadius.vertical(
                top: Radius.circular(28)),
          ),
          child: Column(
            children: [
              // ── Drag handle ───────────────────────────────────────────
              _DragHandle(cs: cs),

              // ── Header ────────────────────────────────────────────────
              _SheetHeader(cs: cs, amina: amina),

              // ── Harmony banner ────────────────────────────────────────
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
                child:   _HarmonyBanner(cs: cs, amina: amina),
              ),

              // ── Tab bar — fixed, always visible ───────────────────────
              _PlanTabBar(activeTab: planState.activeTab, cs: cs, amina: amina),
              Divider(height: 1, thickness: 0.8, color: amina.divider),

              // ── Today's tasks + plan cards scroll together ────────────
              Expanded(
                child: ListView(
                  controller: scrollCtrl,
                  padding: const EdgeInsets.fromLTRB(20, 16, 20, 48),
                  children: [
                    // Tasks scroll away as the user reads the plan
                    Container(
                      decoration: BoxDecoration(
                        color:        cs.surface,
                        borderRadius: BorderRadius.circular(18),
                        border:       Border.all(color: amina.cardBorder),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Padding(
                            padding: const EdgeInsets.fromLTRB(16, 14, 16, 10),
                            child: Row(
                              children: [
                                Text(
                                  "TODAY'S TASKS",
                                  style: TextStyle(
                                    color:         cs.onSurfaceVariant,
                                    fontSize:      10.5,
                                    fontWeight:    FontWeight.w700,
                                    letterSpacing: 1.2,
                                    fontFamily:    'Inter',
                                  ),
                                ),
                                Expanded(
                                  child: Padding(
                                    padding: const EdgeInsets.only(left: 12),
                                    child: Divider(color: amina.divider, height: 1),
                                  ),
                                ),
                                const SizedBox(width: 12),
                                Text(
                                  '${planTasks.doneCount} / '
                                  '${planTasks.totalCount} done',
                                  style: TextStyle(
                                    color:      cs.primary,
                                    fontSize:   11,
                                    fontWeight: FontWeight.w700,
                                    fontFamily: 'Inter',
                                  ),
                                ),
                              ],
                            ),
                          ),
                          Padding(
                            padding: const EdgeInsets.fromLTRB(16, 0, 16, 14),
                            child: Column(
                              children: planTasks.tasks.map((task) {
                                final color = _trackColor(task.track);
                                return _SheetTaskRow(
                                  task:     task,
                                  color:    color,
                                  cs:       cs,
                                  onToggle: () => taskNotifier.toggleTask(task.id),
                                );
                              }).toList(),
                            ),
                          ),
                        ],
                      ),
                    ),

                    const SizedBox(height: 16),

                    // Plan item cards
                    ...planState.activeItems.map((item) => _PlanItemCard(
                      item:  item,
                      cs:    cs,
                      amina: amina,
                    )),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DRAG HANDLE
// ═══════════════════════════════════════════════════════════════════════════════

class _DragHandle extends StatelessWidget {
  final ColorScheme cs;
  const _DragHandle({required this.cs});

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 12, bottom: 6),
        child: Center(
          child: Container(
            width:  40,
            height: 4,
            decoration: BoxDecoration(
              // Tone-mapped: mid grey in light, subtle on charcoal in dark.
              color: cs.onSurfaceVariant.withValues(alpha: 0.35),
              borderRadius: BorderRadius.circular(4),
            ),
          ),
        ),
      );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHEET HEADER
// ═══════════════════════════════════════════════════════════════════════════════

class _SheetHeader extends StatelessWidget {
  final ColorScheme cs;
  final AminaColors amina;
  const _SheetHeader({required this.cs, required this.amina});

  @override
  Widget build(BuildContext context) {
    final isDark = cs.brightness == Brightness.dark;

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 10, 20, 18),
      child: Row(
        children: [
          // Icon circle — Oura-style glow in dark mode.
          Container(
            width:  44,
            height: 44,
            decoration: BoxDecoration(
              color: cs.primaryContainer,    // sageLight ↔ dark sage tint
              shape: BoxShape.circle,
              boxShadow: isDark
                  ? [
                      BoxShadow(
                        color:        amina.sageGlow,
                        blurRadius:   14,
                        spreadRadius: 2,
                      ),
                    ]
                  : null,
            ),
            child: Icon(
              Icons.medical_services_outlined,
              color: cs.primary,             // sage in both modes
              size:  22,
            ),
          ),
          const SizedBox(width: 14),

          // Title + subtitle
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'My Care Plan',
                  style: TextStyle(
                    fontSize:      20,
                    fontWeight:    FontWeight.w800,
                    color:         cs.onSurface,
                    letterSpacing: -0.4,
                    fontFamily:    'Inter',
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'Three approaches, one journey',
                  style: TextStyle(
                    fontSize:   13,
                    color:      cs.onSurfaceVariant,
                    fontFamily: 'Inter',
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

// ═══════════════════════════════════════════════════════════════════════════════
// HARMONY BANNER
//
// Gradient spans primaryContainer → tertiaryContainer:
//   Light: EDF7F3 → EFF6FF  (sage-green to periwinkle — calm & complementary)
//   Dark:  1A3D2A → 1E3A5F  (deep sage to deep indigo — rich charcoal premium)
// ═══════════════════════════════════════════════════════════════════════════════

class _HarmonyBanner extends StatelessWidget {
  final ColorScheme cs;
  final AminaColors amina;
  const _HarmonyBanner({required this.cs, required this.amina});

  static const _plans = CarePlanType.values;

  @override
  Widget build(BuildContext context) {
    final isDark = cs.brightness == Brightness.dark;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [cs.primaryContainer, cs.tertiaryContainer],
          begin:  Alignment.centerLeft,
          end:    Alignment.centerRight,
        ),
        borderRadius: BorderRadius.circular(18),
        border:       Border.all(color: amina.cardBorder),
      ),
      child: Column(
        children: [
          // Three pills + connectors
          Row(
            children: [
              Flexible(child: _PlanPill(type: _plans[0], isDark: isDark)),
              _Connector(cs: cs),
              Flexible(child: _PlanPill(type: _plans[1], isDark: isDark)),
              _Connector(cs: cs),
              Flexible(child: _PlanPill(type: _plans[2], isDark: isDark)),
            ],
          ),

          const SizedBox(height: 10),

          Text(
            'These plans complement each other and work hand in hand\n'
            'for your complete wellbeing.',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize:   12,
              color:      cs.onSurfaceVariant,
              height:     1.45,
              fontFamily: 'Inter',
            ),
          ),
        ],
      ),
    );
  }
}

class _PlanPill extends StatelessWidget {
  final CarePlanType type;
  final bool         isDark;
  const _PlanPill({required this.type, required this.isDark});

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color:        type.bgFor(isDark),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
              color: type.color.withValues(alpha: 0.30)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(type.emoji, style: const TextStyle(fontSize: 13)),
            const SizedBox(width: 5),
            Flexible(
              child: Text(
                type.label,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize:   12,
                  fontWeight: FontWeight.w700,
                  color:      type.color,           // semantic — stays fixed
                  fontFamily: 'Inter',
                ),
              ),
            ),
          ],
        ),
      );
}

class _Connector extends StatelessWidget {
  final ColorScheme cs;
  const _Connector({required this.cs});

  @override
  Widget build(BuildContext context) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _dot(cs), const SizedBox(width: 3),
          _dot(cs), const SizedBox(width: 3),
          Icon(
            Icons.link_rounded,
            color: cs.onSurfaceVariant,       // adapts to brightness
            size:  14,
          ),
          const SizedBox(width: 3),
          _dot(cs), const SizedBox(width: 3),
          _dot(cs),
        ],
      );

  Widget _dot(ColorScheme cs) => Container(
        width:  4,
        height: 4,
        decoration: BoxDecoration(
          color: cs.onSurfaceVariant.withValues(alpha: 0.40),
          shape: BoxShape.circle,
        ),
      );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB BAR
// ═══════════════════════════════════════════════════════════════════════════════

class _PlanTabBar extends StatelessWidget {
  final CarePlanType activeTab;
  final ColorScheme  cs;
  final AminaColors  amina;
  const _PlanTabBar({
    required this.activeTab,
    required this.cs,
    required this.amina,
  });

  @override
  Widget build(BuildContext context) => Container(
        color: cs.surface,                          // fff ↔ 1F222A
        child: Row(
          children: CarePlanType.values
              .map((t) => Expanded(
                    child: _Tab(
                      type:     t,
                      isActive: t == activeTab,
                      cs:       cs,
                      amina:    amina,
                    ),
                  ))
              .toList(),
        ),
      );
}

class _Tab extends ConsumerWidget {
  final CarePlanType type;
  final bool         isActive;
  final ColorScheme  cs;
  final AminaColors  amina;
  const _Tab({
    required this.type,
    required this.isActive,
    required this.cs,
    required this.amina,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isDark = cs.brightness == Brightness.dark;

    return GestureDetector(
      onTap: () => ref.read(carePlanProvider.notifier).selectTab(type),
      behavior: HitTestBehavior.opaque,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding:  const EdgeInsets.symmetric(vertical: 14),
        decoration: BoxDecoration(
          border: Border(
            bottom: BorderSide(
              color: isActive ? type.color : Colors.transparent,
              width: 2.5,
            ),
          ),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Icon circle — Oura glow on the active tab in dark mode.
            AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              width:  34,
              height: 34,
              decoration: BoxDecoration(
                color: isActive
                    ? type.bgFor(isDark)
                    : Colors.transparent,
                shape: BoxShape.circle,
                // Subtle category-coloured glow in dark mode only.
                boxShadow: isActive && isDark
                    ? [
                        BoxShadow(
                          color:        type.color.withValues(alpha: 0.35),
                          blurRadius:   10,
                          spreadRadius: 1,
                        ),
                      ]
                    : null,
              ),
              child: Icon(
                type.icon,
                size:  18,
                color: isActive ? type.color : cs.onSurfaceVariant,
              ),
            ),

            const SizedBox(height: 5),

            Text(
              type.label,
              style: TextStyle(
                fontSize:   12,
                fontWeight: isActive ? FontWeight.w700 : FontWeight.w500,
                color:      isActive ? type.color : cs.onSurfaceVariant,
                fontFamily: 'Inter',
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN ITEM CARD
// ═══════════════════════════════════════════════════════════════════════════════

class _PlanItemCard extends StatefulWidget {
  final CarePlanItem item;
  final ColorScheme  cs;
  final AminaColors  amina;
  const _PlanItemCard({
    required this.item,
    required this.cs,
    required this.amina,
  });

  @override
  State<_PlanItemCard> createState() => _PlanItemCardState();
}

class _PlanItemCardState extends State<_PlanItemCard> {
  bool _expanded = false;

  static String _timeAgo(DateTime dt) {
    final diff = DateTime.now().difference(dt);
    if (diff.inMinutes < 1)  return 'Just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours   < 24) return '${diff.inHours}h ago';
    if (diff.inDays    <  7) return '${diff.inDays}d ago';
    const m = ['Jan','Feb','Mar','Apr','May','Jun',
                'Jul','Aug','Sep','Oct','Nov','Dec'];
    return '${m[dt.month - 1]} ${dt.day}';
  }

  @override
  Widget build(BuildContext context) {
    final cs    = widget.cs;
    final amina = widget.amina;
    final isDark = cs.brightness == Brightness.dark;
    final item   = widget.item;
    final type   = item.type;
    final color  = type.color; // semantic — fixed

    return GestureDetector(
      onTap: () => setState(() => _expanded = !_expanded),
      child: Container(
        margin: const EdgeInsets.only(bottom: 14),
        decoration: BoxDecoration(
          color:        cs.surface,
          borderRadius: BorderRadius.circular(20),
          border:       Border.all(color: amina.cardBorder),
          boxShadow: [
            BoxShadow(
              color:      cs.shadow.withValues(alpha: isDark ? 0.30 : 0.06),
              blurRadius: 12,
              offset:     const Offset(0, 3),
            ),
          ],
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(20),
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // Left colour accent strip — semantic category colour.
                Container(width: 5, color: color),

                // Card body
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(16, 14, 14, 14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // Top row: title + priority badge
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              child: Text(
                                item.title,
                                style: TextStyle(
                                  fontSize:   15,
                                  fontWeight: FontWeight.w700,
                                  color:      cs.onSurface,
                                  height:     1.3,
                                  fontFamily: 'Inter',
                                ),
                              ),
                            ),
                            const SizedBox(width: 10),
                            _PriorityBadge(
                              priority: item.priority,
                              cs:       cs,
                            ),
                          ],
                        ),

                        const SizedBox(height: 8),

                        // Body text — collapsible
                        AnimatedCrossFade(
                          duration: const Duration(milliseconds: 220),
                          crossFadeState: _expanded
                              ? CrossFadeState.showSecond
                              : CrossFadeState.showFirst,
                          firstChild: Text(
                            item.body,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize:   13.5,
                              color:      cs.onSurfaceVariant,
                              height:     1.5,
                              fontFamily: 'Inter',
                            ),
                          ),
                          secondChild: Text(
                            item.body,
                            style: TextStyle(
                              fontSize:   13.5,
                              color:      cs.onSurfaceVariant,
                              height:     1.5,
                              fontFamily: 'Inter',
                            ),
                          ),
                        ),

                        // Show more / less
                        Align(
                          alignment: Alignment.centerLeft,
                          child: TextButton(
                            onPressed: () =>
                                setState(() => _expanded = !_expanded),
                            style: TextButton.styleFrom(
                              foregroundColor: color,
                              padding: EdgeInsets.zero,
                              minimumSize:      Size.zero,
                              tapTargetSize:
                                  MaterialTapTargetSize.shrinkWrap,
                              textStyle: const TextStyle(
                                fontSize:   12,
                                fontWeight: FontWeight.w600,
                                fontFamily: 'Inter',
                              ),
                            ),
                            child: Text(
                                _expanded ? 'Show less' : 'Show more'),
                          ),
                        ),

                        const SizedBox(height: 4),
                        Divider(
                            height: 1, color: amina.divider),
                        const SizedBox(height: 10),

                        // Source row
                        Row(
                          children: [
                            // Avatar circle — icon bg adapts to mode.
                            Container(
                              width:  32,
                              height: 32,
                              decoration: BoxDecoration(
                                color:  type.bgFor(isDark),
                                shape:  BoxShape.circle,
                                border: Border.all(
                                  color: color.withValues(alpha: 0.25),
                                ),
                                // Oura-style glow in dark mode.
                                boxShadow: isDark
                                    ? [
                                        BoxShadow(
                                          color:      color.withValues(
                                              alpha: 0.25),
                                          blurRadius: 8,
                                        ),
                                      ]
                                    : null,
                              ),
                              child: Center(
                                child: Text(
                                  item.source[0],
                                  style: TextStyle(
                                    fontSize:   14,
                                    fontWeight: FontWeight.w700,
                                    color:      color,
                                    fontFamily: 'Inter',
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(width: 10),

                            // Name + role
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    item.source,
                                    style: TextStyle(
                                      fontSize:   13,
                                      fontWeight: FontWeight.w600,
                                      color:      cs.onSurface,
                                      fontFamily: 'Inter',
                                    ),
                                  ),
                                  Text(
                                    item.sourceRole,
                                    style: TextStyle(
                                      fontSize:   11,
                                      color:      cs.onSurfaceVariant,
                                      fontFamily: 'Inter',
                                    ),
                                  ),
                                ],
                              ),
                            ),

                            // Source type tag
                            _SourceTag(type: type, isDark: isDark, cs: cs),
                          ],
                        ),

                        const SizedBox(height: 8),

                        // Updated timestamp
                        Row(
                          children: [
                            Icon(
                              Icons.access_time_rounded,
                              size:  12,
                              // Faded — purely decorative metadata.
                              color: cs.onSurfaceVariant
                                  .withValues(alpha: 0.50),
                            ),
                            const SizedBox(width: 4),
                            Text(
                              'Updated ${_timeAgo(item.updatedAt)}',
                              style: TextStyle(
                                fontSize:   11,
                                color: cs.onSurfaceVariant
                                    .withValues(alpha: 0.50),
                                fontFamily: 'Inter',
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHEET TASK ROW
// ═══════════════════════════════════════════════════════════════════════════════

class _SheetTaskRow extends StatelessWidget {
  final PlanTask     task;
  final Color        color;   // semantic track colour, stays fixed
  final ColorScheme  cs;
  final VoidCallback onToggle;
  const _SheetTaskRow({
    required this.task,
    required this.color,
    required this.cs,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) => GestureDetector(
        onTap: onToggle,
        behavior: HitTestBehavior.opaque,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Row(
            children: [
              // Checkbox circle
              AnimatedContainer(
                duration: const Duration(milliseconds: 220),
                width:  26,
                height: 26,
                decoration: BoxDecoration(
                  color:  task.completed ? color : Colors.transparent,
                  shape:  BoxShape.circle,
                  border: Border.all(
                    color: task.completed ? color : cs.outline,
                    width: 1.8,
                  ),
                ),
                child: task.completed
                    ? const Icon(Icons.check_rounded,
                        color: Colors.white, size: 15)
                    : null,
              ),

              const SizedBox(width: 12),

              // Track dot
              Container(
                width:  6,
                height: 6,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.70),
                  shape: BoxShape.circle,
                ),
              ),

              const SizedBox(width: 10),

              Text(task.emoji,
                  style: const TextStyle(fontSize: 16)),
              const SizedBox(width: 8),

              // Title
              Expanded(
                child: AnimatedDefaultTextStyle(
                  duration: const Duration(milliseconds: 220),
                  style: TextStyle(
                    color:           task.completed
                        ? cs.onSurfaceVariant
                        : cs.onSurface,
                    fontSize:        14,
                    fontWeight:      FontWeight.w500,
                    fontFamily:      'Inter',
                    decoration:      task.completed
                        ? TextDecoration.lineThrough
                        : TextDecoration.none,
                    decorationColor: cs.onSurfaceVariant,
                  ),
                  child: Text(
                    task.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ),
            ],
          ),
        ),
      );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRIORITY BADGE
//
// Red / Amber / Primary are universal semantic signals — they stay fixed
// so their meaning is unambiguous in both light and dark mode.
// Only the background/border alpha adapts to ensure legibility.
// ═══════════════════════════════════════════════════════════════════════════════

class _PriorityBadge extends StatelessWidget {
  final CarePlanPriority priority;
  final ColorScheme      cs;
  const _PriorityBadge({required this.priority, required this.cs});

  Color _color() => switch (priority) {
        CarePlanPriority.high   => _kPriorityHigh,
        CarePlanPriority.medium => _kPriorityMid,
        CarePlanPriority.low    => cs.primary,    // sage — themed
      };

  String _label() => switch (priority) {
        CarePlanPriority.high   => 'High',
        CarePlanPriority.medium => 'Medium',
        CarePlanPriority.low    => 'Low',
      };

  @override
  Widget build(BuildContext context) {
    final color = _color();
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color:        color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(20),
        border:       Border.all(color: color.withValues(alpha: 0.30)),
      ),
      child: Text(
        _label(),
        style: TextStyle(
          fontSize:   10,
          fontWeight: FontWeight.w700,
          color:      color,
          fontFamily: 'Inter',
        ),
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SOURCE TAG
// ═══════════════════════════════════════════════════════════════════════════════

class _SourceTag extends StatelessWidget {
  final CarePlanType type;
  final bool         isDark;
  final ColorScheme  cs;
  const _SourceTag({
    required this.type,
    required this.isDark,
    required this.cs,
  });

  @override
  Widget build(BuildContext context) {
    final color = type.color;          // semantic — fixed
    final bg    = type.bgFor(isDark);  // adapts to brightness

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color:        bg,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: color.withValues(alpha: 0.25),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(type.sourceIcon, size: 11, color: color),
          const SizedBox(width: 4),
          Text(
            type.sourceTag,
            style: TextStyle(
              fontSize:   10,
              fontWeight: FontWeight.w600,
              color:      color,
              fontFamily: 'Inter',
            ),
          ),
        ],
      ),
    );
  }
}
