import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';

// ─── FeaturedPost ─────────────────────────────────────────────────────────────

/// Large hero card used for the lead post in "Official Broadcasts".
///
/// Shows a full-width network image with an overlaid [_CategoryPill] (top-right),
/// an optional URGENT ribbon (top-left), and a [_SourceChip] (bottom-left).
/// Below the image: title, description, optional time-ago, and an
/// institutional action row (like / Ask AI / save).
class FeaturedPost extends StatelessWidget {
  final String  id;
  final String  title;
  final String  description;
  final String  imageUrl;

  // Institutional metadata
  final String?  publisher;
  final String?  category;
  final Color?   categoryColor;
  final bool     isUrgent;
  final String?  timeAgo;

  // Interactive state
  final bool     isLiked;
  final bool     isSaved;
  final int      likeCount;
  final VoidCallback onLike;
  final VoidCallback onSave;

  const FeaturedPost({
    super.key,
    required this.id,
    required this.title,
    required this.description,
    required this.imageUrl,
    this.publisher,
    this.category,
    this.categoryColor,
    this.isUrgent = false,
    this.timeAgo,
    required this.isLiked,
    required this.isSaved,
    required this.likeCount,
    required this.onLike,
    required this.onSave,
  });

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    return Container(
      decoration: BoxDecoration(
        color:        cs.surface,
        borderRadius: BorderRadius.circular(25),
        border:       Border.all(color: amina.cardBorder),
        boxShadow: [
          BoxShadow(
            color:      amina.sageGlow,
            blurRadius: 10,
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [

          // ── Hero image ──────────────────────────────────────────────────
          ClipRRect(
            borderRadius: const BorderRadius.vertical(top: Radius.circular(25)),
            child: Stack(
              children: [
                Image.network(
                  imageUrl,
                  height: 180,
                  width:  double.infinity,
                  fit:    BoxFit.cover,
                  errorBuilder: (_, __, ___) => Container(
                    height: 180,
                    color:  amina.inputFill,
                    child:  Center(
                      child: Icon(Icons.broken_image_rounded,
                          color: cs.onSurfaceVariant, size: 40),
                    ),
                  ),
                ),

                // Dark gradient scrim for legibility
                Positioned.fill(
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin:  Alignment.topCenter,
                        end:    Alignment.bottomCenter,
                        colors: [
                          Colors.transparent,
                          Colors.black.withValues(alpha: 0.45),
                        ],
                      ),
                    ),
                  ),
                ),

                // Category pill — top right
                if (category != null)
                  Positioned(
                    top: 12, right: 12,
                    child: _CategoryPill(
                      label: category!,
                      color: categoryColor ?? cs.onSurface,
                    ),
                  ),

                // URGENT ribbon — top left
                if (isUrgent)
                  Positioned(
                    top: 12, left: 12,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color:        const Color(0xFFDC2626),
                        borderRadius: BorderRadius.circular(30),
                      ),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.priority_high_rounded,
                              color: Colors.white, size: 12),
                          SizedBox(width: 3),
                          Text(
                            'URGENT',
                            style: TextStyle(
                              color:         Colors.white,
                              fontSize:      10,
                              fontWeight:    FontWeight.w800,
                              letterSpacing: 0.6,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),

                // Verified source chip — bottom left
                if (publisher != null)
                  Positioned(
                    bottom: 10, left: 12,
                    child: _SourceChip(publisher!),
                  ),
              ],
            ),
          ),

          // ── Body ────────────────────────────────────────────────────────
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    fontSize:   17,
                    fontWeight: FontWeight.w700,
                    color:      cs.onSurface,
                    height:     1.3,
                  ),
                ),
                const SizedBox(height: 7),
                Text(
                  description,
                  style: TextStyle(
                    color:    cs.onSurfaceVariant,
                    fontSize: 13,
                    height:   1.5,
                  ),
                ),

                // Time-ago stamp
                if (timeAgo != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    timeAgo!,
                    style: TextStyle(
                      fontSize: 11,
                      color:    cs.onSurfaceVariant.withValues(alpha: 0.7),
                    ),
                  ),
                ],

                Divider(height: 26, color: amina.cardBorder),

                // Action row — interactive like / Ask AI / save
                Row(
                  children: [
                    // Like button
                    GestureDetector(
                      onTap: onLike,
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 200),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            AnimatedSwitcher(
                              duration: const Duration(milliseconds: 200),
                              child: Icon(
                                isLiked ? Icons.favorite_rounded : Icons.favorite_border_rounded,
                                key: ValueKey(isLiked),
                                color: isLiked ? const Color(0xFFEF4444) : cs.onSurfaceVariant,
                                size: 18,
                              ),
                            ),
                            const SizedBox(width: 5),
                            Text(
                              '$likeCount',
                              style: TextStyle(
                                color:      isLiked ? const Color(0xFFEF4444) : cs.onSurfaceVariant,
                                fontSize:   13,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const Spacer(),
                    // Ask AI (placeholder)
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.smart_toy_outlined, size: 17, color: cs.onSurfaceVariant),
                        const SizedBox(width: 5),
                        Text('Ask AI', style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant)),
                      ],
                    ),
                    const SizedBox(width: 16),
                    // Save button
                    GestureDetector(
                      onTap: onSave,
                      child: AnimatedSwitcher(
                        duration: const Duration(milliseconds: 200),
                        child: Icon(
                          isSaved ? Icons.bookmark_rounded : Icons.bookmark_border_rounded,
                          key: ValueKey(isSaved),
                          color: isSaved ? const Color(0xFF7C3AED) : cs.onSurfaceVariant,
                          size: 20,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Category pill ────────────────────────────────────────────────────────────

class _CategoryPill extends StatelessWidget {
  final String label;
  final Color  color;

  const _CategoryPill({required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color:        color,
        borderRadius: BorderRadius.circular(30),
      ),
      child: Text(
        label.toUpperCase(),
        style: const TextStyle(
          color:         Colors.white,
          fontSize:      10,
          fontWeight:    FontWeight.w700,
          letterSpacing: 0.5,
        ),
      ),
    );
  }
}

// ─── Source chip (overlaid on image) ─────────────────────────────────────────

class _SourceChip extends StatelessWidget {
  final String publisher;

  const _SourceChip(this.publisher);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color:        Colors.black.withValues(alpha: 0.55),
        borderRadius: BorderRadius.circular(30),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.verified_rounded,
              color: Colors.white, size: 11),
          const SizedBox(width: 4),
          Text(
            publisher,
            style: const TextStyle(
              color:      Colors.white,
              fontSize:   11,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}
