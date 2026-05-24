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
import '../../../../core/theme/app_theme.dart';

/// Elegant "Tip of the day" banner — white card with a 4 px sage accent bar.
class DailyAdviceBanner extends StatelessWidget {
  const DailyAdviceBanner({super.key});

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    return Container(
      decoration: BoxDecoration(
        color:        cs.surface,
        borderRadius: BorderRadius.circular(14),
        border:       Border.all(color: amina.cardBorder),
        boxShadow: [
          BoxShadow(color: amina.sageGlow, blurRadius: 8, offset: const Offset(0, 2)),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(14),
        child: IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Sage accent bar
              Container(width: 4, color: cs.primary),
              // Content
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
                  child: Row(
                    children: [
                      Container(
                        width:  32,
                        height: 32,
                        decoration: BoxDecoration(
                          color:        cs.primaryContainer,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Icon(Icons.tips_and_updates_outlined,
                            color: cs.primary, size: 18),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          "Drink water before meals to help control blood sugar.",
                          style: TextStyle(
                            color:      cs.onSurfaceVariant,
                            fontSize:   13.5,
                            fontWeight: FontWeight.w500,
                            height:     1.35,
                          ),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      const SizedBox(width: 8),
                      GestureDetector(
                        onTap: () {},
                        child: Text(
                          "More",
                          style: TextStyle(
                            color:      cs.primary,
                            fontSize:   13,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ],
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
