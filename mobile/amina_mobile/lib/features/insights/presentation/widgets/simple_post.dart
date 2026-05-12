import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';

// ─── SimplePost ───────────────────────────────────────────────────────────────

/// Compact list card used for secondary posts in "Official Broadcasts".
///
/// Left side: category icon circle (colour-coded).
/// Body: optional [_CategoryPill] + title + two-line description
///       + publisher attribution line with verified checkmark + time-ago
///       + like / save action row.
class SimplePost extends StatelessWidget {
  final String   id;
  final String   title;
  final String   description;

  // Institutional metadata
  final String?   publisher;
  final String?   category;
  final Color?    categoryColor;
  final IconData? categoryIcon;
  final bool      isUrgent;
  final String?   timeAgo;

  // Interactive state
  final bool         isLiked;
  final bool         isSaved;
  final int          likeCount;
  final VoidCallback onLike;
  final VoidCallback onSave;

  const SimplePost({
    super.key,
    required this.id,
    required this.title,
    required this.description,
    this.publisher,
    this.category,
    this.categoryColor,
    this.categoryIcon,
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
    final cs       = Theme.of(context).colorScheme;
    final amina    = Theme.of(context).extension<AminaColors>()!;
    final Color    chipColor = categoryColor ?? cs.onSurfaceVariant;
    final IconData iconData  = categoryIcon  ?? Icons.article_rounded;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color:        cs.surface,
        borderRadius: BorderRadius.circular(20),
        border:       Border.all(color: amina.cardBorder),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [

          // Category icon circle
          Container(
            width:  44,
            height: 44,
            decoration: BoxDecoration(
              color: chipColor.withValues(alpha: 0.10),
              shape: BoxShape.circle,
            ),
            child: Icon(iconData, color: chipColor, size: 22),
          ),
          const SizedBox(width: 13),

          // Body
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [

                // Category pill row
                if (category != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 6),
                    child: Row(
                      children: [
                        _CategoryPill(label: category!, color: chipColor),
                        // Urgent indicator dot
                        if (isUrgent) ...[
                          const SizedBox(width: 6),
                          Container(
                            width:  7,
                            height: 7,
                            decoration: const BoxDecoration(
                              color: Color(0xFFDC2626),
                              shape: BoxShape.circle,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),

                // Title
                Text(
                  title,
                  style: TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize:   15,
                    color:      cs.onSurface,
                    height:     1.3,
                  ),
                ),
                const SizedBox(height: 5),

                // Description (capped at 2 lines for visual rhythm)
                Text(
                  description,
                  style: TextStyle(
                    color:    cs.onSurfaceVariant,
                    fontSize: 13,
                    height:   1.45,
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),

                // Publisher + time-ago attribution line
                if (publisher != null || timeAgo != null) ...[
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      if (publisher != null) ...[
                        Icon(Icons.verified_rounded,
                            color: cs.primary, size: 12),
                        const SizedBox(width: 4),
                        Flexible(
                          child: Text(
                            publisher!,
                            style: TextStyle(
                              fontSize:   11,
                              color:      cs.onSurfaceVariant.withValues(alpha: 0.8),
                              fontWeight: FontWeight.w500,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                      if (publisher != null && timeAgo != null)
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 5),
                          child: Text(
                            '·',
                            style: TextStyle(
                              color:    cs.onSurfaceVariant.withValues(alpha: 0.5),
                              fontSize: 12,
                            ),
                          ),
                        ),
                      if (timeAgo != null)
                        Text(
                          timeAgo!,
                          style: TextStyle(
                            fontSize: 11,
                            color:    cs.onSurfaceVariant.withValues(alpha: 0.7),
                          ),
                        ),
                    ],
                  ),
                ],

                // ── Like / Save action row ───────────────────────────────
                const SizedBox(height: 10),
                Divider(height: 1, color: amina.cardBorder),
                const SizedBox(height: 10),
                Row(
                  children: [
                    // Like
                    GestureDetector(
                      onTap: onLike,
                      behavior: HitTestBehavior.opaque,
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          AnimatedSwitcher(
                            duration: const Duration(milliseconds: 200),
                            child: Icon(
                              isLiked ? Icons.favorite_rounded : Icons.favorite_border_rounded,
                              key: ValueKey(isLiked),
                              color: isLiked ? const Color(0xFFEF4444) : cs.onSurfaceVariant,
                              size: 16,
                            ),
                          ),
                          const SizedBox(width: 4),
                          Text(
                            '$likeCount',
                            style: TextStyle(
                              fontSize:   12,
                              fontWeight: FontWeight.w600,
                              color:      isLiked ? const Color(0xFFEF4444) : cs.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const Spacer(),
                    // Save
                    GestureDetector(
                      onTap: onSave,
                      behavior: HitTestBehavior.opaque,
                      child: AnimatedSwitcher(
                        duration: const Duration(milliseconds: 200),
                        child: Icon(
                          isSaved ? Icons.bookmark_rounded : Icons.bookmark_border_rounded,
                          key: ValueKey(isSaved),
                          color: isSaved ? const Color(0xFF7C3AED) : cs.onSurfaceVariant,
                          size: 18,
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
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color:        color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(30),
      ),
      child: Text(
        label.toUpperCase(),
        style: TextStyle(
          color:         color,
          fontSize:      9,
          fontWeight:    FontWeight.w800,
          letterSpacing: 0.5,
        ),
      ),
    );
  }
}
