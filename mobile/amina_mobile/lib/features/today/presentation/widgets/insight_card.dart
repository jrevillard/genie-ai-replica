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

class InsightCard extends StatelessWidget {
  final String title;
  final IconData icon;
  final Color backgroundColor;
  final Color iconColor;
  final bool isFeatured;
  final VoidCallback onTap;

  const InsightCard({
    super.key,
    required this.title,
    required this.icon,
    required this.backgroundColor,
    required this.iconColor,
    required this.onTap,
    this.isFeatured = false,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 150,
        margin: const EdgeInsets.only(right: 15),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: backgroundColor,
          borderRadius: BorderRadius.circular(24),
          border: Border.all(
            color: isFeatured
                ? iconColor.withOpacity(0.5)
                : iconColor.withOpacity(0.1),
            width: isFeatured ? 2 : 1,
          ),
          boxShadow: [
            BoxShadow(
              color: iconColor.withOpacity(0.05),
              blurRadius: 10,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: isFeatured
              ? CrossAxisAlignment.start
              : CrossAxisAlignment.center,
          children: [
            Icon(icon, color: iconColor, size: 32),
            const SizedBox(height: 12),
            Text(
              title,
              textAlign: isFeatured ? TextAlign.left : TextAlign.center,
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 13,
                fontWeight:
                    isFeatured ? FontWeight.bold : FontWeight.w600,
                color: iconColor,
                height: 1.2,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
