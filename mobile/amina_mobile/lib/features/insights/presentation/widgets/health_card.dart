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

/// A Flo-inspired fixed-width card for the InsightsScreen horizontal scroll.
///
/// Supports three visual modes depending on which fields are provided:
///   - Action card  : [isActionCard] = true  → shows a colored + circle at top
///   - Emoji card   : [emoji] provided        → large emoji at top
///   - Icon card    : [icon] provided         → Material icon at top
///
/// The bottom portion always shows [title] plus an optional [value] or [cta].
class HealthCard extends StatelessWidget {
  /// Main label shown in the lower portion of the card.
  final String title;

  /// Secondary value shown below the title (e.g. "110 mg/dL", "Not logged").
  final String? value;

  /// Call-to-action text shown below the title when [value] is absent.
  final String? cta;

  /// Emoji string rendered at the top of the card. Takes priority over [icon].
  final String? emoji;

  /// Fallback icon when no [emoji] is given.
  final IconData? icon;

  /// Card background color.
  final Color backgroundColor;

  /// Color used for the icon, emoji tint ring, title, and CTA.
  final Color contentColor;

  /// When true, replaces the emoji/icon with a filled + circle — used for
  /// the primary "Log Today" action card.
  final bool isActionCard;

  final VoidCallback onTap;

  const HealthCard({
    super.key,
    required this.title,
    required this.backgroundColor,
    required this.contentColor,
    required this.onTap,
    this.value,
    this.cta,
    this.emoji,
    this.icon,
    this.isActionCard = false,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 148,
        margin: const EdgeInsets.only(right: 14),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: backgroundColor,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: contentColor.withValues(alpha: 0.18),
          ),
          boxShadow: [
            BoxShadow(
              color: contentColor.withValues(alpha: 0.07),
              blurRadius: 12,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // ── Top visual element ────────────────────────────────────────
            _TopElement(
              isActionCard:    isActionCard,
              emoji:           emoji,
              icon:            icon,
              contentColor:    contentColor,
              backgroundColor: backgroundColor,
            ),

            const Spacer(),

            // ── Title ─────────────────────────────────────────────────────
            Text(
              title,
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w700,
                color: contentColor,
                height: 1.3,
              ),
            ),

            // ── Value ─────────────────────────────────────────────────────
            if (value != null) ...[
              const SizedBox(height: 4),
              Text(
                value!,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                  color: contentColor.withValues(alpha: 0.75),
                  height: 1.3,
                ),
              ),
            ],

            // ── CTA ───────────────────────────────────────────────────────
            if (cta != null && value == null) ...[
              const SizedBox(height: 6),
              Row(
                children: [
                  Text(
                    cta!,
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: contentColor,
                    ),
                  ),
                  const SizedBox(width: 2),
                  Icon(Icons.arrow_forward_rounded,
                      size: 12, color: contentColor),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

// ─── Top element ──────────────────────────────────────────────────────────────

class _TopElement extends StatelessWidget {
  final bool isActionCard;
  final String? emoji;
  final IconData? icon;
  final Color contentColor;
  final Color backgroundColor;

  const _TopElement({
    required this.isActionCard,
    required this.emoji,
    required this.icon,
    required this.contentColor,
    required this.backgroundColor,
  });

  @override
  Widget build(BuildContext context) {
    if (isActionCard) {
      // Filled circle with a + icon — primary action affordance.
      return Container(
        width: 44,
        height: 44,
        decoration: BoxDecoration(
          color: contentColor,
          shape: BoxShape.circle,
        ),
        child: Icon(Icons.add_rounded,
            color: backgroundColor, size: 26),
      );
    }

    if (emoji != null) {
      return Text(emoji!, style: const TextStyle(fontSize: 30));
    }

    if (icon != null) {
      return Container(
        width: 44,
        height: 44,
        decoration: BoxDecoration(
          color: contentColor.withValues(alpha: 0.12),
          shape: BoxShape.circle,
        ),
        child: Icon(icon!, color: contentColor, size: 22),
      );
    }

    return const SizedBox(height: 44);
  }
}
