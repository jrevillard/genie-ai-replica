import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../data/models/health_story.dart';
import '../providers/seasonal_story_provider.dart';
import '../providers/stories_provider.dart';
import 'story_viewer.dart';

// ─── StoryThumbnailRow ────────────────────────────────────────────────────────

/// Horizontal strip of rounded-rectangle story thumbnails.
///
/// Unseen stories show the publisher's accent-coloured gradient and a white
/// glow shadow.  Seen stories desaturate to a neutral grey gradient and drop
/// their shadow, giving the user a clear at-a-glance read of what's new.
///
/// Tapping a thumbnail opens [StoryViewerScreen] as a full-screen modal with
/// a smooth slide-up transition.  When the viewer closes, the Riverpod
/// [seenStoriesProvider] is already updated, so the thumbnail ring updates
/// automatically via [ConsumerWidget] rebuild.
class StoryThumbnailRow extends ConsumerWidget {
  const StoryThumbnailRow({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final seenIds      = ref.watch(seenStoriesProvider);
    final seasonalAsync = ref.watch(seasonalStoryProvider);
    final cs           = Theme.of(context).colorScheme;

    // Index 2 is the seasonal slot. null means still loading.
    // On error, fall back to the static tip_hydration story (kMockStories[2]).
    final List<HealthStory?> stories = [
      kMockStories[0],
      kMockStories[1],
      seasonalAsync.when(
        data:    (s) => s,
        loading: () => null,
        error:   (_, __) => kMockStories[2],
      ),
      kMockStories[3],
      kMockStories[4],
    ];

    // Resolved list used by the viewer (excludes the loading placeholder).
    final resolved = stories.whereType<HealthStory>().toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // ── Section header ─────────────────────────────────────────────
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Health Stories',
                style: TextStyle(
                  fontSize:      19,
                  fontWeight:    FontWeight.w700,
                  color:         cs.onSurface,
                  letterSpacing: -0.4,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                'From hospitals & health authorities',
                style: TextStyle(fontSize: 12.5, color: cs.onSurfaceVariant),
              ),
            ],
          ),
        ),

        // ── Thumbnail strip ────────────────────────────────────────────
        SizedBox(
          height: 156,
          child: ListView.separated(
            scrollDirection:  Axis.horizontal,
            padding:          const EdgeInsets.only(left: 20),
            physics:          const BouncingScrollPhysics(),
            itemCount:        stories.length,
            separatorBuilder: (_, __) => const SizedBox(width: 12),
            itemBuilder: (context, i) {
              final story = stories[i];
              if (story == null) return const _LoadingThumbnail();
              final seen         = seenIds.contains(story.id);
              final resolvedIndex = resolved.indexOf(story);
              return _StoryThumbnail(
                story: story,
                seen:  seen,
                onTap: () => _openViewer(context, resolved, resolvedIndex),
              );
            },
          ),
        ),
      ],
    );
  }

  void _openViewer(BuildContext context, List<HealthStory> stories, int index) {
    showGeneralDialog<void>(
      context:            context,
      barrierColor:       Colors.black,
      barrierDismissible: false,
      pageBuilder: (ctx, _, __) => StoryViewerScreen(
        stories:      stories,
        initialIndex: index,
      ),
      transitionBuilder: (ctx, anim, _, child) => SlideTransition(
        position: Tween<Offset>(
          begin: const Offset(0, 1),
          end:   Offset.zero,
        ).animate(CurvedAnimation(parent: anim, curve: Curves.easeOutCubic)),
        child: child,
      ),
      transitionDuration: const Duration(milliseconds: 380),
    );
  }
}

// ─── Loading placeholder ──────────────────────────────────────────────────────

class _LoadingThumbnail extends StatelessWidget {
  const _LoadingThumbnail();

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 88,
      child: Column(
        children: [
          Container(
            width:  88,
            height: 116,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(22),
              color: const Color(0xFFE5E7EB),
            ),
            child: const Center(
              child: SizedBox(
                width:  20,
                height: 20,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: Color(0xFF9CA3AF),
                ),
              ),
            ),
          ),
          const SizedBox(height: 7),
          Container(
            height: 10,
            width:  56,
            decoration: BoxDecoration(
              color:        const Color(0xFFE5E7EB),
              borderRadius: BorderRadius.circular(4),
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Story thumbnail ──────────────────────────────────────────────────────────

class _StoryThumbnail extends StatelessWidget {
  final HealthStory  story;
  final bool         seen;
  final VoidCallback onTap;

  const _StoryThumbnail({
    required this.story,
    required this.seen,
    required this.onTap,
  });

  static const _kSeenGradient = LinearGradient(
    begin:  Alignment.topLeft,
    end:    Alignment.bottomRight,
    colors: [Color(0xFFD1D5DB), Color(0xFFA3A3A3)],
  );

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return GestureDetector(
      onTap: onTap,
      child: SizedBox(
        width: 88,
        child: Column(
          children: [
            // ── Card ────────────────────────────────────────────────────
            Container(
              width:  88,
              height: 116,
              clipBehavior: Clip.antiAlias,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(22),
                gradient: seen ? _kSeenGradient : story.thumbnailGradient,
                boxShadow: seen
                    ? null
                    : [
                        BoxShadow(
                          color:      story.accentColor.withValues(alpha: 0.38),
                          blurRadius: 14,
                          offset:     const Offset(0, 5),
                        ),
                      ],
              ),
              child: Stack(
                children: [
                  // Decorative bubble — top-right
                  Positioned(
                    top:   -16,
                    right: -16,
                    child: Container(
                      width:  54,
                      height: 54,
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.10),
                        shape: BoxShape.circle,
                      ),
                    ),
                  ),

                  // Decorative bubble — bottom-left
                  Positioned(
                    bottom: -12,
                    left:   -12,
                    child: Container(
                      width:  38,
                      height: 38,
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.08),
                        shape: BoxShape.circle,
                      ),
                    ),
                  ),

                  // Unseen border ring
                  if (!seen)
                    Positioned.fill(
                      child: Container(
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(22),
                          border: Border.all(
                            color: Colors.white.withValues(alpha: 0.38),
                            width: 2,
                          ),
                        ),
                      ),
                    ),

                  // Emoji + new-dot
                  Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          story.thumbnailEmoji,
                          style: const TextStyle(fontSize: 34),
                        ),
                        if (!seen) ...[
                          const SizedBox(height: 7),
                          // "New" indicator dot
                          Container(
                            width:  6,
                            height: 6,
                            decoration: BoxDecoration(
                              color: Colors.white.withValues(alpha: 0.90),
                              shape: BoxShape.circle,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 7),

            // ── Publisher label ──────────────────────────────────────────
            Text(
              story.publisher,
              textAlign: TextAlign.center,
              maxLines:  2,
              overflow:  TextOverflow.ellipsis,
              style: TextStyle(
                fontSize:   10.5,
                fontWeight: FontWeight.w600,
                color: seen
                    ? cs.onSurfaceVariant.withValues(alpha: 0.6)
                    : cs.onSurface,
                height: 1.3,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
